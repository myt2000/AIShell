import { Component, ElementRef, ViewChild } from '@angular/core'
import { NgbModal, NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, TranslateService, ProfilesService, PlatformService, NotificationsService, PartialProfile, Profile } from 'tabby-core'

import { AiChatMessage, AiService } from '../services/ai.service'
import { TerminalContextService } from '../services/terminalContext.service'
import { BatchCommandService } from '../services/batchCommand.service'
import { LogQueryOrchestrator } from '../services/logQueryOrchestrator.service'
import { LogQueryRequest } from '../services/logQueryRules'
import { receiptCheatSheet } from '../services/logQueryCodes'
import { AiSettingsModalComponent } from './aiSettingsModal.component'
import { LogAnalysisModalComponent } from './logAnalysisModal.component'

interface AiAction {
    type: 'open_group' | 'open_profile' | 'run' | 'log_query'
    group?: string
    name?: string
    command?: string
    targets?: 'current' | 'all'
    task_id?: string
    cid?: string
    appid?: string
    date?: string
    server?: string
    mode?: 'auto' | 'confirm'
}

interface UiMessage {
    role: 'user' | 'assistant'
    content: string
    error?: boolean
    /** AISHELL: AI 回复中解析出的可执行动作（点按钮执行） */
    actions?: AiAction[]
    /** 动作执行状态：与 actions 下标对应 */
    executedActions?: boolean[]
}

function newId (): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface StoredConversation {
    id: string
    title: string
    updatedAt: number
    messages: UiMessage[]
}

/**
 * AI 助手对话窗口：
 * - 快捷动作：解释选中内容 / 诊断最近输出 / 分析日志 / 生成命令
 * - 自由提问；上下文自动附带当前终端信息（不含凭据）
 */
/** @hidden */
@Component({
    templateUrl: './aiAssistantModal.component.pug',
    styleUrls: ['./aiAssistantModal.component.scss'],
})
export class AiAssistantModalComponent extends BaseComponent {
    messages: UiMessage[] = []
    input = ''
    busy = false

    /** AISHELL: 会话持久化与历史 */
    currentConversationId = newId()
    /** AISHELL: 右侧会话侧栏展开状态（localStorage 持久化） */
    sidebarOpen = window.localStorage['aishell:ai-sidebar'] !== '0'
    historyList: StoredConversation[] = []
    /** 执行动作后自动回传终端输出让 AI 继续分析（Codex 式观察环） */
    autoAnalyze = window.localStorage['aishell:ai-autoanalyze'] !== '0'

    /** 打开时预置的首条请求（来自右键菜单） */
    presetPrompt: string|null = null

    @ViewChild('history') historyElement: ElementRef|undefined

    private systemPromptBase = '你是一名资深的 Linux 运维工程师助手。用户在使用 SSH 终端工具 AIShell 管理个推的服务器。回答使用中文，简洁准确；给出的命令要给出解释。\n\n' +
        '【环境约定】\n' +
        '1. 服务器按 业务站点/模块名 分文件夹管理（下面附完整清单）。\n' +
        '2. 每个模块的日志固定在 /app/newgetui/模块名/logs 目录（模块名即树中的文件夹名，如 gsmd 的日志在 /app/newgetui/gsmd/logs）。查日志的命令必须用该绝对路径，不要依赖当前目录。\n' +
        '3. 服务器登录账号为只读账号：只能查询，不能写入或修改。生成的命令必须全部是只读命令（cat/head/tail/grep/egrep/awk/sed -n/ls/find/df/du/ps/top/netstat/ss/stat/wc/cut/sort/uniq 等），严禁包含重定向(> >>)、管道写文件、tee、touch、mkdir、rm、mv、cp、chmod、chown、kill、sed -i、vi/vim、reboot、shutdown 等任何写入或变更类操作。\n' +
        '4. 按手机号/时间查短信日志的典型方式：grep "手机号" /app/newgetui/模块名/logs/对应日期文件（先用 ls 看文件名规律再 grep 也可以分两步）。\n\n' +
        '【动作标记】你可以让用户一键执行（点按钮确认后才执行，不会自动执行）：\n' +
        '打开某文件夹下全部服务器：<<ACTION>>{"type":"open_group","group":"文件夹名或路径"}<<END>>\n' +
        '连接某台服务器：<<ACTION>>{"type":"open_profile","name":"服务器名"}<<END>>\n' +
        '在终端窗口执行命令：<<ACTION>>{"type":"run","command":"命令","targets":"current或all"}<<END>>\n' +
        '自动查询推送日志：<<ACTION>>{"type":"log_query","task_id":"任务ID","cid":"设备CID(可选，用户给了才填)","mode":"auto"}<<END>>\n' +
'task_id 为必需参数（cid 可选：提供则精确到设备，不提供则按 task_id 全量匹配该任务的所有记录）。缺少 task_id 时才提示用户提供（建议同时给 cid/appid/推送时间/手机号），不要猜示例值。' +
        '涉及 task_id/cid 的消息下发查询时，优先只输出 log_query 动作，不要自行拼接多条 run 命令。log_query 会自动打开对应模块服务器、执行只读查询、解析结果并继续下一模块。动作标记之外不要输出其他 JSON。\n\n' +
        '【各厂商模块主查日志类型】华为(gtps-hw)/荣耀(gtps-ho)/鸿蒙(hps-hoshw)：rp-bi、rp-message、push-result、rp-broadcasting；OPPO(gtps-op)另含 rp-login；vivo(gtps-vv)：rp-bi、rp-message、push-result、rp-login；小米(gtps-xm)/魅族(gtps-mz)：rp-bi、rp-message、push-result；gtpr 主查 rp-bi；as 主查 rp-message；gpmrs 主查 gexin-bi-display；apn/apns 主查 rp-bi、rp-logout。\n' +
        receiptCheatSheet()

