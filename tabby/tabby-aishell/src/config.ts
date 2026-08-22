import { ConfigProvider } from 'tabby-core'

export class AIShellConfigProvider extends ConfigProvider {
    defaults = {
        aishell: {
            templates: [],
            batchCommands: {
                history: [],
                confirmDangerousCommands: true,
            },
            ai: {
                enabled: false,
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '',
                model: '',
                maxOutputTokens: 2048,
            },
        },
    }
}
