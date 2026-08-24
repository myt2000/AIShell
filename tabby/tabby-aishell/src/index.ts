import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { ToastrModule } from 'ngx-toastr'
import TabbyCoreModule, { CommandProvider, ConfigProvider, TabContextMenuItemProvider } from 'tabby-core'

import { AIShellConfigProvider } from './config'
import { AIShellCommandProvider } from './commands'
import { AiContextMenuProvider } from './contextMenu'
import { AiAssistantModalComponent } from './components/aiAssistantModal.component'
import { AiSettingsModalComponent } from './components/aiSettingsModal.component'
import { BatchCommandModalComponent } from './components/batchCommandModal.component'
import { FromTemplateModalComponent } from './components/fromTemplateModal.component'
import { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'
import { AiService } from './services/ai.service'
import { BatchCommandService } from './services/batchCommand.service'
import { TemplateService } from './services/template.service'
import { TerminalContextService } from './services/terminalContext.service'
import { VariableSubstitutionService } from './services/variableSubstitution.service'

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        ToastrModule,
        TabbyCoreModule,
    ],
    declarations: [
        FromTemplateModalComponent,
        ManageTemplatesModalComponent,
        BatchCommandModalComponent,
        AiAssistantModalComponent,
        AiSettingsModalComponent,
    ],
    entryComponents: [
        FromTemplateModalComponent,
        ManageTemplatesModalComponent,
        BatchCommandModalComponent,
        AiAssistantModalComponent,
        AiSettingsModalComponent,
    ],
    providers: [
        TemplateService,
        VariableSubstitutionService,
        BatchCommandService,
        AiService,
        TerminalContextService,
        { provide: ConfigProvider, useClass: AIShellConfigProvider, multi: true },
        { provide: CommandProvider, useClass: AIShellCommandProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: AiContextMenuProvider, multi: true },
    ],
})
export default class AIShellModule { }

export * from './api'
export { TemplateService } from './services/template.service'
export { VariableSubstitutionService } from './services/variableSubstitution.service'
export { BatchCommandService } from './services/batchCommand.service'
export { AiService } from './services/ai.service'
export { TerminalContextService } from './services/terminalContext.service'
export { FromTemplateModalComponent } from './components/fromTemplateModal.component'
export { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'
export { BatchCommandModalComponent } from './components/batchCommandModal.component'
export { AiAssistantModalComponent } from './components/aiAssistantModal.component'
export { AiSettingsModalComponent } from './components/aiSettingsModal.component'
