import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { TranslateService } from '@ngx-translate/core'
import { BaseComponent, NotificationsService, PartialProfileGroup, ProfileGroup, ProfilesService } from 'tabby-core'

import { AIShellTemplate, ServerRow } from '../api'
import { TemplateService } from '../services/template.service'

/** @hidden */
@Component({
    templateUrl: './fromTemplateModal.component.pug',
    styleUrls: ['./fromTemplateModal.component.scss'],
})
export class FromTemplateModalComponent extends BaseComponent {
    templates: AIShellTemplate[] = []
    selectedTemplateId = ''
    serverListText = ''
    groups: PartialProfileGroup<ProfileGroup>[] = []
    selectedGroupId = ''
    parsedRows: ServerRow[] = []
    parseErrors: string[] = []
    creating = false

    constructor (
        public modalInstance: NgbActiveModal,
        private templateService: TemplateService,
        private profilesService: ProfilesService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        this.templates = this.templateService.getTemplates()
        if (this.templates.length) {
            this.selectedTemplateId = this.templates[0].id
        }
        this.groups = this.profilesService.getSyncProfileGroups().filter(g => g.editable)
    }

    get selectedTemplate (): AIShellTemplate|null {
        return this.templates.find(t => t.id === this.selectedTemplateId) ?? null
    }

    onTextChange (): void {
        const { rows, errors } = this.templateService.parseServerLines(this.serverListText)
        this.parsedRows = rows
        this.parseErrors = errors
    }

    async create (): Promise<void> {
        const template = this.selectedTemplate
        if (!template || !this.parsedRows.length || this.creating) { return }
        this.creating = true
        try {
            const created = await this.templateService.instantiate(
                template,
                this.parsedRows,
                this.selectedGroupId || null,
            )
            this.notifications.info(this.translate.instant('Created {n} profiles from template', { n: created.length }))
            this.modalInstance.close(created)
        } catch (e: any) {
            this.notifications.error(e?.toString() ?? String(e))
        } finally {
            this.creating = false
        }
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