    constructor (
        public modalInstance: NgbActiveModal,
        private ai: AiService,
        private terminalContext: TerminalContextService,
        private profilesService: ProfilesService,
        private batch: BatchCommandService,
        private logQuery: LogQueryOrchestrator,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        // AISHELL: 恢复最近一次会话；有预置提问则开新会话
        const conversations = this.loadConversations()
        this.historyList = conversations
        if (!this.presetPrompt && conversations.length) {
            const latest = conversations[0]
            this.currentConversationId = latest.id
            this.messages = latest.messages ?? []
        }
        if (this.presetPrompt) {
            const prompt = this.presetPrompt
            this.presetPrompt = null
            setTimeout(() => this.submit(prompt))
        }
    }

    // AISHELL: ===== 会话持久化（localStorage，最多 50 条，单会话最多 200 条消息） =====

    private loadConversations (): StoredConversation[] {
        try {
            const list: StoredConversation[] = JSON.parse(window.localStorage['aishell:ai-conversations'] ?? '[]')
            return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : []
        } catch {
            return []
        }
    }

    private persistCurrent (): void {
        try {
            if (!this.messages.length) { return }
            const title = (this.messages.find(m => m.role === 'user')?.content ?? '会话').slice(0, 40)
            const list = this.loadConversations().filter(c => c.id !== this.currentConversationId)
            list.unshift({
                id: this.currentConversationId,
                title,
                updatedAt: Date.now(),
                messages: this.messages.slice(-200),
            })
            window.localStorage['aishell:ai-conversations'] = JSON.stringify(list.slice(0, 50))
            this.historyList = this.loadConversations()
        } catch (e) {
            console.warn('AIShell: failed to persist AI conversation', e)
        }
    }

    newConversation (): void {
        this.messages = []
        this.currentConversationId = newId()
    }

    openConversation (id: string): void {
        const conv = this.loadConversations().find(c => c.id === id)
        if (!conv) { return }
        this.currentConversationId = conv.id
        this.messages = conv.messages ?? []
        this.sidebarOpen = true
        this.scrollHistoryToBottom()
    }

    deleteConversation (id: string, event: MouseEvent): void {
        event.stopPropagation()
        const list = this.loadConversations().filter(c => c.id !== id)
        window.localStorage['aishell:ai-conversations'] = JSON.stringify(list)
        this.historyList = list
        if (id === this.currentConversationId) {
            this.newConversation()
        }
    }

    // AISHELL: 侧栏折叠切换（状态持久化）
    toggleSidebar (): void {
        this.sidebarOpen = !this.sidebarOpen
        window.localStorage['aishell:ai-sidebar'] = this.sidebarOpen ? '1' : '0'
    }

    toggleAutoAnalyze (): void {
        this.autoAnalyze = !this.autoAnalyze
        window.localStorage['aishell:ai-autoanalyze'] = this.autoAnalyze ? '1' : '0'
    }

    get hasSelection (): boolean {
        return !!this.terminalContext.getSelection(this.terminalContext.activeTerminalTab).trim()
    }

    openSettings (): void {
        this.ngbModal.open(AiSettingsModalComponent)
    }

    /** AISHELL: 多窗口日志分析工作台 */
    openLogAnalysis (): void {
        this.ngbModal.open(LogAnalysisModalComponent, { size: 'lg' })
    }

