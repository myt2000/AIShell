import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, NotificationsService, TranslateService } from 'tabby-core'

import { AiService, CCSwitchInfo } from '../services/ai.service'
import { SessionLogService } from '../services/sessionLog.service'

/** @hidden */
@Component({
    templateUrl: './aiSettingsModal.component.pug',
    styleUrls: ['./aiSettingsModal.component.scss'],
})
export class AiSettingsModalComponent extends BaseComponent {
    enabled = false
    baseUrl = ''
    apiKey = ''
    model = ''
    maxOutputTokens = 2048
    maxContextChars = 24000
    protocol: 'openai' | 'anthropic' = 'openai'
    ccSwitchInfo: CCSwitchInfo|null = null

    // AISHELL: 会话录制
    sessionLogEnabled = false
    sessionLogDirectory = ''
    sessionLogStripAnsi = true
    sessionLogAddTimestamps = false

    /** 常用 OpenAI 兼容服务商预设 */
    presets = [
        { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        { name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
    ]

    constructor (
        public modalInstance: NgbActiveModal,
        private ai: AiService,
        private sessionLog: SessionLogService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
        const s = this.ai.settings
        this.enabled = s.enabled
        this.baseUrl = s.baseUrl
        this.apiKey = s.apiKey
        this.model = s.model
        this.maxOutputTokens = s.maxOutputTokens
        this.maxContextChars = s.maxContextChars
        this.protocol = s.protocol ?? 'openai'
        this.ccSwitchInfo = AiService.detectCCSwitch()
        const sl = this.sessionLog.settings
        this.sessionLogEnabled = sl.enabled
        this.sessionLogDirectory = sl.directory
        this.sessionLogStripAnsi = sl.stripAnsi
        this.sessionLogAddTimestamps = sl.addTimestamps
    }

    private get electron (): any|null {
        try {
            return window['nodeRequire']?.('electron') ?? null
        } catch {
            return null
        }
    }

    applyPreset (preset: { baseUrl: string, model: string }): void {
        this.protocol = 'openai'
        this.baseUrl = preset.baseUrl
        this.model = preset.model
    }

    /** AISHELL: 一键对接 CC Switch 本地代理（Anthropic 协议；在 CC Switch 里切供应商即刻生效） */
    applyCCSwitch (): void {
        this.ccSwitchInfo = AiService.detectCCSwitch()
        if (!this.ccSwitchInfo) {
            this.notifications.info(
                this.translate.instant('CC Switch not detected'),
                this.translate.instant('Make sure CC Switch is running with its local proxy enabled.'),
            )
            return
        }
        this.protocol = 'anthropic'
        this.enabled = true
        this.baseUrl = this.ccSwitchInfo.baseUrl
        this.apiKey = 'PROXY_MANAGED'
        this.model = this.ccSwitchInfo.haikuModel ?? this.ccSwitchInfo.sonnetModel ?? this.model
    }

    async browseDirectory (): Promise<void> {
        const electron = this.electron
        if (!electron?.dialog) {
            this.notifications.info(this.translate.instant('File picker is unavailable in this environment'))
            return
        }
        const result = await electron.dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
        })
        if (!result.canceled && result.filePaths?.length) {
            this.sessionLogDirectory = result.filePaths[0]
        }
    }

    async save (): Promise<void> {
        await this.ai.updateSettings({
            enabled: this.enabled,
            baseUrl: this.baseUrl.trim(),
            apiKey: this.apiKey.trim(),
            model: this.model.trim(),
            maxOutputTokens: this.maxOutputTokens,
            maxContextChars: this.maxContextChars,
            protocol: this.protocol,
        })
        await this.sessionLog.updateSettings({
            enabled: this.sessionLogEnabled,
            directory: this.sessionLogDirectory.trim(),
            stripAnsi: this.sessionLogStripAnsi,
            addTimestamps: this.sessionLogAddTimestamps,
        })
        this.notifications.info(this.translate.instant('AI settings saved'))
        this.modalInstance.close()
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
