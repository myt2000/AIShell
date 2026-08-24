import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Command, CommandLocation, CommandProvider } from 'tabby-core'

import { AiAssistantModalComponent } from './components/aiAssistantModal.component'
import { BatchCommandModalComponent } from './components/batchCommandModal.component'
import { FromTemplateModalComponent } from './components/fromTemplateModal.component'
import { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'

const wandIcon = require('./icons/wand.svg')
const broadcastIcon = require('./icons/broadcast.svg')
const robotIcon = require('./icons/robot.svg')

/** @hidden */
@Injectable()
export class AIShellCommandProvider extends CommandProvider {
    constructor (private ngbModal: NgbModal) {
        super()
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'aishell:new-from-template',
                label: 'New from template',
                icon: wandIcon,
                weight: -90,
                locations: [CommandLocation.StartPage], // AISHELL: 顶栏入口移除，主入口在左侧服务器树面板
                run: async () => {
                    this.ngbModal.open(FromTemplateModalComponent, { size: 'lg' })
                },
            },
            {
                id: 'aishell:manage-templates',
                label: 'Manage templates',
                weight: -91,
                locations: [CommandLocation.StartPage],
                run: async () => {
                    this.ngbModal.open(ManageTemplatesModalComponent, { size: 'lg' })
                },
            },
            {
                id: 'aishell:batch-command',
                label: 'Batch commands',
                icon: broadcastIcon,
                weight: -89,
                locations: [CommandLocation.StartPage],
                run: async () => {
                    this.ngbModal.open(BatchCommandModalComponent, { size: 'lg' })
                },
            },
            {
                id: 'aishell:ai-assistant',
                label: 'AI assistant',
                icon: robotIcon,
                weight: -88,
                locations: [CommandLocation.StartPage],
                run: async () => {
                    this.ngbModal.open(AiAssistantModalComponent, { size: 'lg' })
                },
            },
        ]
    }
}
