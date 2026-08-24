import { Injectable } from '@angular/core'

/** 单个日志来源（一个终端窗口 / 一个落地文件 = 一个"模块"） */
export interface LogSource {
    source: string
    text: string
}

/** 合并时间线中的一行 */
export interface TimelineLine {
    time: Date|null
    /** 全局捕获序号，时间相同时保持稳定顺序 */
    seq: number
    source: string
    line: string
    /** 行内是否真的带有时间戳（false = 继承上一行） */
    timeExplicit: boolean
}

const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

/** 带日期的：2026-08-24 12:00:01.123 / 2026-08-24T12:00:01,123 / 2026/08/24 12:00:01 */
const DATEFUL_PATTERN = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?/
/** syslog：Aug 24 12:00:01 */
const SYSLOG_PATTERN = new RegExp(`^(?:${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})\\s+(\\d{1,2}):(\\d{2}):(\\d{2})\\b`)
/** 仅时间（行首，可带方括号）：[12:00:01.123] / 12:00:01 */
const TIME_ONLY_PATTERN = /^\[?(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\]?/

function pad (n: number, width: number): string {
    return String(n).padStart(width, '2')
}

/**
 * AISHELL: 多窗口日志时间线服务。
 * 解析各来源日志行内的时间戳（常见格式），合并为按时间排序的统一时间线；
 * 无时间戳的行（堆栈续行等）继承同来源上一行的时间，时间未知的行排最后。
 */
@Injectable({ providedIn: 'root' })
export class LogTimelineService {

    /** 解析行内时间戳；识别不到返回 null。仅扫行首 80 字符。 */
    parseLineTimestamp (line: string): Date|null {
        const head = line.slice(0, 80)

        const dateful = DATEFUL_PATTERN.exec(head)
        if (dateful) {
            const [, y, mo, d, h, mi, s, ms] = dateful
            const date = new Date(
                parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
                parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10),
                ms ? parseInt(ms.padEnd(3, '0'), 10) : 0,
            )
            if (!isNaN(date.getTime())) {
                return date
            }
        }

        const syslog = SYSLOG_PATTERN.exec(head)
        if (syslog) {
            const month = MONTHS[head.slice(0, 3)]
            const [, d, h, mi, s] = syslog
            const now = new Date()
            const date = new Date(
                now.getFullYear(), month, parseInt(d, 10),
                parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10), 0,
            )
            if (!isNaN(date.getTime())) {
                return date
            }
        }

        const timeOnly = TIME_ONLY_PATTERN.exec(head.trim())
        if (timeOnly && head.trim().length >= 7) {
            const [, h, mi, s, ms] = timeOnly
            const hh = parseInt(h, 10)
            if (hh <= 23) {
                const now = new Date()
                const date = new Date(
                    now.getFullYear(), now.getMonth(), now.getDate(),
                    hh, parseInt(mi, 10), parseInt(s, 10),
                    ms ? parseInt(ms.padEnd(3, '0'), 10) : 0,
                )
                if (!isNaN(date.getTime())) {
                    return date
                }
            }
        }

        return null
    }

    /** 多来源合并排序。sources 顺序内行序保留，跨来源按时间归并。 */
    buildTimeline (sources: LogSource[]): TimelineLine[] {
        const lines: TimelineLine[] = []
        let seq = 0
        for (const src of sources) {
            let last: Date|null = null
            for (const line of src.text.split('\n')) {
                if (!line.trim()) {
                    continue
                }
                const parsed = this.parseLineTimestamp(line)
                if (parsed) {
                    last = parsed
                }
                lines.push({
                    time: parsed ?? last,
                    seq: seq++,
                    source: src.source,
                    line,
                    timeExplicit: parsed != null,
                })
            }
        }
        return lines.sort((a, b) => {
            const ta = a.time ? a.time.getTime() : Number.MAX_SAFE_INTEGER
            const tb = b.time ? b.time.getTime() : Number.MAX_SAFE_INTEGER
            return ta !== tb ? ta - tb : a.seq - b.seq
        })
    }

    formatTime (d: Date|null): string {
        if (!d) {
            return '--:--:--.---'
        }
        return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
    }

    /** 渲染为可读文本行：[时间] [模块] 内容 */
    renderTimelineLines (lines: TimelineLine[]): string[] {
        return lines.map(l => `[${this.formatTime(l.time)}] [${l.source}] ${l.line}`)
    }

    /** 超长上下文智能截断：保留头 25% + 尾 75%（错误通常在尾部），中间插入截断标记 */
    smartTruncate (text: string, maxChars: number): { text: string, truncated: boolean } {
        if (text.length <= maxChars) {
            return { text, truncated: false }
        }
        const headLen = Math.floor(maxChars * 0.25)
        const tailLen = maxChars - headLen
        const omitted = text.length - headLen - tailLen
        const marker = `\n... [${omitted} chars omitted] ...\n`
        return {
            text: text.slice(0, headLen) + marker + text.slice(text.length - tailLen),
            truncated: true,
        }
    }
}
