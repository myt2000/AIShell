import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, NotificationsService, TranslateService, PlatformService } from 'tabby-core'
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
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        this.refreshTabs()
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
        try {
            await this.batch.runAgainstOpenTabs(commands, this.checkedTabs)
            this.modalInstance.close()
        } catch (e: any) {
            this.notifications.error(e?.toString() ?? String(e))
        } finally {
            this.running = false
        }
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