    /** AISHELL: Enter 发送、Shift+Enter 换行 */
    onEnterKey (event: KeyboardEvent): void {
        if (event.shiftKey) {
            return // 保留默认行为：插入换行
        }
        event.preventDefault()
        void this.submit()
    }

    private scrollHistoryToBottom (): void {
        setTimeout(() => {
            const el = this.historyElement?.nativeElement
            if (el) {
                el.scrollTop = el.scrollHeight
            }
        })
    }

    async submit (overridePrompt?: string): Promise<void> {
        const prompt = (overridePrompt ?? this.input).trim()
        if (!prompt || this.busy) { return }
        this.input = ''
        this.messages.push({ role: 'user', content: prompt })
        this.busy = true
        this.scrollHistoryToBottom()
        try {
            const answer = await this.ai.chat(this.buildChatMessages(prompt))
            const { content, actions } = this.parseActions(answer)
            const detected = LogQueryOrchestrator.parseRequest(prompt)
            // AI 未输出结构化动作时，使用本地参数识别兜底，避免退化为手工逐条执行。
            if (detected && !actions.some(action => action.type === 'log_query')) {
                actions.push(this.requestToAction(detected))
            }
            this.messages.push({ role: 'assistant', content, actions: actions.length ? actions : undefined, executedActions: actions.length ? [] : undefined })
        } catch (e: any) {
            this.messages.push({ role: 'assistant', content: e?.message ?? String(e), error: true })
        } finally {
            this.busy = false
            this.persistCurrent()
            this.scrollHistoryToBottom()
        }
    }

    private buildChatMessages (prompt: string): AiChatMessage[] {
        const tab = this.terminalContext.activeTerminalTab
        const target = this.terminalContext.describeTarget(tab)
        const contextParts: string[] = []
        if (target) {
            contextParts.push(`当前连接的服务器: ${target}`)
        }
        const openTabs = this.terminalContext.getOpenTerminalTabs().length
        contextParts.push(`当前已打开的终端窗口数: ${openTabs}`)

        // AISHELL: 注入服务器树分组清单（AI 据此知道有哪些文件夹可打开）
        try {
            const groups = this.profilesService.getSyncProfileGroups()
            const lines = groups.map(g => {
                const path = this.profilesService.resolveProfileGroupPath(g.id).join('/')
                const count = this.profilesService.collectGroupProfiles(g.id).length
                return `${path}(${count}台)`
            })
            if (lines.length) {
                contextParts.push('可用的服务器文件夹（名称/路径，含服务器数）：\n' + lines.join('\n'))
            }
        } catch {
            // 分组清单不可用时跳过
        }

        const system = this.systemPromptBase + '\n' + contextParts.join('\n')

        const history: AiChatMessage[] = this.messages
            .filter(m => !m.error)
            .slice(-6)
            .map(m => ({ role: m.role, content: m.content }))

        return [
            { role: 'system', content: system },
            ...history,
        ]
    }

    /** AISHELL: 从 AI 回复中解析动作标记并从正文剥离 */
    private parseActions (raw: string): { content: string, actions: AiAction[] } {
        const actions: AiAction[] = []
        const content = raw.replace(/<<ACTION>>([\s\S]*?)<<END>>/g, (_m, body) => {
            try {
                const action = JSON.parse(body.trim())
                if (action && typeof action.type === 'string') {
                    actions.push(action)
                }
            } catch {
                // 非法动作体忽略
            }
            return ''
        }).trim()
        return { content, actions }
    }

    /** 动作按钮文案 */
    actionLabel (action: AiAction): string {
        if (action.type === 'open_group') {
            return this.translate.instant('Connect all servers in "{group}"', { group: action.group ?? '' })
        }
        if (action.type === 'open_profile') {
            return this.translate.instant('Connect "{name}"', { name: action.name ?? '' })
        }
        if (action.type === 'run') {
            return action.targets === 'all'
                ? this.translate.instant('Run in all tabs: {command}', { command: action.command ?? '' })
                : this.translate.instant('Run in current tab: {command}', { command: action.command ?? '' })
        }
        if (action.type === 'log_query') {
            return this.translate.instant('Automatic log query: {taskId}', { taskId: action.task_id ?? '' })
        }
        return JSON.stringify(action)
    }

