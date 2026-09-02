import { Injectable } from '@angular/core'
import { ConfigService, PartialProfile, Profile, ProfilesService } from 'tabby-core'

/** 一个节点在“模块信息”页面中的完整归属和状态。 */
export interface ServerInventoryRow {
    roomId: string
    room: string
    productId: string
    product: string
    moduleId: string
    module: string
    name: string
    jmxIp: string
    jmxPort: number|null
    alive: boolean
}

export interface ServerInventoryProgress {
    room: string
    product?: string
    module?: string
    page?: number
    pages?: number
    rows: number
}

export interface ServerInventorySyncResult {
    normal: number
    skippedAbnormal: number
    createdGroups: number
    createdProfiles: number
    updatedProfiles: number
    removedProfiles: number
}

export interface ServerInventoryOptions {
    /** 页面地址，例如 http://172.16.14.123:8080/ */
    baseUrl: string
    pageSize?: number
    username?: string
    password?: string
    signal?: AbortSignal
    onProgress?: (progress: ServerInventoryProgress) => void
}

interface ApiEnvelope<T> {
    errno?: number|string
    msg?: string
    data?: T
}

interface ListData<T> {
    list?: T[]
    total?: number
    totalPage?: number
}

interface IdName {
    id: string|number
    name: string
}

const ROOM_NAMES: Record<string, string> = {
    wxgj: '无锡国际',
    hzsd: '杭州三墩',
    bjmjq: '北京马驹桥',
}

/**
 * 读取模块信息页面的所有组合。该服务不依赖当前下拉框的选择状态，
 * 因而不会漏掉未选中的产品、模块或后续分页。
 */
@Injectable()
export class ServerInventoryService {
    private cookies = new Map<string, string>()

    constructor (
        private profilesService: ProfilesService,
        private config: ConfigService,
    ) { }

    async crawl (options: ServerInventoryOptions): Promise<ServerInventoryRow[]> {
        const baseUrl = options.baseUrl.replace(/\/+$/, '')
        const pageSize = Math.max(1, Math.floor(options.pageSize ?? 100))
        const rows: ServerInventoryRow[] = []
        const seen = new Set<string>()
        this.cookies.clear()

        if (options.username?.trim() && options.password) {
            await this.login(baseUrl, options.username.trim(), options.password, options.signal)
        }

        const rooms = await this.post<ListData<string>|string[]>(baseUrl, '/monitor/admin/getIdcs', {}, options.signal)
        const roomIds = this.toRoomIds(rooms)
        for (const roomId of roomIds) {
            const roomName = ROOM_NAMES[roomId] ?? roomId
            this.progress(options, { room: roomName, rows: rows.length })

            const products = await this.post<ListData<IdName>|IdName[]>(baseUrl, '/monitor/v1/dropDownList/productList', { idc: roomId }, options.signal)
            for (const product of this.toList(products)) {
                const productId = String(product.id)
                this.progress(options, { room: roomName, product: product.name, rows: rows.length })

                const modules = await this.post<ListData<IdName>|IdName[]>(baseUrl, '/monitor/v1/dropDownList/moduleList', { idc: roomId, productId }, options.signal)
                for (const module of this.toList(modules)) {
                    const moduleId = String(module.id)
                    const first = await this.post<ListData<any>|any[]>(baseUrl, '/monitor/v1/configuration/instance/query', {
                        idc: roomId,
                        jmxIp: '',
                        moduleId,
                        pageNo: 1,
                        pageSize,
                    }, options.signal)
                    const firstData = this.toPage(first)
                    const pages = this.pageCount(firstData, pageSize)
                    this.progress(options, { room: roomName, product: product.name, module: module.name, page: 1, pages, rows: rows.length })
                    this.appendRows(rows, seen, roomId, roomName, product, module, firstData.list ?? [])

                    for (let page = 2; page <= pages; page++) {
                        const result = await this.post<ListData<any>|any[]>(baseUrl, '/monitor/v1/configuration/instance/query', {
                            idc: roomId,
                            jmxIp: '',
                            moduleId,
                            pageNo: page,
                            pageSize,
                        }, options.signal)
                        const data = this.toPage(result)
                        this.appendRows(rows, seen, roomId, roomName, product, module, data.list ?? [])
                        this.progress(options, { room: roomName, product: product.name, module: module.name, page, pages, rows: rows.length })
                        if (!data.list?.length) { break }
                    }
                }
            }
        }
        return rows
    }

