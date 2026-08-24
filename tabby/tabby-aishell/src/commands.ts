import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Command, CommandLocation, CommandProvider } from 'tabby-core'

import { AiAssistantModalComponent } from './components/aiAssistantModal.component'
import { BatchCommandModalComponent } from './components/batchCommandModal.component'
import { FromTemplateModalComponent } from './components/fromTemplateModal.component'
import { LogAnalysisModalComponent } from './components/logAnalysisModal.component'
import { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'

const wandIcon = require('./icons/wand.svg')
const broadcastIcon = require('./icons/broadcast.svg')
const robotIcon = require('./icons/robot.svg')
const panelLeftIcon = require('./icons/panelLeft.svg')

/** AISHELL: 顶栏按钮与 profile-tree 组件之间的收起/展开信号（跨包解耦，树组件监听此事件） */
export const TOGGLE_SIDEBAR_EVENT = 'aishell:toggle-sidebar'

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
            {
                id: 'aishell:log-analysis',
                label: 'Multi-window log analysis',
                icon: robotIcon,
                weight: -87,
                locations: [CommandLocation.StartPage],
                run: async () => {
                    this.ngbModal.open(LogAnalysisModalComponent, { size: 'lg' })
                },
            },
            {
                // AISHELL: 侧边栏收起后常驻的展开/收起按钮（排在设置齿轮左侧，weight 9 < 设置的 10）
                id: 'aishell:toggle-sidebar',
                label: 'Toggle sidebar',
                icon: panelLeftIcon,
                weight: 9,
                locations: [CommandLocation.RightToolbar],
                run: async () => {
                    window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR_EVENT))
                },
            },
        ]
    }
}
