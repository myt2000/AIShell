import * as keytar from 'keytar'
import { Injectable } from '@angular/core'

import { ConfigService, NotificationsService, TranslateService } from 'tabby-core'

/** 跳转目标机密码的凭据条目（全局单条，所有堡垒机会话共用） */
export const TARGET_PASSWORD_SERVICE = 'AIShell:target-jump'
export const TARGET_PASSWORD_ACCOUNT = 'jump'

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
}
