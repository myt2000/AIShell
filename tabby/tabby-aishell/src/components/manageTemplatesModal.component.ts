import { Component } from '@angular/core'
import { NgbModal, NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseComponent, NotificationsService, TranslateService, PlatformService, ProfileProvider, ProfilesService, Profile } from 'tabby-core'

import { AIShellTemplate } from '../api'
import { TemplateService } from '../services/template.service'

/** @hidden */
@Component({
    templateUrl: './manageTemplatesModal.component.pug',
    styleUrls: ['./manageTemplatesModal.component.scss'],
})
export class ManageTemplatesModalComponent extends BaseComponent {
    templates: AIShellTemplate[] = []
    newTemplateName = ''
    editingVarsFor: AIShellTemplate|null = null
    varsText = ''

    constructor (
        public modalInstance: NgbActiveModal,
        private templateService: TemplateService,
        private profilesService: ProfilesService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private ngbModal: NgbModal,
    ) {
        super()
    }

    ngOnInit (): void {
        this.reload()
    }

    reload (): void {
        this.templates = this.templateService.getTemplates()
        if (this.editingVarsFor && !this.templates.find(t => t.id === this.editingVarsFor!.id)) {
            this.editingVarsFor = null
        }
    }

    async createTemplate (): Promise<void> {
        const name = this.newTemplateName.trim()
        if (!name) { return }
        const provider = this.getSuitableProvider()
        if (!provider) {
            this.notifications.error(this.translate.instant('No profile provider available'))
            return
        }
        const template = await this.templateService.createTemplate(name, provider.id, {})
        this.newTemplateName = ''
        await this.editTemplate(template)
    }

    /** 优先 SSH provider */
    private getSuitableProvider (): ProfileProvider<Profile>|null {
        return this.profilesService.getProviders().find(p => p.id === 'ssh') ?? this.profilesService.getProviders()[0] ?? null
    }

    async editTemplate (template: AIShellTemplate): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const provider = this.profilesService.getProviders().find(p => p.id === template.profileType)
        if (!provider) { return }

        const modal = this.ngbModal.open(EditProfileModalComponent, { size: 'lg' })
        const model: any = Object.assign({}, template.options)
        model.type = provider.id
        model.name = template.name
        modal.componentInstance.partialProfile = model
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (!result) { return }
        template.options = deepClone(result.options ?? {})
        template.name = result.name ?? template.name
        await this.templateService.updateTemplate(template)
        this.reload()
    }

    startEditVars (template: AIShellTemplate): void {
        this.editingVarsFor = template
        this.varsText = Object.entries(template.vars ?? {})
            .map(([k, v]) => `${k}=${v}`).join('\n')
    }

    async saveVars (): Promise<void> {
        const template = this.editingVarsFor
        if (!template) { return }
        const vars: Record<string, string> = {}
        for (const line of this.varsText.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed) { continue }
            const idx = trimmed.indexOf('=')
            if (idx > 0) {
                vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
            }
        }
        template.vars = vars
        await this.templateService.updateTemplate(template)
        this.editingVarsFor = null
        this.reload()
    }

    async syncTemplate (template: AIShellTemplate): Promise<void> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Apply template "{name}" to all derived profiles?', { name: template.name }),
            buttons: [
                this.translate.instant('Apply'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) { return }
        const count = await this.templateService.syncToDerived(template)
        this.notifications.info(this.translate.instant('Updated {n} profiles', { n: count }))
    }

    async deleteTemplate (template: AIShellTemplate): Promise<void> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete template "{name}"?', { name: template.name }),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) { return }
        await this.templateService.deleteTemplate(template)
        this.reload()
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}

function deepClone<T> (value: T): T {
    return JSON.parse(JSON.stringify(value))
}
