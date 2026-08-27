import { Injectable, NgZone } from '@angular/core'
import { AppService, NotificationsService, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

import { TerminalContextService } from './terminalContext.service'

/**
 * AISHELL: 键盘输入同步到所有已连接标签页（SecureCRT "发送交互到所有标签页"）。
 * 开启后给当前活动终端的 sendInput 挂一个转发：每次击键原样发到其他已连接终端；
 * 切换活动标签时自动重挂。关闭即恢复原函数。
 */
@Injectable({ providedIn: 'root' })
export class KeyboardBroadcastService {
    enabled = false

    private patchedTab: BaseTerminalTabComponent<any>|null = null
    private originalSendInput: ((data: string|Buffer) => void)|null = null

    constructor (
        private app: AppService,
        private terminalContext: TerminalContextService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private zone: NgZone,
    ) {
        this.app.activeTabChange$.subscribe(() => {
            if (this.enabled) {
                this.zone.run(() => this.repatch())
            }
        })
    }

    toggle (): void {
        this.enabled ? this.stop() : this.start()
    }

    private start (): void {
        this.enabled = true
        this.repatch()
        this.notifications.info(
            this.translate.instant('Keyboard broadcast enabled'),
            this.translate.instant('Everything you type is sent to all connected terminal tabs.'),
        )
    }

    private stop (): void {
        this.enabled = false
        this.unpatch()
        this.notifications.info(this.translate.instant('Keyboard broadcast disabled'))
    }

    /** 已连接的其他终端标签（每次击键时现取，避免陈旧引用） */
    private otherConnectedTabs (current: BaseTerminalTabComponent<any>): BaseTerminalTabComponent<any>[] {
        return this.terminalContext.getOpenTerminalTabs().filter(t => t !== current && !!t.session)
    }

    private repatch (): void {
        this.unpatch()
        const tab = this.terminalContext.activeTerminalTab
        if (!tab || !tab.session) {
            this.patchedTab = null
            return
        }
        this.patchedTab = tab
        const original = tab.sendInput.bind(tab)
        this.originalSendInput = original
        const service = this
        tab.sendInput = function (data: string|Buffer) {
            original.call(tab, data)
            for (const other of service.otherConnectedTabs(tab)) {
                try {
                    other.sendInput(data)
                } catch (e) {
                    console.error('AIShell keyboard broadcast failed:', e)
                }
            }
        }
    }

    private unpatch (): void {
        if (this.patchedTab && this.originalSendInput) {
            this.patchedTab.sendInput = this.originalSendInput
        }
        this.patchedTab = null
        this.originalSendInput = null
    }
}