    private async login (baseUrl: string, username: string, password: string, signal?: AbortSignal): Promise<void> {
        const crypto = window['nodeRequire']?.('crypto')
        if (!crypto?.pbkdf2Sync) {
            throw new Error('当前运行环境不支持监控平台密码加密，请使用免安装版启动。')
        }
        const encoded = crypto.pbkdf2Sync(
            password,
            'e6751eadaefc7af085fa0f9e047cfce6d2cce0cb95706ed5f9a0422b28f64407',
            100,
            64,
            'sha512',
        ).toString('hex')
        await this.post(baseUrl, '/monitor/admin/login', {
            username,
            password: encoded,
            code: '',
            pid: '',
            stratery: '',
        }, signal)
    }

    /** UTF-8 BOM makes the exported file open correctly in Chinese Excel. */
    toCsv (rows: ServerInventoryRow[]): string {
        const headers = ['机房', '机房ID', '产品', '产品ID', '模块', '模块ID', '节点名称', 'JMX地址', 'JMX端口', '连接状态']
        const values = rows.map(row => [
            row.room, row.roomId, row.product, row.productId, row.module, row.moduleId,
            row.name, row.jmxIp, row.jmxPort == null ? '' : String(row.jmxPort), row.alive ? '正常' : '异常',
        ])
        return '\ufeff' + [headers, ...values].map(line => line.map(value => this.csvCell(value)).join(',')).join('\r\n') + '\r\n'
    }

    /** 将正常节点生成到“机房/产品/模块”树，只清理本工具以前生成的 profile。 */
    async syncProfiles (rows: ServerInventoryRow[]): Promise<ServerInventorySyncResult> {
        const normalRows = rows.filter(row => row.alive && row.jmxIp)
        const skippedAbnormal = rows.length - normalRows.length
        const login = this.readLoginConfig()
        const groups = this.profilesService.getSyncProfileGroups()
        const groupMap = new Map<string, string>()
        for (const group of groups) {
            groupMap.set(`${group.parentGroupId ?? ''}\u0000${group.name}`, group.id)
        }
        let createdGroups = 0
        const getGroup = async (name: string, parentGroupId?: string): Promise<string> => {
            const key = `${parentGroupId ?? ''}\u0000${name}`
            const existing = groupMap.get(key)
            if (existing) { return existing }
            const group: any = { name }
            if (parentGroupId) { group.parentGroupId = parentGroupId }
            await this.profilesService.newProfileGroup(group)
            groupMap.set(key, group.id)
            createdGroups++
            return group.id
        }

        const profiles = await this.profilesService.getProfiles({ includeBuiltin: false, clone: true })
        const knownTargetIps = new Set(rows.map(row => row.jmxIp).filter(Boolean))
        const templates = new Map<string, any>()
        for (const profile of profiles) {
            // 同步生成的旧 profile 可能把目标 IP 错写成了 SSH host，不能拿它作为堡垒机模板。
            if ((profile.options as any)?.['aishell:syncSource'] === 'module-info') { continue }
            const path = profile.group ? this.profilesService.resolveProfileGroupPath(profile.group).map(x => x.toLowerCase()) : []
            const module = path[path.length - 1]
            const host = String((profile.options as any)?.host ?? '')
            if (module && host && !knownTargetIps.has(host) && !templates.has(module) && profile.type === 'ssh') {
                templates.set(module, profile)
            }
        }
        const bastionTemplate = [...templates.values()].find(profile => String(profile.options?.host ?? '').trim())
            ?? profiles.find(profile => profile.type === 'ssh' && !knownTargetIps.has(String((profile.options as any)?.host ?? '')))
        const templateHost = String((bastionTemplate?.options as any)?.host ?? '').trim()
        if (!templateHost && Object.keys(login.bastionHosts).length === 0) {
            throw new Error('未找到堡垒机地址，请先保留一个已有的 SSH 配置作为模板。')
        }

        const managed = new Map<string, PartialProfile<Profile>>()
        for (const profile of this.config.store.profiles) {
            const key = (profile.options as any)?.['aishell:syncKey']
            if (key) { managed.set(String(key), profile) }
        }
        let removedProfiles = 0
        for (const profile of this.config.store.profiles.filter(p => (p.options as any)?.['aishell:syncSource'] === 'module-info')) {
            if (!normalRows.some(row => this.syncKey(row) === String((profile.options as any)?.['aishell:syncKey']))) {
                await this.profilesService.deleteProfile(profile)
                removedProfiles++
            }
        }

        let createdProfiles = 0
        let updatedProfiles = 0
        for (const row of normalRows) {
            const roomGroup = await getGroup(row.room)
            const productGroup = await getGroup(row.product, roomGroup)
            const moduleGroup = await getGroup(row.module, productGroup)
            const key = this.syncKey(row)
            const old = managed.get(key)
            const template = templates.get(row.module.toLowerCase())
            const options: any = template ? JSON.parse(JSON.stringify(template.options ?? {})) : {}
            const bastionHost = login.bastionHosts[row.room] ?? login.bastionHosts[row.roomId] ?? templateHost
            if (!bastionHost) {
                throw new Error(`login.env 未配置“${row.room}”的堡垒机 IP。`)
            }
            options.host = bastionHost
            options.port = 22
            options.user = login.bastionUser
            options.password = login.bastionPassword
            options['aishell:syncSource'] = 'module-info'
            options['aishell:syncKey'] = key
            options.scripts = [
                { expect: 'Clone last session', send: 'n', flexible: true },
                { expect: '$', send: `ssh ${login.targetUser}@${row.jmxIp}`, flexible: true },
                { expect: 'assword[:：]', isRegex: true, send: login.targetPassword, secret: true },
                { expect: '$', send: `cd /app/newgetui/${row.module}/logs` },
            ]
            const profile: any = {
                type: 'ssh',
                name: row.jmxIp,
                group: moduleGroup,
                options,
            }
            if (old) {
                profile.id = old.id
                await this.profilesService.writeProfile(profile)
                updatedProfiles++
            } else {
                await this.profilesService.newProfile(profile)
                createdProfiles++
            }
        }
        await this.config.save()
        return { normal: normalRows.length, skippedAbnormal, createdGroups, createdProfiles, updatedProfiles, removedProfiles }
    }

