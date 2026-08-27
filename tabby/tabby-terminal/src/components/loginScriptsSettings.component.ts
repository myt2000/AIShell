/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
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
    revealed = new Set<LoginScript>()

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

    /** 手动切换隐藏：把当前生效状态取反固化为显式标记 */
    toggleSecret (script: LoginScript): void {
        script.secret = !this.isSecret(script)
        if (!script.secret) { this.revealed.delete(script) }
    }

    toggleReveal (script: LoginScript): void {
        if (this.revealed.has(script)) {
            this.revealed.delete(script)
        } else {
            this.revealed.add(script)
        }
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

    save () {
        this.options.scripts = this.scripts
    }
}
