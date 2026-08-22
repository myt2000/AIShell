import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseTabComponent, MenuItemOptions, TabContextMenuItemProvider, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

import { AiAssistantModalComponent } from './components/aiAssistantModal.component'
import { TerminalContextService } from './services/terminalContext.service'

/** @hidden */
@Injectable()
export class AiContextMenuProvider extends TabContextMenuItemProvider {
    weight = -100

    constructor (
        private ngbModal: NgbModal,
        private terminalContext: TerminalContextService,
        private translate: TranslateService,
    ) {
        super()
    }

    private openWithPrompt (prompt: string): void {
        const modal = this.ngbModal.open(AiAssistantModalComponent, { size: 'lg' })
        modal.componentInstance.presetPrompt = prompt
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!(tab instanceof BaseTerminalTabComponent)) {
            return []
        }
        const hasSelection = !!this.terminalContext.getSelection(tab).trim()

        const explain = (text: string) => this.translate.instant('Explain the following terminal output / command:') + '\n\n' + text.slice(0, 4000)
        const diagnose = (text: string) => this.translate.instant('Diagnose the recent terminal output below, find possible problems and give suggestions:') + '\n\n' + text.slice(-6000)
        const analyze = (text: string) => this.translate.instant('Analyze the logs below, summarize key events and anomalies:') + '\n\n' + text.slice(-8000)

        return [
            {
                label: this.translate.instant('AI'),
                submenu: [
                    {
                        label: this.translate.instant('Explain selection'),
                        enabled: hasSelection,
                        click: () => this.openWithPrompt(explain(this.terminalContext.getSelection(tab))),
                    },
                    {
                        label: this.translate.instant('Diagnose output'),
                        click: () => this.openWithPrompt(diagnose(this.terminalContext.getRecentOutput(tab, 150))),
                    },
                    {
                        label: this.translate.instant('Analyze logs'),
                        click: () => this.openWithPrompt(analyze(
                            this.terminalContext.getSelection(tab).trim() || this.terminalContext.getRecentOutput(tab, 300),
                        )),
                    },
                ],
            },
        ]
    }
}
