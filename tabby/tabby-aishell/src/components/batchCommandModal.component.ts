import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { TranslateService } from '@ngx-translate/core'
import { BaseComponent, NotificationsService, PartialProfile, PartialProfileGroup, PlatformService, Profile, ProfileGroup, ProfilesService } from 'tabby-core'

import { BatchCommandService } from '../services/batchCommand.service'

type TargetMode = 'selected' | 'openTabs' | 'group'

/** @hidden */
@Component({
    templateUrl: './batchCommandModal.component.pug',
    styleUrls: ['./batchCommandModal.component.scss'],
})
export class BatchCommandModalComponent extends BaseComponent {
    targetMode: TargetMode = 'selected'
    profiles: PartialProfile<Profile>[] = []
    selectedProfileIds = new Set<string>()
    groups: PartialProfileGroup<ProfileGroup>[] = []
    selectedGroupId = ''
    commandText = ''
    running = false

    constructor (
        public modalInstance: NgbActiveModal,
        private profilesService: ProfilesService,
        private batch: BatchCommandService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        this.profiles = (await this.profilesService.getProfiles({ includeBuiltin: false, clone: true }))
            .filter(p => !p.isTemplate && p.id)
        this.groups = this.profilesService.getSyncProfileGroups().filter(g => g.editable)
    }

    get commands (): string[] {
        return this.commandText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    }

    get selectedProfiles (): PartialProfile<Profile>[] {
        return this.profiles.filter(p => this.selectedProfileIds.has(p.id ?? ''))
    }

    toggleProfile (id?: string): void {
        if (!id) { return }
        if (this.selectedProfileIds.has(id)) {
            this.selectedProfileIds.delete(id)
        } else {
            this.selectedProfileIds.add(id)
        }
    }

    selectGroupProfiles (): void {
        if (!this.selectedGroupId) { return }
        for (const p of this.profiles) {
            if ((p.group ?? '') === this.selectedGroupId) {
                this.selectedProfileIds.add(p.id ?? '')
            }
        }
        this.targetMode = 'selected'
    }

    private async resolveTargets (): Promise<{ mode: TargetMode, profiles: PartialProfile<Profile>[] }> {
        if (this.targetMode === 'group' && this.selectedGroupId) {
            return { mode: 'selected', profiles: this.profiles.filter(p => (p.group ?? '') === this.selectedGroupId) }
        }
        return { mode: this.targetMode, profiles: this.selectedProfiles }
    }

    async run (): Promise<void> {
        const commands = this.commands
        if (!commands.length || this.running) { return }
        const { mode, profiles } = await this.resolveTargets()
        if (mode === 'selected' && !profiles.length) { return }

        if (this.batch.isDangerous(commands)) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('The commands look dangerous. Send anyway?'),
                detail: commands.join('\n'),
                buttons: [
                    this.translate.instant('Send'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }
        }

        this.running = true
        try {
            if (mode === 'openTabs') {
                await this.batch.runAgainstOpenTabs(commands)
            } else {
                await this.batch.runAgainstProfiles(profiles, commands)
            }
            this.modalInstance.close()
        } catch (e: any) {
            this.notifications.error(e?.toString() ?? String(e))
        } finally {
            this.running = false
        }
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