    /** 用户点击动作按钮 → 确认 → 执行 */
    async executeAction (message: UiMessage, index: number): Promise<void> {
        const action = message.actions?.[index]
        if (!action || message.executedActions?.[index]) { return }

        if (action.type === 'open_group') {
            const group = this.resolveGroup(action.group ?? '')
            if (!group) {
                this.notifications.error(this.translate.instant('Folder "{group}" not found', { group: action.group ?? '' }))
                return
            }
            const profiles = this.profilesService.collectGroupProfiles(group.id)
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Connect {n} servers in "{group}"?', { n: profiles.length, group: action.group ?? '' }),
                buttons: [this.translate.instant('Connect'), this.translate.instant('Cancel')],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }
            message.executedActions ??= []
            message.executedActions[index] = true
            for (const profile of profiles) {
                this.profilesService.launchProfile(profile as PartialProfile<Profile>)
                await new Promise(r => setTimeout(r, 700))
            }
            this.notifications.info(this.translate.instant('Opening {n} servers', { n: profiles.length }))
            return
        }

        if (action.type === 'open_profile') {
            const profile = (await this.profilesService.getProfiles()).find(p => p.name === action.name)
            if (!profile) {
                this.notifications.error(this.translate.instant('Server "{name}" not found', { name: action.name ?? '' }))
                return
            }
            message.executedActions ??= []
            message.executedActions[index] = true
            this.profilesService.launchProfile(profile)
            return
        }

        if (action.type === 'run' && action.command) {
            if (!AiAssistantModalComponent.isReadOnlySafe(action.command)) {
                this.notifications.error(
                    this.translate.instant('Command rejected: read-only account'),
                    action.command,
                )
                return
            }
            message.executedActions ??= []
            message.executedActions[index] = true
            const command = action.command
            if (action.targets === 'all') {
                // 复用批量命令（内置危险命令确认）
                void this.batch.runAgainstOpenTabs([command]).catch(e => this.notifications.error(String(e)))
            } else {
                const tab = this.terminalContext.activeTerminalTab
                if (tab) {
                    tab.sendInput(command + '\n')
                } else {
                    this.notifications.error(this.translate.instant('No open terminal tabs'))
                }
            }
            this.scheduleAutoAnalyze(command)
        }

        if (action.type === 'log_query') {
            const taskId = action.task_id ?? ''
            const cid = action.cid ?? ''
            if (!taskId) {
                this.notifications.error(this.translate.instant('Automatic log query requires task_id'))
                return
            }
            const request: LogQueryRequest = {
                taskId,
                cid,
                appId: action.appid,
                date: action.date,
                server: action.server,
                mode: action.mode ?? 'auto',
            }
            // 启动确认（自动模式同样必须确认一次，见规范 §11）
            const preview = await this.logQuery.previewFirstStep(request).catch(() => null)
            if (!preview) {
                this.notifications.error(this.translate.instant('Cannot resolve entry module for "{taskId}"', { taskId }))
                return
            }
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Start automatic log query?'),
                detail: this.translate.instant('Task: {taskId}\nDevice: {cid}\nEntry module: {module}\nServer: {server}\nFirst command:\n{command}', {
                    taskId,
                    cid: cid || this.translate.instant('(not provided — will match all records for this task)'),
                    module: preview.module,
                    server: preview.server,
                    command: preview.command,
                }),
                buttons: [
                    this.translate.instant('Start'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }

            message.executedActions ??= []
            message.executedActions[index] = true
            void this.runAutomaticLogQuery(request, message, index)
        }
    }

    private requestToAction (request: LogQueryRequest): AiAction {
        return {
            type: 'log_query',
            task_id: request.taskId,
            cid: request.cid,
            appid: request.appId,
            date: request.date,
            server: request.server,
            mode: request.mode,
        }
    }

