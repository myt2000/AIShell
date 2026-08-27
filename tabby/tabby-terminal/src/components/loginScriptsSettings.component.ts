/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as keytar from 'keytar'
import { Component, Input } from '@angular/core'

import { PlatformService, TranslateService } from 'tabby-core'
import { LoginScript, LoginScriptsOptions } from '../middleware/loginScriptProcessing'

/** @hidden */
@Component({
    selector: 'login-scripts-settings',
    templateUrl: './loginScriptsSettings.component.pug',
})
export class LoginScriptsSettingsComponent {
    @Input() options: LoginScriptsOptions
    scripts: LoginScript[]
    /** AISHELL: 密码行新输入值（只写不读：已存密码永不回显） */
    newPasswords = new Map<LoginScript, string>()

    constructor (
        private platform: PlatformService,
        private translate: TranslateService,
    ) { }

    ngOnInit () {
        this.scripts = this.options.scripts
    }

    /** AISHELL: 密码行——显式标记，或 expect 匹配 password/密码 自动识别 */
    isSecret (script: LoginScript): boolean {
        if (script.secret !== undefined) { return script.secret }
        return /assword|密码/i.test(script.expect ?? '')
    }

    /** 手动切换隐藏；取消隐藏即清空（SecureCRT 式），需重新输入 */
    toggleSecret (script: LoginScript): void {
        script.secret = !this.isSecret(script)
        this.newPasswords.delete(script)
        if (!script.secret) {
            script.send = ''
        }
    }

    passwordPlaceholder (script: LoginScript): string {
        return script.send ? this.translate.instant('Stored securely — type to replace') : this.translate.instant('Password')
    }

    async deleteScript (script: LoginScript) {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete this script?'),
                detail: script.expect,
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )).response === 0) {
            this.scripts = this.scripts.filter(x => x !== script)
        }
    }

    addScript () {
        this.scripts.push({ expect: '', send: '' })
    }

    async save (): Promise<void> {
        // AISHELL: 密码行保存——新输入写入系统凭据管理器，脚本仅保留 $TARGET_PASSWORD 引用；
        // 未动过的历史明文在此一并归一化（明文不再落配置文件）
        let newTarget: string|null = null
        for (const script of this.scripts) {
            if (!this.isSecret(script)) { continue }
            const typed = this.newPasswords.get(script)
            if (typed) {
                newTarget = typed
                script.send = '$TARGET_PASSWORD'
            } else if (script.send && !script.send.includes('$TARGET_PASSWORD')) {
                newTarget ??= script.send
                script.send = '$TARGET_PASSWORD'
            }
        }
        if (newTarget) {
            try {
                await keytar.setPassword('AIShell:target-jump', 'jump', newTarget)
            } catch (e) {
                console.error('AIShell: failed to store password in credential manager', e)
            }
        }
        this.options.scripts = this.scripts
    }
}
