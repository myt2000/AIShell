import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, ConfigService, NotificationsService, TranslateService } from 'tabby-core'

import { ServerInventoryProgress, ServerInventoryRow, ServerInventoryService, ServerInventorySyncResult } from '../services/serverInventory.service'
import { SecurePasswordService } from '../services/securePassword.service'

/** 获取监控平台全部机房/产品/模块节点，并导出清单。 */
@Component({
    templateUrl: './serverInventoryModal.component.pug',
    styleUrls: ['./serverInventoryModal.component.scss'],
})
export class ServerInventoryModalComponent extends BaseComponent {
    baseUrl = 'http://172.16.14.123:8080/'
    username = ''
    password = ''
    pageSize = 100

    // AISHELL: 服务器登录配置（设置 + 凭据管理器；login.env 首次自动迁移）
    showLoginConfig = false
    bastionUser = ''
    bastionPassword = ''
    targetUser = ''
    targetPassword = ''
    bastionHosts: Record<string, string> = { hzsd: '', bjmjq: '', wxgj: '' }
    roomLabels: Array<{ id: string, label: string }> = [
        { id: 'hzsd', label: '杭州三墩' },
        { id: 'bjmjq', label: '北京马驹桥' },
        { id: 'wxgj', label: '无锡国际' },
    ]
    rows: ServerInventoryRow[] = []
    progress: ServerInventoryProgress|null = null
    running = false
    error = ''
    syncResult: ServerInventorySyncResult|null = null
    syncing = false
    private abortController: AbortController|null = null

    constructor (
        public modalInstance: NgbActiveModal,
        private inventory: ServerInventoryService,
        private config: ConfigService,
        private securePasswords: SecurePasswordService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        // login.env 一次性自动迁移（读到文件则入库并提示）
        const imported = await this.securePasswords.migrateLoginEnvIfNeeded().catch(() => false)
        if (imported) {
            this.notifications.info('已从 login.env 导入服务器登录配置', '此后可在本弹窗的「服务器登录配置」中维护，不再依赖 login.env 文件')
        }
        await this.loadLoginSettings()
    }

    private async loadLoginSettings (): Promise<void> {
        const inv = (this.config.store as any).aishell?.inventory
        if (!inv) { return }
        this.baseUrl = inv.baseUrl || this.baseUrl
        this.username = inv.platformUser || ''
        this.bastionUser = inv.bastionUser || ''
        this.targetUser = inv.targetUser || ''
        for (const id of Object.keys(this.bastionHosts)) {
            this.bastionHosts[id] = inv.bastionHosts?.[id] || ''
        }
        const [platform, bastion, target] = await Promise.all([
            this.securePasswords.getInventoryPassword('platform'),
            this.securePasswords.getInventoryPassword('bastion'),
            this.securePasswords.getInventoryPassword('target'),
        ])
        this.password = platform ?? ''
        this.bastionPassword = bastion ?? ''
        this.targetPassword = target ?? ''
    }

    /** 保存登录配置：非敏键进 Tabby 配置，三密码进系统凭据管理器 */
    async saveLoginConfig (): Promise<void> {
        const inv = (this.config.store as any).aishell?.inventory
        if (!inv) { return }
        inv.baseUrl = this.baseUrl.trim()
        inv.platformUser = this.username.trim()
        inv.bastionUser = this.bastionUser.trim()
        inv.targetUser = this.targetUser.trim()
        for (const [id, host] of Object.entries(this.bastionHosts)) {
            inv.bastionHosts[id] = host.trim()
        }
        await this.config.save()
        if (this.password) { await this.securePasswords.setInventoryPassword('platform', this.password) }
        if (this.bastionPassword) { await this.securePasswords.setInventoryPassword('bastion', this.bastionPassword) }
        if (this.targetPassword) { await this.securePasswords.setInventoryPassword('target', this.targetPassword) }
        this.notifications.info('服务器登录配置已保存', '密码加密保存在系统凭据管理器，配置文件不含明文')
    }

    /** 生成文件树前的必填校验 */
    private validateLoginConfig (): boolean {
        if (!this.bastionUser.trim() || !this.bastionPassword) {
            this.error = '请先在「服务器登录配置」中填写堡垒机用户名和密码并保存。'
            this.showLoginConfig = true
            return false
        }
        if (!this.targetUser.trim() || !this.targetPassword) {
            this.error = '请先在「服务器登录配置」中填写目标服务器用户名和密码并保存。'
            this.showLoginConfig = true
            return false
        }
        if (!Object.values(this.bastionHosts).some(host => host.trim())) {
            this.error = '请先在「服务器登录配置」中至少填写一个机房的堡垒机 IP 并保存。'
            this.showLoginConfig = true
            return false
        }
        return true
    }

    async crawl (): Promise<void> {
        if (this.running) { return }
        const url = this.baseUrl.trim()
        if (!/^https?:\/\//i.test(url)) {
            this.error = '请输入以 http:// 或 https:// 开头的平台地址。'
            return
        }
        if (!this.username.trim() || !this.password) {
            this.error = '请输入监控平台账号和密码。'
            return
        }
        this.running = true
        this.error = ''
        this.rows = []
        this.syncResult = null
        this.progress = null
        this.abortController = new AbortController()
        try {
            this.rows = await this.inventory.crawl({
                baseUrl: url,
                pageSize: this.pageSize,
                username: this.username,
                password: this.password,
                signal: this.abortController.signal,
                onProgress: progress => this.progress = progress,
            })
            this.notifications.info(`已获取 ${this.rows.length} 台服务器节点`)
        } catch (e: any) {
            if (this.abortController.signal.aborted) { return }
            this.error = e?.message ?? String(e)
            this.notifications.error(this.translate.instant('Server configuration fetch failed'), this.error)
        } finally {
            this.running = false
            this.abortController = null
        }
    }

    async generateTree (): Promise<void> {
        if (!this.rows.length || this.running || this.syncing) { return }
        if (!this.validateLoginConfig()) { return }
        await this.saveLoginConfig()
        this.syncing = true
        this.error = ''
        try {
            this.syncResult = await this.inventory.syncProfiles(this.rows)
            this.notifications.info(`文件树已生成：新增 ${this.syncResult.createdProfiles} 台，更新 ${this.syncResult.updatedProfiles} 台，跳过异常 ${this.syncResult.skippedAbnormal} 台`)
        } catch (e: any) {
            this.error = e?.message ?? String(e)
            this.notifications.error('生成服务器文件树失败', this.error)
        } finally {
            this.syncing = false
        }
    }

    cancelCrawl (): void {
        this.abortController?.abort()
        this.running = false
    }

    downloadCsv (): void {
        if (!this.rows.length) { return }
        const blob = new Blob([this.inventory.toCsv(this.rows)], { type: 'text/csv;charset=utf-8' })
        const url = window.URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `server-inventory-${new Date().toISOString().slice(0, 10)}.csv`
        anchor.click()
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
    }

    cancel (): void {
        this.abortController?.abort()
        this.modalInstance.dismiss()
    }
}
