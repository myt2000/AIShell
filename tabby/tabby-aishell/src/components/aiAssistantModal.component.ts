import { Component } from '@angular/core'
import { NgbModal, NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, TranslateService } from 'tabby-core'

import { AiChatMessage } from '../services/ai.service'
import { AiService } from '../services/ai.service'
import { TerminalContextService } from '../services/terminalContext.service'
import { AiSettingsModalComponent } from './aiSettingsModal.component'

interface UiMessage {
    role: 'user' | 'assistant'
    content: string
    error?: boolean
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

    private systemPromptBase = '你是一名资深的 Linux 运维工程师助手。用户在使用 SSH 终端工具。回答使用中文，简洁准确；给出的命令要给出解释。'

    constructor (
        public modalInstance: NgbActiveModal,
        private ai: AiService,
        private terminalContext: TerminalContextService,
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

    async submit (overridePrompt?: string): Promise<void> {
        const prompt = (overridePrompt ?? this.input).trim()
        if (!prompt || this.busy) { return }
        this.input = ''
        this.messages.push({ role: 'user', content: prompt })
        this.busy = true
        try {
            const answer = await this.ai.chat(this.buildChatMessages(prompt))
            this.messages.push({ role: 'assistant', content: answer })
        } catch (e: any) {
            this.messages.push({ role: 'assistant', content: e?.message ?? String(e), error: true })
        } finally {
            this.busy = false
        }
    }

    private buildChatMessages (prompt: string): AiChatMessage[] {
        const tab = this.terminalContext.activeTerminalTab
        const target = this.terminalContext.describeTarget(tab)
        const contextParts: string[] = []
        if (target) {
            contextParts.push(`当前连接的服务器: ${target}`)
        }
        const system = this.systemPromptBase + (contextParts.length ? '\n' + contextParts.join('\n') : '')

        const history: AiChatMessage[] = this.messages
            .filter(m => !m.error)
            .slice(-6)
            .map(m => ({ role: m.role, content: m.content }))

        return [
            { role: 'system', content: system },
            ...history,
        ]
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
