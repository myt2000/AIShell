import * as keytar from 'keytar'
import { Injectable } from '@angular/core'

import { ConfigService, NotificationsService, TranslateService } from 'tabby-core'

/** 跳转目标机密码的凭据条目（全局单条，所有堡垒机会话共用） */
export const TARGET_PASSWORD_SERVICE = 'AIShell:target-jump'
export const TARGET_PASSWORD_ACCOUNT = 'jump'

/** AISHELL: 服务器清单同步的三类密码凭据条目（account 区分用途） */
export const INVENTORY_PASSWORD_SERVICE = 'AIShell:inventory'
export type InventoryPasswordKind = 'platform' | 'bastion' | 'target'

/**
 * AISHELL: 密码安全存储（SecureCRT 式）。
 * 所有密码存入系统凭据管理器（Windows Credential Manager / macOS Keychain），
 * 绑定当前系统用户，配置文件中不留明文：
 * - SSH 连接密码（堡垒机/直连）：条目 `AIShell:ssh@host:port`，账户为用户名
 * - 登录脚本跳转密码：脚本 send 引用 $TARGET_PASSWORD 变量，实值在凭据管理器
 * 首次启动自动迁移历史明文配置（一次性，localStorage 标记）。
 */
@Injectable({ providedIn: 'root' })
export class SecurePasswordService {