    private async runAutomaticLogQuery (request: LogQueryRequest, message: UiMessage, index: number): Promise<void> {
        const confirmHook = request.mode === 'confirm'
            ? async (module: string, logType: string, command: string, lastInterpretation: string|null) => {
                const result = await this.platform.showMessageBox({
                    type: 'warning',
                    message: this.translate.instant('Execute this step?'),
                    detail: this.translate.instant('Module: {module}/{logType}\nCommand:\n{command}\nPrevious step: {prev}', {
                        module, logType, command, prev: lastInterpretation ?? '(none)',
                    }),
                    buttons: [
                        this.translate.instant('Execute'),
                        this.translate.instant('Skip'),
                    ],
                    defaultId: 0,
                    cancelId: 1,
                })
                return result.response === 0
            }
            : null

        const result = await this.logQuery.run(request, confirmHook ? { confirmStep: confirmHook } : undefined)

        if (result.status !== 'finished') {
            // 未完成（暂停/失败）恢复按钮，允许用户调整后重试
            message.executedActions ??= []
            message.executedActions[index] = false
        }

        const summary = result.events
            .filter(event => event.phase === 'parsing' || event.phase === 'finished' || event.phase === 'paused' || event.phase === 'failed')
            .map(event => `${event.module ? `${event.module}/${event.logType}: ` : ''}${event.message}`)
            .join('\n')
        if (summary) {
            this.messages.push({
                role: 'assistant',
                content: `自动日志查询${result.status === 'finished' ? '完成' : '已暂停'}：\n${summary}`,
                error: result.status === 'failed',
            })
            this.persistCurrent()
            this.scrollHistoryToBottom()

            // 完成后自动回传给 AI 出最终结论（每步输出截断，总量受控）
            if (result.status === 'finished') {
                const keyOutputs = result.events
                    .filter(e => e.phase === 'parsing' && e.output)
                    .map(e => `--- ${e.module}/${e.logType} ---\n${(e.output ?? '').trim().slice(-1500)}`)
                    .join('\n\n')
                    .slice(0, 10000)
                const conclusionPrompt = `[自动日志查询结果] 任务:${request.taskId} 设备:${request.cid}\n\n步骤摘要:\n${summary}\n\n关键原始输出:\n${keyOutputs || '(无)'}\n\n请根据以上结果给出最终结论：消息是否下发成功/送达，说明链路判断依据；若规则或字段无法判断，请明确指出需要人工核对什么。`
                void this.submit(conclusionPrompt)
            }
        }
    }

    /** AISHELL: Codex 式观察环——命令执行后延时抓取各窗口输出自动回传给 AI 继续分析 */
    private scheduleAutoAnalyze (command: string): void {
        if (!this.autoAnalyze) { return }
        setTimeout(() => {
            if (this.busy || !this.messages.length) { return }
            const tabs = this.terminalContext.getOpenTerminalTabs()
            if (!tabs.length) { return }
            const parts: string[] = []
            for (const tab of tabs.slice(0, 6)) {
                const output = this.terminalContext.getRecentOutput(tab, 60).trim()
                if (output) {
                    parts.push(`--- ${tab.title} ---\n${output.slice(-1200)}`)
                }
            }
            if (!parts.length) { return }
            void this.submit(`[自动回传] 刚才执行的命令 "${command}" 的各窗口输出如下，请结合此前的目标继续分析并给出结论/下一步：\n\n${parts.join('\n\n')}`)
        }, 9000)
    }

    /** AISHELL: 只读账号硬校验——剥离引号内容后检出写入/变更类操作即拒绝 */
    static isReadOnlySafe (command: string): boolean {
        const bare = command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')
        const forbidden = /(>>|>|\btee\b|\btouch\b|\bmkdir\b|\brmdir\b|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bchown\b|\bchattr\b|\bkill\b|\bpkill\b|\breboot\b|\bshutdown\b|\bhalt\b|\bdd\b|\bmkfs\b|sed +-i|\bvi\b|\bvim\b|\bnano\b|\byum\b|\bapt\b|find +-delete|-exec +rm)/i
        return !forbidden.test(bare)
    }

    private resolveGroup (query: string): { id: string }|null {
        const q = query.trim().toLowerCase()
        if (!q) { return null }
        const groups = this.profilesService.getSyncProfileGroups()
        const pathOf = (g: any) => this.profilesService.resolveProfileGroupPath(g.id).join('/').toLowerCase()
        return groups.find((g: any) => (g.name ?? '').toLowerCase() === q)
            ?? groups.find((g: any) => pathOf(g) === q)
            ?? groups.find((g: any) => pathOf(g).endsWith(q))
            ?? groups.find((g: any) => (g.name ?? '').toLowerCase().includes(q) || pathOf(g).includes(q))
            ?? null
    }

    // AISHELL: 快捷动作
    async explainSelection (): Promise<void> {
        const text = this.terminalContext.getSelection(this.terminalContext.activeTerminalTab).trim()
        if (!text) { return }
        await this.submit(this.translate.instant('Explain the following terminal output / command:') + '\n\n' + text.slice(0, 4000))
    }

    async diagnoseRecent (): Promise<void> {
        const tab = this.terminalContext.activeTerminalTab
        const output = this.terminalContext.getRecentOutput(tab, 150)
        await this.submit(this.translate.instant('Diagnose the recent terminal output below, find possible problems and give suggestions:') + '\n\n' + output.slice(-6000))
    }

    async analyzeLogs (): Promise<void> {
        const tab = this.terminalContext.activeTerminalTab
        const text = this.terminalContext.getSelection(tab).trim() || this.terminalContext.getRecentOutput(tab, 300)
        await this.submit(this.translate.instant('Analyze the logs below, summarize key events and anomalies:') + '\n\n' + text.slice(-8000))
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
