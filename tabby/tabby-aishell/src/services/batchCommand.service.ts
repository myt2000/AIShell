import { Injectable } from '@angular/core'
import { AppService, NotificationsService, PartialProfile, Profile, ProfilesService, TranslateService } from 'tabby-core'
import { ConnectableTerminalTabComponent } from 'tabby-terminal'

import { VariableSubstitutionService } from './variableSubstitution.service'

interface BatchResult {
    targetName: string
    ok: boolean
    error?: string
}

/**
 * 批量广播命令引擎：
 * - 目标可以是 profiles（未连接的自动连接）、已打开的终端标签
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
        private profilesService: ProfilesService,
        private substitution: VariableSubstitutionService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    /** 找到与 profile 匹配的已打开连接标签 */
    private findOpenTabForProfile (profileId?: string): ConnectableTerminalTabComponent<any>|null {
        if (!profileId) { return null }
        for (const tab of this.app.tabs) {
            const tabProfile = (tab as any).profile
            if (tab instanceof ConnectableTerminalTabComponent && tabProfile?.id === profileId) {
                return tab
            }
        }
        return null
    }

    /** 等待会话就绪（连接成功）；标签被关闭则提前失败 */
    private async waitForSessionReady (tab: ConnectableTerminalTabComponent<any>, timeoutMs = 30000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            if (tab.session?.open) { return true }
            if (!this.app.tabs.includes(tab)) { return false }
            await sleep(200)
        }
        return false
    }

    isDangerous (commands: string[]): boolean {
        return commands.some(cmd => BatchCommandService.DANGEROUS_PATTERNS.some(re => re.test(cmd)))
    }

    /**
     * 向一组 profiles 广播命令：已连接的直接发；未连接的自动连接后发送
     */
    async runAgainstProfiles (profiles: PartialProfile<Profile>[], commands: string[]): Promise<BatchResult[]> {
        const results: BatchResult[] = []
        for (const profile of profiles) {
            try {
                let tab = this.findOpenTabForProfile(profile.id)
                if (!tab) {
                    await this.profilesService.launchProfile(profile)
                    await sleep(300)
                    tab = this.findOpenTabForProfile(profile.id)
                    if (!tab) {
                        results.push({ targetName: profile.name, ok: false, error: 'no tab' })
                        continue
                    }
                }
                const ready = await this.waitForSessionReady(tab)
                if (!ready) {
                    results.push({ targetName: profile.name, ok: false, error: 'timeout' })
                    continue
                }
                await this.sendCommandsToTab(tab, profile, commands)
                results.push({ targetName: profile.name, ok: true })
            } catch (e: any) {
                results.push({ targetName: profile.name, ok: false, error: e?.toString() })
            }
        }
        this.reportResults(results)
        return results
    }

    /** 向当前所有已打开的连接标签广播命令 */
    async runAgainstOpenTabs (commands: string[]): Promise<BatchResult[]> {
        const tabs = this.app.tabs.filter(
            t => t instanceof ConnectableTerminalTabComponent && t.session?.open,
        ) as unknown as ConnectableTerminalTabComponent<any>[]
        const results: BatchResult[] = []
        for (const tab of tabs) {
            try {
                const profile = (tab as any).profile
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
