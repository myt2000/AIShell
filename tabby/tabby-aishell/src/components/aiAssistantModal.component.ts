import { Component, ElementRef, ViewChild } from '@angular/core'
import { NgbModal, NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, TranslateService, ProfilesService, PlatformService, NotificationsService, PartialProfile, Profile } from 'tabby-core'

import { AiChatMessage } from '../services/ai.service'
import { AiService } from '../services/ai.service'
import { TerminalContextService } from '../services/terminalContext.service'
import { BatchCommandService } from '../services/batchCommand.service'
import { AiSettingsModalComponent } from './aiSettingsModal.component'
import { LogAnalysisModalComponent } from './logAnalysisModal.component'

interface AiAction {
    type: 'open_group' | 'open_profile' | 'run'
    group?: string
    name?: string
    command?: string
    targets?: 'current' | 'all'
}

interface UiMessage {
    role: 'user' | 'assistant'
    content: string
    error?: boolean
    /** AISHELL: AI 回复中解析出的可执行动作（点按钮执行） */
    actions?: AiAction[]
    /** 动作执行状态：与 actions 下标对应 */
    executedActions?: boolean[]
}

/**
 * AI 助手对话窗口：
 * - 快捷动作：解释选中内容 / 诊断最近输出 / 分析日志 / 生成命令
 * - 自由提问；上下文自动附带当前终端信息（不含凭据）
 */
/** @hidden */
@Component({
    templateUrl: './aiAssistantModal.component.pug',
    styleUrls: ['./aiAssistantModal.component.scss'],
})
export class AiAssistantModalComponent extends BaseComponent {
    messages: UiMessage[] = []
    input = ''
    busy = false

    /** 打开时预置的首条请求（来自右键菜单） */
    presetPrompt: string|null = null

    @ViewChild('history') historyElement: ElementRef|undefined

    private systemPromptBase = '你是一名资深的 Linux 运维工程师助手。用户在使用 SSH 终端工具 AIShell。回答使用中文，简洁准确；给出的命令要给出解释。\n' +
        '你可以通过动作标记让用户一键执行操作（用户点击按钮确认后才执行，不会自动执行）。可用动作：\n' +
        '打开某文件夹下全部服务器：<<ACTION>>{"type":"open_group","group":"文件夹名"}<<END>>\n' +
        '连接某台服务器：<<ACTION>>{"type":"open_profile","name":"服务器名"}<<END>>\n' +
        '在终端窗口执行命令：<<ACTION>>{"type":"run","command":"命令","targets":"current或all"}<<END>>\n' +
        '当用户表达"打开/连上某文件夹所有服务器"或要求直接执行命令时，先简短说明，再附上对应动作标记。动作标记之外不要输出其他 JSON。'

    constructor (
        public modalInstance: NgbActiveModal,
        private ai: AiService,
        private terminalContext: TerminalContextService,
        private profilesService: ProfilesService,
        private batch: BatchCommandService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        if (this.presetPrompt) {
            const prompt = this.presetPrompt
            this.presetPrompt = null
            setTimeout(() => this.submit(prompt))
        }
    }

    get hasSelection (): boolean {
        return !!this.terminalContext.getSelection(this.terminalContext.activeTerminalTab).trim()
    }

    openSettings (): void {
        this.ngbModal.open(AiSettingsModalComponent)
    }

    /** AISHELL: 多窗口日志分析工作台 */
    openLogAnalysis (): void {
        this.ngbModal.open(LogAnalysisModalComponent, { size: 'lg' })
    }

    /** AISHELL: Enter 发送、Shift+Enter 换行 */
    onEnterKey (event: KeyboardEvent): void {
        if (event.shiftKey) {
            return // 保留默认行为：插入换行
        }
        event.preventDefault()
        void this.submit()
    }

    private scrollHistoryToBottom (): void {
        setTimeout(() => {
            const el = this.historyElement?.nativeElement
            if (el) {
                el.scrollTop = el.scrollHeight
            }
        })
    }

    async submit (overridePrompt?: string): Promise<void> {
        const prompt = (overridePrompt ?? this.input).trim()
        if (!prompt || this.busy) { return }
        this.input = ''
        this.messages.push({ role: 'user', content: prompt })
        this.busy = true
        this.scrollHistoryToBottom()
        try {
            const answer = await this.ai.chat(this.buildChatMessages(prompt))
            const { content, actions } = this.parseActions(answer)
            this.messages.push({ role: 'assistant', content, actions: actions.length ? actions : undefined, executedActions: actions.length ? [] : undefined })
        } catch (e: any) {
            this.messages.push({ role: 'assistant', content: e?.message ?? String(e), error: true })
        } finally {
            this.busy = false
            this.scrollHistoryToBottom()
        }
    }

    private buildChatMessages (prompt: string): AiChatMessage[] {
        const tab = this.terminalContext.activeTerminalTab
        const target = this.terminalContext.describeTarget(tab)
        const contextParts: string[] = []
        if (target) {
            contextParts.push(`当前连接的服务器: ${target}`)
        }
        const openTabs = this.terminalContext.getOpenTerminalTabs().length
        contextParts.push(`当前已打开的终端窗口数: ${openTabs}`)

        // AISHELL: 注入服务器树分组清单（AI 据此知道有哪些文件夹可打开）
        try {
            const groups = this.profilesService.getSyncProfileGroups()
            const lines = groups.map(g => {
                const path = this.profilesService.resolveProfileGroupPath(g.id).join('/')
                const count = this.profilesService.collectGroupProfiles(g.id).length
                return `${path}(${count}台)`
            })
            if (lines.length) {
                contextParts.push('可用的服务器文件夹（名称/路径，含服务器数）：\n' + lines.join('\n'))
            }
        } catch {
            // 分组清单不可用时跳过
        }

        const system = this.systemPromptBase + '\n' + contextParts.join('\n')

        const history: AiChatMessage[] = this.messages
            .filter(m => !m.error)
            .slice(-6)
            .map(m => ({ role: m.role, content: m.content }))

        return [
            { role: 'system', content: system },
            ...history,
        ]
    }

