import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ConfigService, TranslateService, NotificationsService } from 'tabby-core'

export interface AiSettings {
    enabled: boolean
    baseUrl: string
    apiKey: string
    model: string
    maxOutputTokens: number
    /** 发送给 AI 的上下文字符上限（日志分析等场景做智能截断） */
    maxContextChars: number
    /** AISHELL: 接口协议——openai 兼容 /chat/completions；anthropic /v1/messages（CC Switch 本地代理） */
    protocol?: 'openai' | 'anthropic'
}

export interface CCSwitchInfo {
    baseUrl: string
    haikuModel: string|null
    sonnetModel: string|null
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
            maxContextChars: ai.maxContextChars ?? 24000,
            protocol: ai.protocol ?? 'openai',
        }
    }

    /** AISHELL: 检测 CC Switch 本地代理（读 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL） */
    static detectCCSwitch (): CCSwitchInfo|null {
        try {
            const claudeSettings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
            const baseUrl: string|undefined = claudeSettings?.env?.ANTHROPIC_BASE_URL
            if (!baseUrl || !baseUrl.startsWith('http://127.0.0.1:')) {
                return null
            }
            return {
                baseUrl,
                haikuModel: claudeSettings?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null,
                sonnetModel: claudeSettings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,
            }
        } catch {
            return null
        }
    }

    async updateSettings (settings: Partial<AiSettings>): Promise<void> {
        // config.store 是 ConfigProxy：defaults 中的结构体键（aishell/ai）是只读 getter，
        // 不能整体赋值，必须取嵌套代理后逐叶子键写入（叶子键有 setter）
        const ai = (this.config.store as any).aishell?.ai
        if (!ai) {
            throw new Error('aishell.ai config unavailable')
        }
        for (const [key, value] of Object.entries({ ...this.settings, ...settings })) {
            ai[key] = value
        }
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
        if (s.protocol === 'anthropic') {
            return await this.chatAnthropic(messages, opts)
        }
        return await this.chatOpenAI(messages, opts)
    }

    /** OpenAI 兼容 /chat/completions */
    private async chatOpenAI (messages: AiChatMessage[], opts?: { temperature?: number }): Promise<string> {
        const s = this.settings
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

    /** AISHELL: Anthropic Messages 协议（CC Switch 本地代理 /v1/messages） */
    private async chatAnthropic (messages: AiChatMessage[], opts?: { temperature?: number }): Promise<string> {
        const s = this.settings
        const url = s.baseUrl.replace(/\/+$/, '') + '/v1/messages'
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': s.apiKey || 'PROXY_MANAGED',
        }
        if (s.apiKey) {
            headers['Authorization'] = `Bearer ${s.apiKey}`
        }

        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
        const chatMessages = messages.filter(m => m.role !== 'system')

        let response: Response
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: s.model,
                    system: system || undefined,
                    messages: chatMessages,
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
        const text = (data.content ?? [])
            .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('\n')
        if (!text) {
            throw new Error(this.translate.instant('Unexpected AI response format'))
        }
        return text
    }

    notifyError (e: any): void {
        this.notifications.error(e?.message ?? e?.toString() ?? String(e))
    }
}