    /** 从项目根目录或免安装版附近读取 login.env，不在日志或界面中输出密码。 */
    private readLoginConfig (): { bastionUser: string, bastionPassword: string, targetUser: string, targetPassword: string, bastionHosts: Record<string, string> } {
        const nodeRequire = window['nodeRequire']
        if (!nodeRequire) { throw new Error('当前运行环境无法读取 login.env，请使用免安装版启动。') }
        const fs = nodeRequire('fs')
        const path = nodeRequire('path')
        const processModule = nodeRequire('process')
        const candidates: string[] = []
        const addParents = (start: string) => {
            let current = start
            for (let i = 0; i < 6; i++) {
                candidates.push(path.join(current, 'login.env'))
                const parent = path.dirname(current)
                if (parent === current) { break }
                current = parent
            }
        }
        addParents(processModule.cwd())
        addParents(path.dirname(processModule.execPath))
        const file = candidates.find(candidate => fs.existsSync(candidate))
        if (!file) { throw new Error('未找到 login.env，请将它放在项目根目录或 Tabby 免安装目录上级。') }
        const values: Record<string, string> = {}
        for (const raw of String(fs.readFileSync(file, 'utf8')).replace(/^\ufeff/, '').split(/\r?\n/)) {
            const line = raw.trim()
            if (!line || line.startsWith('#') || line.startsWith(';')) { continue }
            const match = line.match(/^([^:=：]+)\s*[:=：]\s*(.*)$/)
            if (!match) { continue }
            values[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
        }
        const find = (...names: string[]) => names.map(name => values[name]).find(value => value !== undefined && value !== '') ?? ''
        const result = {
            bastionUser: find('堡垒机用户名', '堡垒机用户', 'bastionUser', 'BASTION_USER'),
            bastionPassword: find('堡垒机密码', 'bastionPassword', 'BASTION_PASSWORD'),
            targetUser: find('目标服务器用户名', '目标服务器用户', 'targetUser', 'TARGET_USER'),
            targetPassword: find('目标服务器密码', 'targetPassword', 'TARGET_PASSWORD'),
            bastionHosts: {
                '杭州三墩': find('杭州三墩堡垒机IP', '杭州三墩堡垒机地址', 'bastion.hzsd', 'BASTION_HZSD'),
                '北京马驹桥': find('北京马驹桥堡垒机IP', '北京马驹桥堡垒机地址', 'bastion.bjmjq', 'BASTION_BJMJQ'),
                '无锡国际': find('无锡国际堡垒机IP', '无锡国际堡垒机地址', 'bastion.wxgj', 'BASTION_WXGJ'),
                hzsd: find('杭州三墩堡垒机IP', '杭州三墩堡垒机地址', 'bastion.hzsd', 'BASTION_HZSD'),
                bjmjq: find('北京马驹桥堡垒机IP', '北京马驹桥堡垒机地址', 'bastion.bjmjq', 'BASTION_BJMJQ'),
                wxgj: find('无锡国际堡垒机IP', '无锡国际堡垒机地址', 'bastion.wxgj', 'BASTION_WXGJ'),
            },
        }
        if (!result.bastionUser || !result.bastionPassword || !result.targetUser || !result.targetPassword) {
            throw new Error('login.env 缺少堡垒机或目标服务器登录配置，请检查四个字段是否完整。')
        }
        return result
    }

    private syncKey (row: ServerInventoryRow): string {
        return [row.roomId, row.productId, row.moduleId, row.name, row.jmxIp].join('/')
    }

    private async post<T> (baseUrl: string, path: string, body: Record<string, any>, signal?: AbortSignal): Promise<T> {
        const nodeRequire = window['nodeRequire']
        if (nodeRequire) {
            return this.nodePost<T>(baseUrl + path, body, signal)
        }
        const response = await fetch(baseUrl + path, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
        })
        if (!response.ok) {
            throw new Error(`服务器接口 ${path} 返回 HTTP ${response.status}`)
        }
        const envelope = await response.json() as ApiEnvelope<T>
        if (envelope.errno !== undefined && String(envelope.errno) !== '0') {
            throw new Error(envelope.msg || `服务器接口 ${path} 返回错误码 ${envelope.errno}`)
        }
        return (envelope.data ?? envelope) as T
    }

