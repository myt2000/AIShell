import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

/**
 * 终端上下文捕获：取当前活动终端标签的选中文本 / 最近滚动输出
 */
@Injectable({ providedIn: 'root' })
export class TerminalContextService {

    constructor (private app: AppService) { }

    get activeTerminalTab (): BaseTerminalTabComponent<any>|null {
        const tab: any = this.app.activeTab
        if (tab instanceof BaseTerminalTabComponent) {
            return tab
        }
        // AISHELL: 活动标签通常是 SplitTabComponent 容器，取其聚焦的子终端
        if (tab?.getFocusedTab) {
            const focused = tab.getFocusedTab()
            if (focused instanceof BaseTerminalTabComponent) {
                return focused
            }
        }
        return this.getOpenTerminalTabs()[0] ?? null
    }

    /** 选中的文本（未选中返回空串） */
    getSelection (tab: BaseTerminalTabComponent<any>|null): string {
        if (!tab?.frontend) { return '' }
        try {
            return tab.frontend.getSelection() ?? ''
        } catch {
            return ''
        }
    }

    /** 最近的滚动缓冲输出（不含选区），maxLines 上限 */
    getRecentOutput (tab: BaseTerminalTabComponent<any>|null, maxLines = 200): string {
        const xterm = (tab?.frontend as any)?.xterm
        if (!xterm) { return '' }
        try {
            const buffer = xterm.buffer.active
            const end = buffer.length
            const start = Math.max(0, end - maxLines)
            const lines: string[] = []
            for (let i = start; i < end; i++) {
                lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
            }
            return lines.join('\n').trimEnd()
        } catch {
            return ''
        }
    }

    /** 目标服务器描述（不含任何凭据） */
    describeTarget (tab: BaseTerminalTabComponent<any>|null): string {
        const profile = (tab as any)?.profile
        if (!profile) { return '' }
        const options = profile.options ?? {}
        const parts: string[] = []
        if (options.host) {
            parts.push(`${options.user ? options.user + '@' : ''}${options.host}${options.port ? ':' + options.port : ''}`)
        }
        return parts.join(' ')
    }

    /** AISHELL: 当前打开的全部终端标签（app.tabs 里的是 SplitTabComponent 容器，需展开） */
    getOpenTerminalTabs (): BaseTerminalTabComponent<any>[] {
        const result: BaseTerminalTabComponent<any>[] = []
        for (const tab of this.app.tabs) {
            const inner: any[] = (tab as any).getAllTabs ? (tab as any).getAllTabs() : [tab]
            for (const t of inner) {
                if (t instanceof BaseTerminalTabComponent) {
                    result.push(t)
                }
            }
        }
        return result
    }
}
