import { Injectable } from '@angular/core'
import { ConfigService, TranslateService, NotificationsService } from 'tabby-core'

export interface AiSettings {
    enabled: boolean
    baseUrl: string
    apiKey: string
    model: string
    maxOutputTokens: number
}

export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/**
 * AI 助手服务：OpenAI 兼容 HTTP 接口（OpenAI / DeepSeek / 通义 / Ollama 本地等）
 * 直接使用 fetch，不引第三方 SDK。
 */
@Injectable({ providedIn: 'root' })
export class AiService {

    constructor (
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    get settings (): AiSettings {
        const ai = (this.config.store as any).aishell?.ai ?? {}
        return {
            enabled: ai.enabled ?? false,
            baseUrl: ai.baseUrl ?? 'https://api.openai.com/v1',
            apiKey: ai.apiKey ?? '',
            model: ai.model ?? '',
            maxOutputTokens: ai.maxOutputTokens ?? 2048,
        }
    }

    async updateSettings (settings: Partial<AiSettings>): Promise<void> {
        const store = this.config.store as any
        store.aishell ??= {}
        store.aishell.ai = { ...this.settings, ...settings }
        await this.config.save()
    }

    get configured (): boolean {
        const s = this.settings
        return s.enabled && !!s.baseUrl && !!s.model
    }

    /**
     * 发起对话补全请求，返回首个回复内容
     */
    async chat (messages: AiChatMessage[], opts?: { temperature?: number }): Promise<string> {
        const s = this.settings
        if (!this.configured) {
            throw new Error(this.translate.instant('AI assistant is not configured. Open AI settings first.'))
        }

        const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions'
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (s.apiKey) {
            headers['Authorization'] = `Bearer ${s.apiKey}`
        }

        let response: Response
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: s.model,
                    messages,
                    temperature: opts?.temperature ?? 0.3,
                    max_tokens: s.maxOutputTokens,
                }),
            })
        } catch (e: any) {
            throw new Error(this.translate.instant('AI request failed: {error}', { error: e?.toString() ?? e }))
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(`AI HTTP ${response.status}: ${text.slice(0, 300)}`)
        }

        const data = await response.json()
        const content = data.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
            throw new Error(this.translate.instant('Unexpected AI response format'))
        }
        return content
    }

    notifyError (e: any): void {
        this.notifications.error(e?.message ?? e?.toString() ?? String(e))
    }
}
