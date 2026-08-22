import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, NotificationsService, TranslateService } from 'tabby-core'

import { AiService } from '../services/ai.service'

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

    /** 常用 OpenAI 兼容服务商预设 */
    presets = [
        { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        { name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
    ]

    constructor (
        public modalInstance: NgbActiveModal,
        private ai: AiService,
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
    }

    applyPreset (preset: { baseUrl: string, model: string }): void {
        this.baseUrl = preset.baseUrl
        this.model = preset.model
    }

    async save (): Promise<void> {
        await this.ai.updateSettings({
            enabled: this.enabled,
            baseUrl: this.baseUrl.trim(),
            apiKey: this.apiKey.trim(),
            model: this.model.trim(),
            maxOutputTokens: this.maxOutputTokens,
        })
        this.notifications.info(this.translate.instant('AI settings saved'))
        this.modalInstance.close()
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