    /** AISHELL: 从 AI 回复中解析动作标记并从正文剥离 */
    private parseActions (raw: string): { content: string, actions: AiAction[] } {
        const actions: AiAction[] = []
        const content = raw.replace(/<<ACTION>>([\s\S]*?)<<END>>/g, (_m, body) => {
            try {
                const action = JSON.parse(body.trim())
                if (action && typeof action.type === 'string') {
                    actions.push(action)
                }
            } catch {
                // 非法动作体忽略
            }
            return ''
        }).trim()
        return { content, actions }
    }

    /** 动作按钮文案 */
    actionLabel (action: AiAction): string {
        if (action.type === 'open_group') {
            return this.translate.instant('Connect all servers in "{group}"', { group: action.group ?? '' })
        }
        if (action.type === 'open_profile') {
            return this.translate.instant('Connect "{name}"', { name: action.name ?? '' })
        }
        if (action.type === 'run') {
            return action.targets === 'all'
                ? this.translate.instant('Run in all tabs: {command}', { command: action.command ?? '' })
                : this.translate.instant('Run in current tab: {command}', { command: action.command ?? '' })
        }
        return JSON.stringify(action)
    }

    /** 用户点击动作按钮 → 确认 → 执行 */
    async executeAction (message: UiMessage, index: number): Promise<void> {
        const action = message.actions?.[index]
        if (!action || message.executedActions?.[index]) { return }

        if (action.type === 'open_group') {
            const group = this.resolveGroup(action.group ?? '')
            if (!group) {
                this.notifications.error(this.translate.instant('Folder "{group}" not found', { group: action.group ?? '' }))
                return
            }
            const profiles = this.profilesService.collectGroupProfiles(group.id)
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Connect {n} servers in "{group}"?', { n: profiles.length, group: action.group ?? '' }),
                buttons: [this.translate.instant('Connect'), this.translate.instant('Cancel')],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }
            message.executedActions ??= []
            message.executedActions[index] = true
            for (const profile of profiles) {
                this.profilesService.launchProfile(profile as PartialProfile<Profile>)
                await new Promise(r => setTimeout(r, 700))
            }
            this.notifications.info(this.translate.instant('Opening {n} servers', { n: profiles.length }))
            return
        }

        if (action.type === 'open_profile') {
            const profile = (await this.profilesService.getProfiles()).find(p => p.name === action.name)
            if (!profile) {
                this.notifications.error(this.translate.instant('Server "{name}" not found', { name: action.name ?? '' }))
                return
            }
            message.executedActions ??= []
            message.executedActions[index] = true
            this.profilesService.launchProfile(profile)
            return
        }

        if (action.type === 'run' && action.command) {
            message.executedActions ??= []
            message.executedActions[index] = true
            if (action.targets === 'all') {
                // 复用批量命令（内置危险命令确认）
                void this.batch.runAgainstOpenTabs([action.command]).catch(e => this.notifications.error(String(e)))
            } else {
                const tab = this.terminalContext.activeTerminalTab
                if (tab) {
                    tab.sendInput(action.command + '\n')
                } else {
                    this.notifications.error(this.translate.instant('No open terminal tabs'))
                }
            }
        }
    }

    private resolveGroup (query: string): { id: string }|null {
        const q = query.trim().toLowerCase()
        if (!q) { return null }
        const groups = this.profilesService.getSyncProfileGroups()
        const pathOf = (g: any) => this.profilesService.resolveProfileGroupPath(g.id).join('/').toLowerCase()
        return groups.find((g: any) => (g.name ?? '').toLowerCase() === q)
            ?? groups.find((g: any) => pathOf(g) === q)
            ?? groups.find((g: any) => pathOf(g).endsWith(q))
            ?? groups.find((g: any) => (g.name ?? '').toLowerCase().includes(q) || pathOf(g).includes(q))
            ?? null
    }

    // AISHELL: 快捷动作
    async explainSelection (): Promise<void> {
        const text = this.terminalContext.getSelection(this.terminalContext.activeTerminalTab).trim()
        if (!text) { return }
        await this.submit(this.translate.instant('Explain the following terminal output / command:') + '\n\n' + text.slice(0, 4000))
    }

    async diagnoseRecent (): Promise<void> {
        const tab = this.terminalContext.activeTerminalTab
        const output = this.terminalContext.getRecentOutput(tab, 150)
        await this.submit(this.translate.instant('Diagnose the recent terminal output below, find possible problems and give suggestions:') + '\n\n' + output.slice(-6000))
    }

    async analyzeLogs (): Promise<void> {
        const tab = this.terminalContext.activeTerminalTab
        const text = this.terminalContext.getSelection(tab).trim() || this.terminalContext.getRecentOutput(tab, 300)
        await this.submit(this.translate.instant('Analyze the logs below, summarize key events and anomalies:') + '\n\n' + text.slice(-8000))
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
