import { Component } from '@angular/core'
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import * as fs from 'fs'
import * as path from 'path'

import { BaseComponent, TranslateService, NotificationsService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

import { AiService } from '../services/ai.service'
import { AiSettingsModalComponent } from './aiSettingsModal.component'
import { TerminalContextService } from '../services/terminalContext.service'
import { LogTimelineService, LogSource, TimelineLine } from '../services/logTimeline.service'

interface TabTarget {
    tab: BaseTerminalTabComponent<any>
    label: string
    target: string
    checked: boolean
}

interface FileTarget {
    name: string
    path: string
    text: string
    checked: boolean
}

/** 单文件读取上限，超过取尾部（日志问题通常在尾部） */
const MAX_FILE_CHARS = 512 * 1024
/** 时间线渲染行数上限（防止 DOM 卡顿） */
const MAX_RENDER_LINES = 5000

/**
 * AISHELL: 多窗口日志分析工作台。
 * 目标 = 多个终端标签（实时捕获滚动缓冲）+ 多个落地日志文件；
 * 合并为按时间排序的统一时间线（每个来源视为一个模块），可导出、可交 AI 分析。
 */
/** @hidden */
@Component({
    templateUrl: './logAnalysisModal.component.pug',
    styleUrls: ['./logAnalysisModal.component.scss'],
})
export class LogAnalysisModalComponent extends BaseComponent {
    tabTargets: TabTarget[] = []
    fileTargets: FileTarget[] = []
    maxLines = 300

    timeline: TimelineLine[] = []
    rows: string[] = []
    timelineText = ''
    truncatedRender = false

    busy = false
    analyzing = false
    aiResult: string|null = null
    aiError = false

    constructor (
        public modalInstance: NgbActiveModal,
        private ngbModal: NgbModal,
        private ai: AiService,
        private terminalContext: TerminalContextService,
        private logTimeline: LogTimelineService,
        private translate: TranslateService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    ngOnInit (): void {
        this.refreshTabs()
    }

    private get electron (): any|null {
        try {
            return window['nodeRequire']?.('electron') ?? null
        } catch {
            return null
        }
    }

    refreshTabs (): void {
        const prev = new Map(this.tabTargets.map(t => [t.tab, t.checked]))
        this.tabTargets = this.terminalContext.getOpenTerminalTabs().map(tab => {
            const target = this.terminalContext.describeTarget(tab)
            const label = tab.title || target || 'terminal'
            return { tab, label, target, checked: prev.get(tab) ?? true }
        })
    }

    get hasTargets (): boolean {
        return this.tabTargets.some(t => t.checked) || this.fileTargets.some(f => f.checked)
    }

    async addFiles (): Promise<void> {
        const electron = this.electron
        if (!electron?.dialog) {
            this.notifications.info(this.translate.instant('File picker is unavailable in this environment'))
            return
        }
        const result = await electron.dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Logs', extensions: ['log', 'txt', 'out'] }],
        })
        if (result.canceled || !result.filePaths?.length) {
            return
        }
        for (const filePath of result.filePaths) {
            try {
                let text = await fs.promises.readFile(filePath, 'utf8')
                if (text.length > MAX_FILE_CHARS) {
                    text = `... [head omitted, ${text.length - MAX_FILE_CHARS} chars] ...\n` + text.slice(-MAX_FILE_CHARS)
                }
                const existing = this.fileTargets.findIndex(f => f.path === filePath)
                const entry: FileTarget = { name: path.basename(filePath), path: filePath, text, checked: true }
                if (existing >= 0) {
                    this.fileTargets[existing] = entry
                } else {
                    this.fileTargets.push(entry)
                }
            } catch (e: any) {
                this.notifications.error(this.translate.instant('Failed to read file'), `${filePath}: ${e?.message ?? e}`)
            }
        }
    }

    removeFile (target: FileTarget): void {
        this.fileTargets = this.fileTargets.filter(f => f !== target)
    }

    buildTimeline (): void {
        const sources: LogSource[] = []
        for (const t of this.tabTargets) {
            if (!t.checked) { continue }
            const text = this.terminalContext.getRecentOutput(t.tab, this.maxLines)
            if (text.trim()) {
                sources.push({ source: t.label, text })
            }
        }
        for (const f of this.fileTargets) {
            if (!f.checked) { continue }
            sources.push({ source: f.name, text: f.text })
        }
        this.timeline = this.logTimeline.buildTimeline(sources)
        const allRows = this.logTimeline.renderTimelineLines(this.timeline)
        this.truncatedRender = allRows.length > MAX_RENDER_LINES
        this.rows = this.truncatedRender ? allRows.slice(0, MAX_RENDER_LINES) : allRows
        this.timelineText = allRows.join('\n')
        this.aiResult = null
        this.aiError = false
    }

    get sourceCount (): number {
        return new Set(this.timeline.map(l => l.source)).size
    }

    /** 时间线渲染文本（模板插值用，避免在表达式里写转义换行） */
    get renderedText (): string {
        return this.rows.join('\n')
    }

    async exportMerged (): Promise<void> {
        if (!this.timelineText) {
            return
        }
        const electron = this.electron
        if (!electron?.dialog) {
            this.notifications.info(this.translate.instant('File picker is unavailable in this environment'))
            return
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const result = await electron.dialog.showSaveDialog({
            defaultPath: `merged-timeline-${stamp}.log`,
        })
        if (result.canceled || !result.filePath) {
            return
        }
        try {
            await fs.promises.writeFile(result.filePath, this.timelineText + '\n', 'utf8')
            this.notifications.info(this.translate.instant('Merged timeline exported'), result.filePath)
        } catch (e: any) {
            this.notifications.error(this.translate.instant('Failed to write file'), e?.message ?? String(e))
        }
    }

    async analyzeWithAi (): Promise<void> {
        if (!this.timelineText || this.analyzing) {
            return
        }
        if (!this.ai.configured) {
            this.notifications.info(this.translate.instant('AI assistant is not configured. Open AI settings first.'))
            return
        }
        this.analyzing = true
        this.aiError = false
        try {
            const moduleList = [...new Set(this.timeline.map(l => l.source))].join(', ')
            const { text, truncated } = this.logTimeline.smartTruncate(this.timelineText, this.ai.settings.maxContextChars)
            const system = '你是一名资深的 Linux 运维/SRE 工程师。用户提供了来自多个服务器模块、已按时间排序的合并日志时间线，格式为 "[时间] [模块] 日志内容"。请：\n' +
                '1) 按时间顺序列出发现的错误与异常事件，注明所属模块；\n' +
                '2) 分析跨模块之间的时序关联，推断可能的根因传播链；\n' +
                '3) 给出针对性的排查步骤与处置建议。\n' +
                '回答使用中文，用简洁的结构化条目。'
            const user = `模块清单: ${moduleList}\n` +
                (truncated ? '(日志过长已智能截断，保留开头与结尾部分)\n' : '') +
                `\n合并日志时间线:\n${text}`
            this.aiResult = await this.ai.chat([
                { role: 'system', content: system },
                { role: 'user', content: user },
            ], { temperature: 0.2 })
        } catch (e: any) {
            this.aiResult = e?.message ?? String(e)
            this.aiError = true
        } finally {
            this.analyzing = false
        }
    }

    openSettings (): void {
        this.ngbModal.open(AiSettingsModalComponent)
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
