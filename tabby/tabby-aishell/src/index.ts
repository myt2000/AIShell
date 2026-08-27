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
import { BatchPasswordModalComponent } from './components/batchPasswordModal.component'
import { FromTemplateModalComponent } from './components/fromTemplateModal.component'
import { LogAnalysisModalComponent } from './components/logAnalysisModal.component'
import { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'
import { AiService } from './services/ai.service'
import { BatchCommandService } from './services/batchCommand.service'
import { LogTimelineService } from './services/logTimeline.service'
import { SessionLogService } from './services/sessionLog.service'
import { SecurePasswordService } from './services/securePassword.service'
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
        BatchPasswordModalComponent,
        AiAssistantModalComponent,
        AiSettingsModalComponent,
        LogAnalysisModalComponent,
    ],
    entryComponents: [
        FromTemplateModalComponent,
        ManageTemplatesModalComponent,
        BatchCommandModalComponent,
        BatchPasswordModalComponent,
        AiAssistantModalComponent,
        AiSettingsModalComponent,
        LogAnalysisModalComponent,
    ],
    providers: [
        TemplateService,
        VariableSubstitutionService,
        BatchCommandService,
        AiService,
        TerminalContextService,
        LogTimelineService,
        { provide: ConfigProvider, useClass: AIShellConfigProvider, multi: true },
        { provide: CommandProvider, useClass: AIShellCommandProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: AiContextMenuProvider, multi: true },
    ],
})
export default class AIShellModule {
    constructor (
        sessionLog: SessionLogService,
        securePasswords: SecurePasswordService,
    ) {
        // AISHELL: 会话录制服务随插件启动，跟踪所有终端标签
        sessionLog.initialize()
        // AISHELL: 首次启动把配置中的明文密码迁移进系统凭据管理器（一次性）
        void securePasswords.migrateIfNeeded()
    }
}

export * from './api'
export { TemplateService } from './services/template.service'
export { VariableSubstitutionService } from './services/variableSubstitution.service'
export { BatchCommandService } from './services/batchCommand.service'
export { AiService } from './services/ai.service'
export { TerminalContextService } from './services/terminalContext.service'
export { LogTimelineService } from './services/logTimeline.service'
export { SessionLogService } from './services/sessionLog.service'
export { KeyboardBroadcastService } from './services/keyboardBroadcast.service'
export { SecurePasswordService } from './services/securePassword.service'
export { FromTemplateModalComponent } from './components/fromTemplateModal.component'
export { ManageTemplatesModalComponent } from './components/manageTemplatesModal.component'
export { BatchCommandModalComponent } from './components/batchCommandModal.component'
export { BatchPasswordModalComponent } from './components/batchPasswordModal.component'
export { AiAssistantModalComponent } from './components/aiAssistantModal.component'
export { AiSettingsModalComponent } from './components/aiSettingsModal.component'
export { LogAnalysisModalComponent } from './components/logAnalysisModal.component'