    constructor (
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    private sshKey (host: string, port?: number): string {
        return `AIShell:ssh@${host}:${port ?? 22}`
    }

    async setSshPassword (host: string, port: number|undefined, user: string, password: string): Promise<void> {
        await keytar.setPassword(this.sshKey(host, port), user, password)
    }

    async getSshPassword (host: string, port: number|undefined, user: string): Promise<string|null> {
        try {
            return await keytar.getPassword(this.sshKey(host, port), user)
        } catch {
            return null
        }
    }

    async setTargetPassword (password: string): Promise<void> {
        await keytar.setPassword(TARGET_PASSWORD_SERVICE, TARGET_PASSWORD_ACCOUNT, password)
    }

    async getTargetPassword (): Promise<string|null> {
        try {
            return await keytar.getPassword(TARGET_PASSWORD_SERVICE, TARGET_PASSWORD_ACCOUNT)
        } catch {
            return null
        }
    }

    /** AISHELL: 服务器清单同步的密码存取（platform=监控平台 / bastion=堡垒机 / target=目标机） */
    async setInventoryPassword (kind: InventoryPasswordKind, password: string): Promise<void> {
        await keytar.setPassword(INVENTORY_PASSWORD_SERVICE, kind, password)
    }

    async getInventoryPassword (kind: InventoryPasswordKind): Promise<string|null> {
        try {
            return await keytar.getPassword(INVENTORY_PASSWORD_SERVICE, kind)
        } catch {
            return null
        }
    }

    /** 登录脚本中的密码步骤是否已引用安全变量 */
    static isScriptPasswordSecured (script: any): boolean {
        return typeof script?.send === 'string' && script.send.includes('$TARGET_PASSWORD')
    }

    /**
     * 一次性迁移：把 config 里的明文密码移入凭据管理器并从配置中删除。
     * - profile.options.password → AIShell:ssh@host:port（按 host/port/user 去重）
     * - 登录脚本密码步骤明文 → $TARGET_PASSWORD 变量 + 实值入凭据管理器
     * 幂等：localStorage 标记，完成后续次启动直接跳过。
     */
    async migrateIfNeeded (): Promise<void> {
        if (window.localStorage['aishell:securePasswords'] === '1') {
            return
        }
        try {
            // 插件构造早于配置加载完成，必须等 ready 再读 store
            await this.config.ready$.toPromise()
            const profiles: any[] = (this.config.store as any).profiles ?? []
            let migratedSsh = 0
            let migratedScripts = 0
            let targetPassword: string|null = null

            for (const profile of profiles) {
                const options = profile.options ?? {}
                if (profile.type === 'ssh' && options.password) {
                    if (options.host && options.user) {
                        await this.setSshPassword(options.host, options.port, options.user, options.password)
                        migratedSsh++
                    }
                    delete options.password
                }
                for (const script of options.scripts ?? []) {
                    if (this.isPasswordScript(script) && !SecurePasswordService.isScriptPasswordSecured(script) && script.send) {
                        targetPassword ??= script.send
                        script.send = '$TARGET_PASSWORD'
                        script.secret = true
                        migratedScripts++
                    }
                }
            }

            if (targetPassword) {
                await this.setTargetPassword(targetPassword)
            }
            if (migratedSsh || migratedScripts) {
                await this.config.save()
                this.notifications.info(
                    this.translate.instant('Passwords secured'),
                    this.translate.instant('{n} SSH passwords and {m} script passwords moved to system credential storage. Config file no longer contains plaintext passwords.', { n: migratedSsh, m: migratedScripts }),
                )
            }
            window.localStorage['aishell:securePasswords'] = '1'
        } catch (e) {
            console.error('AIShell secure password migration failed:', e)
        }
    }

    private isPasswordScript (script: any): boolean {
        return /assword|密码/i.test(script?.expect ?? '')
    }

    /**
     * AISHELL: login.env → 设置一次性迁移（服务器清单同步凭据）。
     * 按候选路径找 login.env：读到则非敏键（用户名/堡垒机 IP）写配置、三密码写凭据管理器；
     * 读不到（文件不存在/已删）也置 migrated，此后不再依赖文件。
     * 返回 true 表示本次实际导入。
     */
    async migrateLoginEnvIfNeeded (): Promise<boolean> {
        const inventory = (this.config.store as any).aishell?.inventory
        if (!inventory || inventory.migrated) {
            return false
        }
        let imported = false
        try {
            const env = readLoginEnvFile()
            if (env) {
                inventory.platformUser ||= env.bastionPlatformUser ?? ''
                inventory.bastionUser ||= env.bastionUser ?? ''
                inventory.targetUser ||= env.targetUser ?? ''
                for (const [roomId, host] of Object.entries(env.bastionHosts)) {
                    if (host && inventory.bastionHosts && !inventory.bastionHosts[roomId]) {
                        inventory.bastionHosts[roomId] = host
                    }
                }
                if (env.bastionPassword) { await this.setInventoryPassword('bastion', env.bastionPassword) }
                if (env.targetPassword) { await this.setInventoryPassword('target', env.targetPassword) }
                await this.config.save()
                imported = true
            }
        } catch (e) {
            console.error('AIShell login.env migration failed:', e)
        } finally {
            inventory.migrated = true
            try { await this.config.save() } catch { /* 保存失败不影响流程 */ }
        }
        return imported
    }
}

/** login.env 解析结果（仅本模块与迁移用；键名与 ServerInventoryService 的 readLoginConfig 对齐） */
interface LoginEnvData {
    bastionUser?: string
    bastionPassword?: string
    targetUser?: string
    targetPassword?: string
    bastionPlatformUser?: string
    bastionHosts: Record<string, string>
}

/** 独立的 login.env 文件定位与解析（与 ServerInventoryService 候选路径一致），供迁移使用 */
function readLoginEnvFile (): LoginEnvData|null {
    try {
        const nodeRequire = (window as any)['nodeRequire']
        if (!nodeRequire) { return null }
        const fs = nodeRequire('fs')
        const path = nodeRequire('path')
        const os = nodeRequire('os')
        const processModule = nodeRequire('process')
        const candidates: string[] = []
        if (processModule.env?.TABBY_CONFIG_DIRECTORY) {
            candidates.push(path.join(processModule.env.TABBY_CONFIG_DIRECTORY, 'login.env'))
        }
        candidates.push(path.join(os.homedir(), '.aishell', 'login.env'))
        if (processModule.resourcesPath) {
            candidates.push(path.join(processModule.resourcesPath, 'login.env'))
        }
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
        if (!file) { return null }

        const values: Record<string, string> = {}
        for (const raw of String(fs.readFileSync(file, 'utf8')).replace(/^\ufeff/, '').split(/\r?\n/)) {
            const line = raw.trim()
            if (!line || line.startsWith('#') || line.startsWith(';')) { continue }
            const sep = line.search(/[:=：：]/)
            if (sep < 0) { continue }
            const key = line.slice(0, sep).trim()
            const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '')
            if (key) { values[key] = value }
        }
        const pick = (...keys: string[]) => keys.map(k => values[k]).find(v => !!v)
        return {
            bastionUser: pick('堡垒机用户名', '堡垒机用户', 'bastionUser', 'BASTION_USER'),
            bastionPassword: pick('堡垒机密码', 'bastionPassword', 'BASTION_PASSWORD'),
            targetUser: pick('目标服务器用户名', '目标服务器用户', 'targetUser', 'TARGET_USER'),
            targetPassword: pick('目标服务器密码', 'targetPassword', 'TARGET_PASSWORD'),
            bastionPlatformUser: pick('监控平台账号', '平台账号', 'platformUser'),
            bastionHosts: {
                hzsd: pick('杭州三墩堡垒机IP', '杭州三墩堡垒机地址', 'bastion.hzsd', 'BASTION_HZSD') ?? '',
                bjmjq: pick('北京马驹桥堡垒机IP', '北京马驹桥堡垒机地址', 'bastion.bjmjq', 'BASTION_BJMJQ') ?? '',
                wxgj: pick('无锡国际堡垒机IP', '无锡国际堡垒机地址', 'bastion.wxgj', 'BASTION_WXGJ') ?? '',
            },
        }
    } catch {
        return null
    }
}
