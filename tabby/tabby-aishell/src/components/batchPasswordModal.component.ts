import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, ConfigService, NotificationsService, TranslateService } from 'tabby-core'

/**
 * AISHELL: 批量修改登录密码。
 * 目标是一批服务器 profile，两类密码可分别更新（留空的不动）：
 * 1. SSH 连接密码（options.password，即堡垒机/直连登录密码）
 * 2. 跳转目标机密码（登录脚本里 expect ':' 那一步的 send）
 */
/** @hidden */
@Component({
    templateUrl: './batchPasswordModal.component.pug',
    styleUrls: ['./batchPasswordModal.component.scss'],
})
export class BatchPasswordModalComponent extends BaseComponent {
    /** 要修改的 profile id 列表（由树右键菜单传入） */
    @Input() targetIds: string[] = []
    /** 范围描述（文件夹路径 / 服务器名），仅用于展示 */
    @Input() scopeLabel = ''

    sshPassword = ''
    jumpPassword = ''
    showPasswords = false

    constructor (
        public modalInstance: NgbActiveModal,
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    private matchingProfiles (): any[] {
        const ids = new Set(this.targetIds)
        return ((this.config.store as any).profiles ?? []).filter((p: any) => ids.has(p.id))
    }

    /** 登录脚本中的密码步骤下标（expect 为 ':' 或包含 password/密码） */
    private static passwordScriptIndex (profile: any): number {
        const scripts = profile?.options?.scripts ?? []
        return scripts.findIndex((s: any) =>
            (s.expect ?? '').trim() === ':' || /assword|密码/i.test(s.expect ?? ''))
    }

    get total (): number {
        return this.matchingProfiles().length
    }

    get withJumpStep (): number {
        return this.matchingProfiles().filter(p => BatchPasswordModalComponent.passwordScriptIndex(p) >= 0).length
    }

    get withSshAuth (): number {
        return this.matchingProfiles().filter(p => p.type === 'ssh' && !!(p.options?.password ?? '')).length
    }

    get canApply (): boolean {
        return this.total > 0 && !!(this.sshPassword || this.jumpPassword)
    }

    async apply (): Promise<void> {
        if (!this.canApply) { return }
        let updatedSsh = 0
        let updatedJump = 0
        for (const profile of this.matchingProfiles()) {
            profile.options = profile.options ?? {}
            if (this.sshPassword && profile.type === 'ssh') {
                profile.options.password = this.sshPassword
                updatedSsh++
            }
            if (this.jumpPassword) {
                const idx = BatchPasswordModalComponent.passwordScriptIndex(profile)
                if (idx >= 0) {
                    profile.options.scripts[idx].send = this.jumpPassword
                    updatedJump++
                }
            }
        }
        await this.config.save()
        this.notifications.info(
            this.translate.instant('Passwords updated'),
            this.translate.instant('{n} SSH passwords, {m} jump passwords', { n: updatedSsh, m: updatedJump }),
        )
        this.modalInstance.close()
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
