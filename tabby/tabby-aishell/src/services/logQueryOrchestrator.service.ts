import { Injectable } from '@angular/core'
import { Subject, Subscription, firstValueFrom, timer } from 'rxjs'
import { NotificationsService, PartialProfile, Profile, ProfilesService, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent, ConnectableTerminalTabComponent } from 'tabby-terminal'

import { TerminalContextService } from './terminalContext.service'
import {
    LOG_MODULES,
    LogQueryRequest,
    LogQueryStep,
    VENDOR_SUCCESS_MODULES,
    allowedLogTypesFor,
    dateFromTaskId,
    initialModuleForTask,
    normaliseDate,
} from './logQueryRules'
import { GTPR_CODES, describeActionIds, describeVendorCode } from './logQueryCodes'

export interface LogQueryEvent {
    queryId: string
    phase: 'opening' | 'running' | 'parsing' | 'finished' | 'paused' | 'failed'
    module?: string
    logType?: string
    command?: string
    output?: string
    message: string
    interpretation?: string
    nextModule?: string
}

export interface LogQueryResult {
    queryId: string
    status: 'finished' | 'paused' | 'failed'
    events: LogQueryEvent[]
    conclusion: string
}

interface ParsedRecord {
    fields: string[]
    raw: string
}

const DONE_PREFIX = '__AISHELL_QUERY_DONE_'
const DEFAULT_TIMEOUT_MS = 35_000
const LOGIN_SCRIPTS_TIMEOUT_MS = 40_000

/**
 * AISHELL: 规则驱动的 SSH 日志查询执行器。
 * AI 不生成 shell；本服务负责找服务器、生成只读命令、捕获输出、解析路由并继续下一步。
 */
@Injectable({ providedIn: 'root' })
export class LogQueryOrchestrator {
    private events = new Subject<LogQueryEvent>()

    constructor (
        private profilesService: ProfilesService,
        private terminalContext: TerminalContextService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    get events$ () {
        return this.events.asObservable()
    }

    /** 从自然语言中提取明确的 task_id/cid；提取不到则返回 null，不猜示例值。 */
    static parseRequest (text: string): LogQueryRequest|null {
        const task = /(?:task[_ -]?id|任务(?:id|号))\s*[:=：]?\s*([A-Za-z0-9_-]+)/i.exec(text)
        const cid = /(?:cid|设备(?:id|标识))\s*[:=：]?\s*([A-Za-z0-9_-]+)/i.exec(text)
        if (!task?.[1] || !cid?.[1]) { return null }
        const date = /(?:日期|date|日志日)\s*[:=：]?\s*(20\d{2}[-/]?\d{2}[-/]?\d{2})/i.exec(text)?.[1]
        const appId = /(?:appid|app[_ -]?id)\s*[:=：]?\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1]
        return { taskId: task[1], cid: cid[1], date: normaliseDate(date), appId, mode: 'auto' }
    }

    /** 确认模式：每个模块执行前的确认钩子（返回 false 表示用户跳过，暂停查询） */
    private confirmStep: ((module: string, logType: string, command: string, lastInterpretation: string|null) => Promise<boolean>)|null = null