    /** Electron 渲染进程的 fetch 可能受跨域 Cookie 策略影响，使用 Node HTTP 手动维护会话。 */
    private nodePost<T> (urlText: string, body: Record<string, any>, signal?: AbortSignal): Promise<T> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(urlText)
            const nodeRequire = window['nodeRequire']
            const client = nodeRequire(parsed.protocol === 'https:' ? 'https' : 'http')
            const payload = JSON.stringify(body)
            const cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
            const request = client.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || undefined,
                path: `${parsed.pathname}${parsed.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...(cookie ? { Cookie: cookie } : {}),
                },
            }, (response: any) => {
                for (const header of response.headers['set-cookie'] ?? []) {
                    const match = String(header).match(/^([^=]+)=([^;]*)/)
                    if (match) { this.cookies.set(match[1], match[2]) }
                }
                let text = ''
                response.setEncoding('utf8')
                response.on('data', (chunk: string) => text += chunk)
                response.on('end', () => {
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`服务器接口返回 HTTP ${response.statusCode}`))
                        return
                    }
                    try {
                        const envelope = JSON.parse(text) as ApiEnvelope<T>
                        if (envelope.errno !== undefined && String(envelope.errno) !== '0') {
                            reject(new Error(envelope.msg || `服务器接口返回错误码 ${envelope.errno}`))
                            return
                        }
                        resolve((envelope.data ?? envelope) as T)
                    } catch {
                        reject(new Error('服务器接口返回了无法解析的数据'))
                    }
                })
            })
            request.on('error', reject)
            if (signal) {
                if (signal.aborted) { request.destroy(); reject(new Error('请求已取消')); return }
                signal.addEventListener('abort', () => request.destroy(new Error('请求已取消')), { once: true })
            }
            request.write(payload)
            request.end()
        })
    }

    private toRoomIds (value: ListData<string>|string[]): string[] {
        const list = Array.isArray(value) ? value : value.list ?? []
        return list.map(item => typeof item === 'string' ? item : String(item)).filter(Boolean)
    }

    private toList (value: ListData<IdName>|IdName[]): IdName[] {
        const list = Array.isArray(value) ? value : value.list ?? []
        return list.filter(item => item && item.id !== undefined).map(item => ({ id: item.id, name: String(item.name ?? item.id) }))
    }

    private toPage (value: ListData<any>|any[]): ListData<any> {
        return Array.isArray(value) ? { list: value } : value ?? {}
    }

    private pageCount (data: ListData<any>, pageSize: number): number {
        if (Number.isFinite(data.totalPage) && Number(data.totalPage) > 0) { return Number(data.totalPage) }
        if (Number.isFinite(data.total) && Number(data.total) > 0) { return Math.max(1, Math.ceil(Number(data.total) / pageSize)) }
        return data.list?.length ? 1 : 0
    }

    private appendRows (target: ServerInventoryRow[], seen: Set<string>, roomId: string, room: string, product: IdName, module: IdName, nodes: any[]): void {
        for (const node of nodes) {
            const jmxIp = String(node.jmxIp ?? '').trim()
            const name = String(node.name ?? '').trim()
            const key = [roomId, product.id, module.id, name, jmxIp, node.jmxPort ?? ''].join('|')
            if (!jmxIp && !name || seen.has(key)) { continue }
            seen.add(key)
            const port = Number(node.jmxPort)
            target.push({
                roomId,
                room,
                productId: String(product.id),
                product: String(product.name),
                moduleId: String(module.id),
                module: String(module.name),
                name,
                jmxIp,
                jmxPort: Number.isFinite(port) ? port : null,
                alive: Boolean(node.alive),
            })
        }
    }

    private progress (options: ServerInventoryOptions, progress: ServerInventoryProgress): void {
        options.onProgress?.(progress)
    }

    private csvCell (value: unknown): string {
        const text = String(value ?? '')
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
}
