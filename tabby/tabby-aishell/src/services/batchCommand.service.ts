import { Injectable } from '@angular/core'
import { AppService, NotificationsService, PartialProfile, Profile, TranslateService } from 'tabby-core'
import { ConnectableTerminalTabComponent } from 'tabby-terminal'

import { VariableSubstitutionService } from './variableSubstitution.service'

interface BatchResult {
    targetName: string
    ok: boolean
    error?: string
}

/**
 * AISHELL: 批量广播命令（简化版）：
 * - 目标 = 已打开且连接就绪的终端标签（不自动连接新服务器）
 * - 支持变量替换（与登录脚本同一套变量）
 * - 危险命令检测
 */
@Injectable({ providedIn: 'root' })
export class BatchCommandService {

    /** 视为危险、需要二次确认的命令模式 */
    static DANGEROUS_PATTERNS = [
        /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i,
        /\bmkfs\b/i,
        /\breboot\b/i,
        /\bshutdown\b/i,
        /\bhalt\b/i,
        /\binit\s+0\b/i,
        /\bdd\s+if=/i,
        /:\(\)\{/i,
        />\s*\/dev\/sd[a-z]/i,
    ]

    constructor (
        private app: AppService,
        private substitution: VariableSubstitutionService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    isDangerous (commands: string[]): boolean {
        return commands.some(cmd => BatchCommandService.DANGEROUS_PATTERNS.some(re => re.test(cmd)))
    }

    /** 当前所有已连接的终端标签（app.tabs 里的是 SplitTabComponent 容器，需用 getAllTabs 展开） */
    getOpenConnectedTabs (): ConnectableTerminalTabComponent<any>[] {
        const result: ConnectableTerminalTabComponent<any>[] = []
        for (const tab of this.app.tabs) {
            const inner: any[] = (tab as any).getAllTabs ? (tab as any).getAllTabs() : [tab]
            for (const t of inner) {
                if (t instanceof ConnectableTerminalTabComponent && t.session?.open) {
                    result.push(t)
                }
            }
        }
        return result
    }

    /** 向一组已打开的终端标签广播命令 */
    async runAgainstOpenTabs (commands: string[], tabs?: ConnectableTerminalTabComponent<any>[]): Promise<BatchResult[]> {
        const targets = tabs ?? this.getOpenConnectedTabs()
        const results: BatchResult[] = []
        for (const tab of targets) {
            try {
                const profile = (tab as any).profile as PartialProfile<Profile>|null
                await this.sendCommandsToTab(tab, profile, commands)
                results.push({ targetName: tab.title, ok: true })
            } catch (e: any) {
                results.push({ targetName: tab.title, ok: false, error: e?.toString() })
            }
        }
        this.reportResults(results)
        return results
    }

    private async sendCommandsToTab (tab: ConnectableTerminalTabComponent<any>, profile: PartialProfile<Profile>|null, commands: string[]): Promise<void> {
        const context = profile ? await this.substitution.buildContext(profile) : {}
        for (const raw of commands) {
            const line = this.substitution.substitute(raw, context)
            tab.sendInput(line + '\n')
            await sleep(120)
        }
    }

    private reportResults (results: BatchResult[]): void {
        const ok = results.filter(r => r.ok).length
        const failed = results.filter(r => !r.ok)
        if (!results.length) {
            this.notifications.info(this.translate.instant('No open terminal tabs'))
            return
        }
        if (!failed.length) {
            this.notifications.info(this.translate.instant('Command sent to {n} targets', { n: ok }))
        } else {
            const detail = failed.map(r => `${r.targetName}: ${r.error}`).join('\n')
            this.notifications.error(
                this.translate.instant('Sent to {ok}/{n} targets', { ok, n: results.length }),
                detail,
            )
        }
    }
}

function sleep (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
