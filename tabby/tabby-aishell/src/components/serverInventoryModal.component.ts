import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, NotificationsService, TranslateService } from 'tabby-core'

import { ServerInventoryProgress, ServerInventoryRow, ServerInventoryService, ServerInventorySyncResult } from '../services/serverInventory.service'

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
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
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
