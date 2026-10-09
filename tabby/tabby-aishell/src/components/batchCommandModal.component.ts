import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, HotkeysService, NotificationsService, TranslateService, PlatformService } from 'tabby-core'
import { ConnectableTerminalTabComponent } from 'tabby-terminal'

import { BatchCommandService } from '../services/batchCommand.service'

interface OpenTabEntry {
    tab: ConnectableTerminalTabComponent<any>
    title: string
    target: string
    checked: boolean
}

/**
 * AISHELL: 批量命令（简化版）——只发给已打开且连接就绪的终端窗口，
 * 勾选哪些窗口就发哪些；不自动连接新服务器。
 */
/** @hidden */
@Component({
    templateUrl: './batchCommandModal.component.pug',
    styleUrls: ['./batchCommandModal.component.scss'],
})
export class BatchCommandModalComponent extends BaseComponent {
    openTabs: OpenTabEntry[] = []
    commandText = ''
    running = false

    constructor (
        public modalInstance: NgbActiveModal,
        private batch: BatchCommandService,
        private hotkeys: HotkeysService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        // Native menu paste can bypass the textarea's DOM event path. Keep the
        // active terminal from handling the same paste while this modal is open.
        this.hotkeys.disable()
        this.refreshTabs()
    }

    ngOnDestroy (): void {
        this.hotkeys.enable()
        super.ngOnDestroy()
    }

    refreshTabs (): void {
        const prev = new Map(this.openTabs.map(e => [e.tab, e.checked]))
        this.openTabs = this.batch.getOpenConnectedTabs().map(tab => {
            const profile: any = (tab as any).profile
            const target = profile?.options?.host
                ? `${profile.options.user ? profile.options.user + '@' : ''}${profile.options.host}`
                : ''
            return {
                tab,
                title: tab.title || target || 'terminal',
                target,
                checked: prev.get(tab) ?? true,
            }
        })
    }

    get commands (): string[] {
        return this.commandText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    }

    get checkedTabs (): ConnectableTerminalTabComponent<any>[] {
        return this.openTabs.filter(e => e.checked).map(e => e.tab)
    }

    get canRun (): boolean {
        return this.commands.length > 0 && this.checkedTabs.length > 0 && !this.running
    }

    /** Keep input and paste events inside the modal instead of forwarding them to the active terminal. */
    stopCommandInputEvent (event: Event): void {
        event.stopPropagation()
    }

    async run (): Promise<void> {
        const commands = this.commands
        if (!this.canRun) { return }

        if (this.batch.isDangerous(commands)) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('The commands look dangerous. Send anyway?'),
                detail: commands.join('\n'),
                buttons: [
                    this.translate.instant('Send'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }
        }

        this.running = true
        // AISHELL: 发出即关——命令队列后台发送（每窗口内仍按行序+间隔），不阻塞操作
        void this.batch.runAgainstOpenTabs(commands, this.checkedTabs).catch(e => {
            this.notifications.error(e?.toString() ?? String(e))
        })
        this.modalInstance.close()
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
