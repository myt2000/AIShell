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
                /** AISHELL: 发送给 AI 的日志/上下文字符上限，超出智能截断 */
                maxContextChars: 24000,
                /** AISHELL: 接口协议 openai/anthropic（CC Switch 本地代理）；必须在 defaults 里注册才会经 ConfigProxy 持久化 */
                protocol: 'openai',
            },
            sessionLog: {
                /** AISHELL: 终端输出实时落盘 */
                enabled: false,
                directory: '',
                stripAnsi: true,
                addTimestamps: false,
            },
        },
    }
}
