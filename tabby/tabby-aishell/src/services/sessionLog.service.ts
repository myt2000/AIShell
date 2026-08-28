import { Injectable, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import { AppService, ConfigService, NotificationsService, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

import { TerminalContextService } from './terminalContext.service'

export interface SessionLogSettings {
    /** 全局自动录制所有新会话 */
    enabled: boolean
    /** 落盘目录，空则用 ~/AIShell/logs */
    directory: string
    /** 剥离 ANSI 转义序列（推荐开启，日志更可读） */
    stripAnsi: boolean
    /** 每行加本地时间戳前缀 [HH:mm:ss.SSS]，便于无时间戳日志的时序分析 */
    addTimestamps: boolean
}

interface TabRecorder {
    tab: BaseTerminalTabComponent<any>
    sessionSub: Subscription|null
    dataSub: Subscription|null
    stream: fs.WriteStream|null
    /** 本标签录制文件路径；重连后继续追加同一文件 */
    filePath: string|null
    /** 用户通过右键菜单手动开启（不受全局开关关闭影响） */
    manual: boolean
    /** 行重组缓冲（addTimestamps 模式处理 chunk 边界） */
    lineBuf: string
    target: string
}

/* ansi-regex (MIT) 的等价实现，内联避免新增依赖 */
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

function stripAnsiCodes (text: string): string {
    return text.replace(ANSI_PATTERN, '')
}

function pad (n: number, width: number): string {
    return String(n).padStart(width, '0')
}

function localTimeLabel (d: Date = new Date()): string {
    return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
}

function fileTimestamp (d: Date = new Date()): string {
    return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
}

/**
 * AISHELL: 会话输出实时落盘。
 * 旁路订阅 session.binaryOutput$（不经过 enablePassthrough 门控、不受清屏影响），
 * 写文件完全不阻塞 xterm 渲染。支持全局自动录制与单标签手动录制两种模式。
 */
@Injectable({ providedIn: 'root' })
export class SessionLogService implements OnDestroy {

    private recorders = new Map<BaseTerminalTabComponent<any>, TabRecorder>()
    private globalSub: Subscription|null = null

    constructor (
        private app: AppService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private terminalContext: TerminalContextService,
    ) {
        this.globalSub = this.config.changed$.subscribe(() => this.onConfigChanged())
    }

    get settings (): SessionLogSettings {
        const sessionLog = (this.config.store as any).aishell?.sessionLog ?? {}
        return {
            enabled: sessionLog.enabled ?? false,
            directory: sessionLog.directory ?? '',
            stripAnsi: sessionLog.stripAnsi ?? true,
            addTimestamps: sessionLog.addTimestamps ?? false,
        }
    }

    async updateSettings (settings: Partial<SessionLogSettings>): Promise<void> {
        // AISHELL: ConfigProxy 限制——结构体键只读，逐叶子键写入
        const sessionLog = (this.config.store as any).aishell?.sessionLog
        if (!sessionLog) {
            throw new Error('aishell.sessionLog config unavailable')
        }
        for (const [key, value] of Object.entries({ ...this.settings, ...settings })) {
            sessionLog[key] = value
        }
        await this.config.save()
    }

    /** 启动：跟踪已打开的标签与后续新开标签 */
    initialize (): void {
        for (const tab of this.app.tabs) {
            this.watchTab(tab)
        }
        this.app.tabOpened$.subscribe(tab => this.watchTab(tab))
    }

    private isTerminalTab (tab: any): tab is BaseTerminalTabComponent<any> {
        return tab instanceof BaseTerminalTabComponent
    }

    private watchTab (tab: any): void {
        if (!this.isTerminalTab(tab)) {
            return
        }
        const recorder: TabRecorder = {
            tab,
            sessionSub: null,
            dataSub: null,
            stream: null,
            filePath: null,
            manual: false,
            lineBuf: '',
            target: '',
        }
        this.recorders.set(tab, recorder)
        recorder.sessionSub = tab.sessionChanged$.subscribe(session => {
            if (session) {
                if (this.settings.enabled || recorder.manual) {
                    this.startRecorder(recorder)
                }
            } else {
                // 会话关闭（断开/重连中）：写结尾并停流；manual 或全局开着则保留 filePath 等重连续写
                this.stopRecorder(recorder, true)
            }
        })
        tab.destroyed$.subscribe(() => {
            this.stopRecorder(recorder, false)
            this.recorders.delete(tab)
        })
        if (tab.session && (this.settings.enabled || recorder.manual)) {
            this.startRecorder(recorder)
        }
    }

    private onConfigChanged (): void {
        const enabled = this.settings.enabled
        for (const recorder of this.recorders.values()) {
            if (enabled && recorder.tab.session && !recorder.stream) {
                this.startRecorder(recorder)
            } else if (!enabled && !recorder.manual && recorder.stream) {
                this.stopRecorder(recorder, false)
            }
        }
    }

    isRecording (tab: BaseTerminalTabComponent<any>): boolean {
        return this.recorders.get(tab)?.stream != null
    }

    getFilePath (tab: BaseTerminalTabComponent<any>): string|null {
        return this.recorders.get(tab)?.filePath ?? null
    }

    /** 右键菜单入口：手动开启/停止录制单标签 */
    async toggleForTab (tab: BaseTerminalTabComponent<any>): Promise<void> {
        const recorder = this.recorders.get(tab)
        if (!recorder) {
            return
        }
        if (recorder.stream) {
            recorder.manual = false
            this.stopRecorder(recorder, false)
            this.notifications.info(this.translate.instant('Recording stopped'))
        } else {
            recorder.manual = true
            if (recorder.tab.session) {
                this.startRecorder(recorder)
            }
        }
    }

    private resolveDirectory (): string {
        return this.settings.directory || path.join(os.homedir(), 'AIShell', 'logs')
    }

    private startRecorder (recorder: TabRecorder): void {
        if (recorder.stream || !recorder.tab.session) {
            return
        }
        try {
            const dir = this.resolveDirectory()
            fs.mkdirSync(dir, { recursive: true })
            if (!recorder.filePath) {
                const safeTitle = (recorder.tab.title || 'session').replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'session'
                recorder.filePath = path.join(dir, `${safeTitle}_${fileTimestamp()}.log`)
            }
            recorder.target = this.terminalContext.describeTarget(recorder.tab)
            recorder.stream = fs.createWriteStream(recorder.filePath, { flags: 'a' })
            recorder.stream.on('error', e => {
                console.error('AIShell session log write error:', e)
                this.stopRecorder(recorder, false)
            })
            recorder.stream.write(`\n===== AIShell session log — ${recorder.target} — ${new Date().toISOString()} =====\n`)
            recorder.dataSub = recorder.tab.session.binaryOutput$.subscribe(data => this.writeChunk(recorder, data))
            this.notifications.info(
                this.translate.instant('Recording terminal output'),
                recorder.filePath,
            )
        } catch (e) {
            console.error('AIShell session log start failed:', e)
            recorder.stream = null
            this.notifications.error(this.translate.instant('Failed to start recording'), String(e))
        }
    }

    private writeChunk (recorder: TabRecorder, data: Buffer): void {
        const stream = recorder.stream
        if (!stream) {
            return
        }
        let text = data.toString('utf8')
        const settings = this.settings
        if (settings.stripAnsi) {
            text = stripAnsiCodes(text).replace(/\r\n?/g, '\n')
        }
        if (settings.addTimestamps) {
            recorder.lineBuf += text
            const lines = recorder.lineBuf.split('\n')
            recorder.lineBuf = lines.pop() ?? ''
            for (const line of lines) {
                stream.write(`[${localTimeLabel()}] ${line}\n`)
            }
        } else {
            stream.write(text)
        }
    }

    /** keepFile: 重连场景保留 filePath 以便续写 */
    private stopRecorder (recorder: TabRecorder, keepFile: boolean): void {
        if (recorder.dataSub) {
            recorder.dataSub.unsubscribe()
            recorder.dataSub = null
        }
        const stream = recorder.stream
        if (stream) {
            if (recorder.lineBuf) {
                stream.write(`[${localTimeLabel()}] ${recorder.lineBuf}\n`)
                recorder.lineBuf = ''
            }
            stream.write(`===== ${new Date().toISOString()} =====\n`)
            stream.end()
        }
        recorder.stream = null
        if (!keepFile) {
            recorder.filePath = null
        }
    }

    ngOnDestroy (): void {
        this.globalSub?.unsubscribe()
        for (const recorder of this.recorders.values()) {
            recorder.sessionSub?.unsubscribe()
            this.stopRecorder(recorder, false)
        }
        this.recorders.clear()
    }
}