    async run (request: LogQueryRequest, options?: { confirmStep?: (module: string, logType: string, command: string, lastInterpretation: string|null) => Promise<boolean> }): Promise<LogQueryResult> {
        this.confirmStep = options?.confirmStep ?? null
        request = { ...request, date: normaliseDate(request.date) ?? dateFromTaskId(request.taskId) }
        const queryId = `logq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        const events: LogQueryEvent[] = []
        const emit = (event: Omit<LogQueryEvent, 'queryId'>) => {
            const full = { queryId, ...event }
            events.push(full)
            this.events.next(full)
        }

        const entry = initialModuleForTask(request.taskId)
        if (!entry) {
            const conclusion = `无法根据 task_id 前缀识别起始模块：${request.taskId}`
            emit({ phase: 'paused', message: conclusion })
            return { queryId, status: 'paused', events, conclusion }
        }

        try {
            const firstOutput = await this.runStep(request, entry, 'rp-bi', emit)
            const initial = this.records(firstOutput, request.cid)
            if (!initial.length) {
                const conclusion = `未找到 ${entry}/rp-bi 匹配日志，已暂停自动查询。请确认服务器、日期和 task_id/cid。`
                emit({ phase: 'paused', module: entry, logType: 'rp-bi', message: conclusion, output: firstOutput })
                return { queryId, status: 'paused', events, conclusion }
            }

            const first = initial[initial.length - 1].fields
            const deliveryType = first[3] ?? ''
            const next = first[9] ?? ''
            if (deliveryType === '1' || next === '0') {
                this.lastInterpretation = 'rp-bi 判断为在线下发'
                emit({ phase: 'parsing', module: entry, logType: 'rp-bi', message: '判断为在线下发，进入 im → cm → as。', output: firstOutput, interpretation: '在线下发', nextModule: 'im' })
                await this.runStep(request, 'im', 'rp-message', emit)
                await this.runStep(request, 'cm', 'rp-message', emit)
                const asOutput = await this.runStep(request, 'as', 'rp-message', emit)
                const conclusion = this.interpretAs(asOutput)
                emit({ phase: 'finished', module: 'as', logType: 'rp-message', message: conclusion, output: asOutput, interpretation: conclusion })
                return { queryId, status: 'finished', events, conclusion }
            }

            if (deliveryType !== '0') {
                const conclusion = `初始模块第 4 个字段为 ${deliveryType}，属于异常/终止状态，未继续跳转。`
                emit({ phase: 'finished', module: entry, logType: 'rp-bi', message: conclusion, output: firstOutput, interpretation: conclusion })
                return { queryId, status: 'finished', events, conclusion }
            }

            if (next === 'SDP') {
                return await this.runSdp(request, firstOutput, emit, events, queryId)
            }
            if (next === 'OMP') {
                return await this.runOmp(request, firstOutput, emit, events, queryId)
            }

            const conclusion = `初始模块第 10 个字段为 ${next || '(空)' }，规则库暂无法判断下一步。`
            emit({ phase: 'paused', module: entry, logType: 'rp-bi', message: conclusion, output: firstOutput })
            return { queryId, status: 'paused', events, conclusion }
        } catch (e: any) {
            const conclusion = e?.message ?? String(e)
            emit({ phase: 'failed', message: conclusion })
            this.notifications.error(this.translate.instant('Automatic log query failed'), conclusion)
            return { queryId, status: 'failed', events, conclusion }
        }
    }

    private async runSdp (request: LogQueryRequest, initialOutput: string, emit: (event: Omit<LogQueryEvent, 'queryId'>) => void, events: LogQueryEvent[], queryId: string): Promise<LogQueryResult> {
        const sdpOutput = await this.runStep(request, 'sdp', 'rp-command', emit)
        const sdpRecords = this.records(sdpOutput, request.cid)
        const success = sdpRecords.some(r => (r.fields[1] ?? '').includes('SUCCESS'))
        if (!success) {
            const conclusion = 'SDP 未发现 SUCCESS，判断为厂商下发前失败。'
            emit({ phase: 'finished', module: 'sdp', logType: 'rp-command', message: conclusion, output: sdpOutput, interpretation: conclusion })
            return { queryId, status: 'finished', events, conclusion }
        }

        const successCode = sdpRecords.map(r => r.fields[1] ?? '').find(code => VENDOR_SUCCESS_MODULES[code])
        if (!successCode) {
            const conclusion = 'SDP 已成功，但成功类型暂未配置厂商映射，已暂停并保留原始日志。'
            emit({ phase: 'paused', module: 'sdp', logType: 'rp-command', message: conclusion, output: sdpOutput })
            return { queryId, status: 'paused', events, conclusion }
        }
        const vendorModule = VENDOR_SUCCESS_MODULES[successCode]
        if (successCode === 'IOS_SUCCESS') {
            const apn = await this.runStep(request, 'apn', 'rp-bi', emit)
            const apns = await this.runStep(request, 'apns', 'rp-bi', emit)
            const ok = [...this.records(apn, request.cid), ...this.records(apns, request.cid)].some(r => (r.fields[1] ?? '') === 'ok')
            if (!ok) {
                const conclusion = 'APN/APNS 未发现 ok，判断为 iOS 厂商侧处理失败。'
                emit({ phase: 'finished', module: 'apn', logType: 'rp-bi', message: conclusion, output: `${apn}\n${apns}`, interpretation: conclusion })
                return { queryId, status: 'finished', events, conclusion }
            }
            // AISHELL: gpmrs 展示回执日志类型 gexin-bi-display（用户实测确认）
            await this.runStep(request, 'gpmrs', 'gexin-bi-display', emit)
            const asOutput = await this.runStep(request, 'as', 'rp-message', emit)
            const conclusion = this.interpretAs(asOutput)
            emit({ phase: 'finished', module: 'as', logType: 'rp-message', message: conclusion, output: asOutput, interpretation: conclusion })
            return { queryId, status: 'finished', events, conclusion }
        }

        const vendorOutput = await this.runStep(request, vendorModule, 'rp-bi', emit)
        if (this.records(vendorOutput, request.cid).length) {
            const gtprOutput = await this.runStep(request, 'gtpr', 'rp-bi', emit)
            const conclusion = `已查询 ${vendorModule} 和 gtpr 厂商回执。${this.interpretGtpr(gtprOutput)}`
            emit({ phase: 'finished', module: 'gtpr', logType: 'rp-bi', message: conclusion, output: gtprOutput, interpretation: conclusion })
            return { queryId, status: 'finished', events, conclusion }
        }
        const pushResult = await this.runStep(request, vendorModule, 'push-result', emit)
        const conclusion = `未发现 ${vendorModule}/rp-bi，已改查 push-result。${this.interpretPushResult(pushResult, vendorModule)}`
        emit({ phase: 'finished', module: vendorModule, logType: 'push-result', message: conclusion, output: pushResult, interpretation: conclusion })
        return { queryId, status: 'finished', events, conclusion }
    }

    private async runOmp (request: LogQueryRequest, initialOutput: string, emit: (event: Omit<LogQueryEvent, 'queryId'>) => void, events: LogQueryEvent[], queryId: string): Promise<LogQueryResult> {
        const ompOutput = await this.runStep(request, 'omp', 'rp-bi', emit)
        const records = this.records(ompOutput, request.cid)
        const hasZero = records.some(r => (r.fields[4] ?? '') === '0')
        if (records.length === 1 && (records[0].fields[4] ?? '') === '1') {
            const conclusion = 'OMP 只有一条记录且第 5 个字段为 1，离线库记录完成。'
            emit({ phase: 'finished', module: 'omp', logType: 'rp-bi', message: conclusion, output: ompOutput, interpretation: conclusion })
            return { queryId, status: 'finished', events, conclusion }
        }
        if (records.length > 1 && hasZero) {
            await this.runStep(request, 'im', 'rp-message', emit)
            await this.runStep(request, 'cm', 'rp-message', emit)
            const asOutput = await this.runStep(request, 'as', 'rp-message', emit)
            const conclusion = `OMP 存在离线重试/在线补发记录。${this.interpretAs(asOutput)}`
            emit({ phase: 'finished', module: 'as', logType: 'rp-message', message: conclusion, output: asOutput, interpretation: conclusion })
            return { queryId, status: 'finished', events, conclusion }
        }
        const conclusion = 'OMP 日志数量或字段组合无法由当前规则判断，已暂停自动查询。'
        emit({ phase: 'paused', module: 'omp', logType: 'rp-bi', message: conclusion, output: ompOutput })
        return { queryId, status: 'paused', events, conclusion }
    }

    private lastInterpretation: string|null = null

    private async runStep (request: LogQueryRequest, module: string, logType: string, emit: (event: Omit<LogQueryEvent, 'queryId'>) => void): Promise<string> {
        const step: LogQueryStep = { module, logType, command: this.buildCommand(request, module, logType) }
        if (this.confirmStep) {
            const ok = await this.confirmStep(module, logType, step.command, this.lastInterpretation)
            if (!ok) {
                throw new Error(`用户跳过 ${module}/${logType}，查询已暂停。`)
            }
        }
        this.lastInterpretation = null
        emit({ phase: 'opening', module, logType, command: step.command, message: `准备打开 ${module} 服务器。` })
        const tab = await this.getOrOpenTab(request, module)
        emit({ phase: 'running', module, logType, command: step.command, message: `已连接 ${this.terminalContext.describeTarget(tab)}，执行查询。` })
        const output = await this.executeCommand(tab, step.command)
        emit({ phase: 'parsing', module, logType, command: step.command, output, message: `已收到 ${module}/${logType} 查询结果。` })
        return output
    }

    /** AISHELL: 启动确认用的计划预览（起始模块/服务器/首条命令） */
    async previewFirstStep (request: LogQueryRequest): Promise<{ module: string, server: string, command: string }|null> {
        const entry = initialModuleForTask(request.taskId)
        if (!entry) { return null }
        const profile = await this.findProfile(request, entry)
        return {
            module: entry,
            server: profile?.name ?? '(未找到匹配服务器)',
            command: this.buildCommand({ ...request, date: normaliseDate(request.date) ?? dateFromTaskId(request.taskId) }, entry, 'rp-bi'),
        }
    }

    private buildCommand (request: LogQueryRequest, module: string, logType: string): string {
        const rule = LOG_MODULES[module]
        if (!rule || !allowedLogTypesFor(module).has(logType)) { throw new Error(`未配置日志模块或日志类型：${module}/${logType}`) }
        const datePart = request.date ? `${request.date}-` : ''
        const task = this.shellQuote(request.taskId)
        const cid = this.shellQuote(request.cid)
        return `zgrep -H -F -- ${task} "${rule.path}/${logType}-${datePart}"* | grep -F -- ${cid}`
    }

    private async getOrOpenTab (request: LogQueryRequest, module: string): Promise<BaseTerminalTabComponent<any>> {
        const profile = await this.findProfile(request, module)
        // 复用已打开的窗口（含连接中的，等待其就绪，避免重复开标签）
        const existing = this.findOpenTab(profile)
        if (existing) {
            await this.waitForTabReady(existing, profile?.name ?? module)
            if (existing.session?.open) { return existing }
        }
        if (!profile) { throw new Error(`没有找到 ${module} 对应的 SSH 服务器配置，请提供 server 或先配置该模块服务器。`) }
        await this.profilesService.launchProfile(profile)
        const deadline = Date.now() + DEFAULT_TIMEOUT_MS
        while (Date.now() < deadline) {
            const found = this.findOpenTab(profile)
            if (found) {
                await this.waitForTabReady(found, profile.name ?? module)
                if (found.session?.open) { return found }
            }
            await sleep(250)
        }
        throw new Error(`${module} SSH 服务器连接超时：${profile.name ?? module}`)
    }

    /** 等待会话 open + 登录脚本执行完毕（session.open 只是堡垒机认证完成，脚本还在敲 ssh/密码/cd） */
    private async waitForTabReady (tab: ConnectableTerminalTabComponent<any>, name: string): Promise<void> {
        const deadline = Date.now() + DEFAULT_TIMEOUT_MS
        while (Date.now() < deadline) {
            if (!this.terminalContext.getOpenTerminalTabs().includes(tab)) { return }
            if (tab.session?.open) { break }
            await sleep(200)
        }
        if (!tab.session?.open) { return }
        const done = (tab.session as any).loginScriptsDone$ as { toPromise (): Promise<void> }|null
        if (!done) { return }
        const finished = await Promise.race([
            firstValueFrom(done as any).then(() => true).catch(() => true),
            timer(LOGIN_SCRIPTS_TIMEOUT_MS).toPromise().then(() => false),
        ])
        if (!finished) {
            console.warn(`AIShell: ${name} 登录脚本 ${LOGIN_SCRIPTS_TIMEOUT_MS / 1000}s 未完成，继续执行查询（命令可能提前）`)
        }
    }

    private async findProfile (request: LogQueryRequest, module: string): Promise<PartialProfile<Profile>|null> {
        const profiles = await this.profilesService.getProfiles({ includeBuiltin: false, clone: false })
        if (request.server) {
            const exact = profiles.find(p => p.name === request.server || (p.options as any)?.host === request.server)
            if (exact) { return exact }
        }
        const candidates = profiles.filter(p => p.type === 'ssh' && this.profileMatchesModule(p, module))
        if (!candidates.length) { return null }
        // 优先复用已打开窗口对应的服务器（避免查错站点）
        const openIds = new Set(this.terminalContext.getOpenTerminalTabs().map(t => (t as any).profile?.id))
        return candidates.find(p => openIds.has(p.id)) ?? candidates[0]
    }

    private profileMatchesModule (profile: PartialProfile<Profile>, module: string): boolean {
        const group = profile.group ? this.profilesService.resolveProfileGroupPath(profile.group).join('/').toLowerCase() : ''
        const name = (profile.name ?? '').toLowerCase()
        const key = module.toLowerCase()
        return group === key || group.endsWith('/' + key) || name === key || name.includes(key)
    }

    private findOpenTab (profile: PartialProfile<Profile>|null): ConnectableTerminalTabComponent<any>|null {
        if (!profile) { return null }
        return this.terminalContext.getOpenTerminalTabs().find(tab => {
            const current: any = (tab as any).profile
            return current?.id === profile.id || current?.name === profile.name && current?.options?.host === (profile.options as any)?.host
        }) as ConnectableTerminalTabComponent<any> ?? null
    }

    private executeCommand (tab: BaseTerminalTabComponent<any>, command: string): Promise<string> {
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        const marker = `${DONE_PREFIX}${token}__`
        let output = ''
        let sub: Subscription|null = null
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                sub?.unsubscribe()
                reject(new Error(`命令执行超时：${command}`))
            }, DEFAULT_TIMEOUT_MS)
            sub = tab.binaryOutput$.subscribe(data => {
                output += data.toString('utf8')
                const idx = output.indexOf(marker)
                if (idx < 0) { return }
                clearTimeout(timer)
                sub?.unsubscribe()
                resolve(output.slice(0, idx).replace(/\r/g, ''))
            })
            // printf 只输出状态标记，不写文件；用于可靠判断命令何时结束。
            tab.sendInput(`${command}; printf '\\n${marker}%s\\n' "$?"\n`)
        })
    }

    private records (output: string, cid: string): ParsedRecord[] {
        return output.split(/\r?\n/).map(line => {
            const start = line.search(/20\d{2}[-/]\d{2}[-/]\d{2}/)
            return start >= 0 ? line.slice(start) : line
        }).filter(line => line.includes('|') && line.includes(cid)).map(raw => ({ raw, fields: raw.split('|') }))
    }

    // TODO(AISHELL): actionId 取第 7 个字段（split('|')[6]）为文档未注明的猜测位，需用真实 as/rp-message 日志核对一次
    private interpretAs (output: string): string {
        const records = output.split(/\r?\n/).filter(line => line.includes('|'))
        const actionIds = records.map(line => line.split('|')[6] ?? '').filter(Boolean)
        return actionIds.length ? `as 回执 actionId：${describeActionIds(actionIds)}` : 'as 已有日志但无法定位 actionId 字段（字段位未核对），请人工查看原始输出。'
    }

    // TODO(AISHELL): gtpr 字段位同样未与真实日志核对
    private interpretGtpr (output: string): string {
        const ids = output.split(/\r?\n/).map(line => line.split('|')[6] ?? '').filter(Boolean)
        const actionSummary = ids.length ? `厂商回执 actionId：${describeActionIds(ids)}` : 'gtpr 已有日志但无法定位回执字段（字段位未核对），请人工查看原始输出。'
        const codes = output.split(/\r?\n/).map(line => line.split('|')[5] ?? '').filter(Boolean)
        const codeParts = [...new Set(codes)].map(code => GTPR_CODES[code.trim()] ? `${code}(${GTPR_CODES[code.trim()]})` : null).filter(Boolean)
        return codeParts.length ? `${actionSummary}；gtpr code：${codeParts.join('、')}` : actionSummary
    }

    // TODO(AISHELL): push-result code 取第 10 个字段为猜测位，需用真实日志核对
    private interpretPushResult (output: string, module?: string): string {
        const codes = output.split(/\r?\n/).map(line => line.split('|')[9] ?? '').filter(Boolean)
        if (!codes.length) { return 'push-result 已有日志但无法定位 code 字段（字段位未核对），请人工查看原始输出。' }
        const parts = [...new Set(codes)].map(code => {
            const desc = module ? describeVendorCode(module, code) : null
            return desc ? `${code}(${desc})` : code
        })
        return `厂商请求 code：${parts.join('、')}`
    }

    private shellQuote (value: string): string {
        if (!/^[A-Za-z0-9_-]+$/.test(value)) { throw new Error('查询参数包含非法字符，已拒绝执行。') }
        return `'${value}'`
    }
}

function sleep (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
