import { Component, HostBinding, HostListener, Input } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop'
import deepClone from 'clone-deep'
import FuzzySearch from 'fuzzy-search'

import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { AppService } from '../services/app.service'
import { NotificationsService } from '../services/notifications.service'
import { PlatformService } from '../api/platform'
import { ProfileProvider } from '../api/index'
import { PartialProfileGroup, ProfileGroup, PartialProfile, Profile } from '../index'
import { BaseComponent } from './base.component'

interface CollapsableProfileGroup extends ProfileGroup {
    collapsed: boolean
    children: PartialProfileGroup<CollapsableProfileGroup>[]
}

// AISHELL: 拖拽目标/拖拽项携带的数据
interface TreeDragTargetData {
    kind: 'group-header' | 'profiles' | 'root'
    group?: PartialProfileGroup<CollapsableProfileGroup>
}

interface TreeDragItemData {
    kind: 'profile' | 'group'
    profile?: PartialProfile<Profile>
    group?: PartialProfileGroup<CollapsableProfileGroup>
}

/** @hidden */
@Component({
    selector: 'profile-tree',
    styleUrls: ['./profileTree.component.scss'],
    templateUrl: './profileTree.component.pug',
})
export class ProfileTreeComponent extends BaseComponent {
    profileGroups: PartialProfileGroup<ProfileGroup>[] = []
    rootGroups: PartialProfileGroup<ProfileGroup>[] = []

    filteredProfiles: PartialProfile<Profile>[] = []
    @Input() filter = ''

    // AISHELL: 多选状态
    selection = new Set<string>()
    private selectionAnchor: string|null = null
    private visibleProfileIds: string[] = []
    isDragging = false

    // AISHELL: 树内剪贴板（服务器/分组 → 右键分组粘贴）
    treeClipboard: { kind: 'group', id: string } | { kind: 'profiles', ids: string[] } | null = null


    panelMinWidth = 200
    panelMaxWidth = 600
    panelInternalWidth: number = parseInt(window.localStorage.profileTreeWidth ?? '300')
    panelStartWidth = this.panelInternalWidth
    panelIsResizing = false
    panelStartX = 0

    // AISHELL: 侧边栏收起状态（与宽度一样存 localStorage，组件保持挂载、树状态不丢）
    @HostBinding('class.aishell-collapsed')
    collapsed: boolean = window.localStorage.profileTreeCollapsed === '1'

    toggleCollapsed (): void {
        this.collapsed = !this.collapsed
        window.localStorage.profileTreeCollapsed = this.collapsed ? '1' : '0'
    }

    // AISHELL: 顶栏 aishell:toggle-sidebar 按钮经 window 事件转发收起/展开（跨包解耦）
    @HostListener('window:aishell:toggle-sidebar')
    onToggleSidebarEvent (): void {
        this.toggleCollapsed()
    }

    constructor (
        private app: AppService,
        private platform: PlatformService,
        private config: ConfigService,
        private profilesService: ProfilesService,
        private translate: TranslateService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        await this.loadTreeItems()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.loadTreeItems())
        this.app.tabsChanged$.subscribe(() => this.tabStateChanged())
        this.app.activeTabChange$.subscribe(() => this.tabStateChanged())
    }


    private async loadTreeItems (): Promise<void> {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        let groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })

        for (const group of groups) {
            if (group.profiles?.length) {
                // remove template profiles
                group.profiles = group.profiles.filter(x => !x.isTemplate)

                // remove blocklisted profiles
                group.profiles = group.profiles.filter(x => x.id && !this.config.store.profileBlacklist.includes(x.id))
            }
        }

        if (!this.config.store.terminal.showBuiltinProfiles) { groups = groups.filter(g => g.id !== 'built-in') }

        groups.sort((a, b) => a.name.localeCompare(b.name))
        groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !b.editable ? 1 : 0))
        groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))
        this.profileGroups = groups.map(g => ProfileTreeComponent.intoPartialCollapsableProfileGroup(g, profileGroupCollapsed[g.id] ?? false))
        this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
        this.rebuildVisibleProfileIds()
    }

    private async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )

        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) { throw new Error('Cannot edit a profile without a provider') }

        modal.componentInstance.partialProfile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) { return }

        result.type = provider.id

        await this.profilesService.writeProfile(result)
        await this.config.save()
    }

    private async editProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        const { EditProfileGroupModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileGroupModalComponent,
            { size: 'lg' },
        )

        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profilesService.getProviders()

        const result: PartialProfileGroup<ProfileGroup & { group: PartialProfileGroup<CollapsableProfileGroup>, provider?: ProfileProvider<Profile> }> | null = await modal.result.catch(() => null)
        if (!result) { return }
        if (!result.group) { return }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        delete result.group.collapsed
        delete result.group.children
        await this.profilesService.writeProfileGroup(result.group)
        await this.config.save()
    }

    private async editProfileGroupDefaults (group: PartialProfileGroup<CollapsableProfileGroup>, provider: ProfileProvider<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.profile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }
        return this.editProfileGroup(group)
    }

    // AISHELL: ===== AIShell 功能入口（模板/批量命令/AI，弹窗由 tabby-aishell 提供） =====

    openAIShellModal (which: 'fromTemplate'|'manageTemplates'|'batchCommand'|'aiAssistant'|'logAnalysis'): void {
        try {
            const aishell = window['nodeRequire']('tabby-aishell')
            const components = {
                fromTemplate: aishell.FromTemplateModalComponent,
                manageTemplates: aishell.ManageTemplatesModalComponent,
                batchCommand: aishell.BatchCommandModalComponent,
                aiAssistant: aishell.AiAssistantModalComponent,
                logAnalysis: aishell.LogAnalysisModalComponent,
            }
            const component = components[which]
            if (!component) {
                throw new Error(`Unknown AIShell modal: ${which}`)
            }
            this.ngbModal.open(component, { size: 'lg' })
        } catch (e) {
            console.error('Failed to open AIShell modal:', e)
            this.notifications.error(
                this.translate.instant('AIShell plugin is unavailable'),
                this.translate.instant('Rebuild or reinstall the AIShell plugin and restart Tabby.'),
            )
        }
    }

    // AISHELL: ===== 多选 =====

    get selectionCount (): number {
        return this.selection.size
    }

    isSelected (profile: PartialProfile<Profile>): boolean {
        return this.selection.has(profile.id ?? '')
    }

    /** 当前选中的 profiles（按树数据解析，保持顺序无关） */
    getSelectedProfiles (): PartialProfile<Profile>[] {
        const result: PartialProfile<Profile>[] = []
        const walk = (groups: PartialProfileGroup<CollapsableProfileGroup>[]) => {
            for (const group of groups) {
                for (const p of group.profiles ?? []) {
                    if (this.selection.has(p.id ?? '')) {
                        result.push(p)
                    }
                }
                walk((group as any).children ?? [])
            }
        }
        walk(this.rootGroups as any)
        return result
    }

    onProfileClick (profile: PartialProfile<Profile>, event: MouseEvent): void {
        const id = profile.id ?? ''
        if (event.ctrlKey || event.metaKey) {
            if (this.selection.has(id)) {
                this.selection.delete(id)
            } else {
                this.selection.add(id)
            }
            this.selectionAnchor = id
        } else if (event.shiftKey && this.selectionAnchor) {
            const from = this.visibleProfileIds.indexOf(this.selectionAnchor)
            const to = this.visibleProfileIds.indexOf(id)
            if (from !== -1 && to !== -1) {
                for (const pid of this.visibleProfileIds.slice(Math.min(from, to), Math.max(from, to) + 1)) {
                    this.selection.add(pid)
                }
            } else {
                this.selection.add(id)
                this.selectionAnchor = id
            }
        } else {
            this.selection.clear()
            this.selection.add(id)
            this.selectionAnchor = id
        }
    }

    clearSelection (): void {
        this.selection.clear()
        this.selectionAnchor = null
    }

    @HostListener('document:keydown', ['$event'])
    onDocumentKeydown (event: KeyboardEvent): void {
        if (event.key === 'Escape' && this.selection.size > 0) {
            this.clearSelection()
        }
    }

    private rebuildVisibleProfileIds (): void {
        const ids: string[] = []
        const walk = (groups: PartialProfileGroup<CollapsableProfileGroup>[]) => {
            for (const group of groups) {
                for (const p of group.profiles ?? []) {
                    if (p.id) { ids.push(p.id) }
                }
                if (!(group as CollapsableProfileGroup).collapsed) {
                    walk((group as any).children ?? [])
                }
            }
        }
        walk(this.rootGroups as any)
        this.visibleProfileIds = ids
        // 清理已消失的选中项
        for (const id of [...this.selection]) {
            if (!ids.includes(id)) {
                this.selection.delete(id)
            }
        }
    }

    /** 递归收集分组树下的全部 profiles（不含模板/黑名单，树数据已过滤） */
    private collectGroupProfilesRecursively (group: PartialProfileGroup<CollapsableProfileGroup>): PartialProfile<Profile>[] {
        const result: PartialProfile<Profile>[] = [...(group.profiles ?? [])]
        for (const child of (group as any).children ?? []) {
            result.push(...this.collectGroupProfilesRecursively(child))
        }
        return result
    }

    // AISHELL: ===== 批量操作 =====

    private groupMoveMenuItems (): { label: string, click: () => void }[] {
        const items: { label: string, click: () => void }[] = [
            { label: this.translate.instant('Ungrouped'), click: () => this.moveSelectionToGroup(null) },
        ]
        for (const group of this.profileGroups) {
            if (!group.editable) { continue }
            const path = this.profilesService.resolveProfileGroupPath(group.id).join(' / ')
            items.push({ label: path, click: () => this.moveSelectionToGroup(group.id) })
        }
        return items
    }

    async batchConnect (): Promise<void> {
        await this.launchProfiles(this.getSelectedProfiles())
    }

    private async launchProfiles (profiles: PartialProfile<Profile>[]): Promise<void> {
        for (const profile of profiles) {
            await this.profilesService.launchProfile(profile)
        }
    }

    async batchMoveMenu (): Promise<void> {
        this.platform.popupContextMenu([
            { type: 'submenu', label: this.translate.instant('Move to group'), submenu: this.groupMoveMenuItems() },
        ])
    }

    async moveSelectionToGroup (groupId: string|null): Promise<void> {
        const selected = this.getSelectedProfiles()
        if (!selected.length) { return }
        await this.profilesService.bulkMoveProfiles(selected, groupId)
        await this.config.save()
    }

    async batchDuplicate (): Promise<void> {
        const selected = this.getSelectedProfiles()
        if (!selected.length) { return }
        await this.profilesService.duplicateProfiles(selected)
        await this.config.save()
    }

    async batchDelete (): Promise<void> {
        const selected = this.getSelectedProfiles()
        if (!selected.length) { return }
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete {n} profiles?', { n: selected.length }),
            detail: selected.map(p => p.name).slice(0, 10).join('\n') + (selected.length > 10 ? '\n…' : ''),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) { return }
        const ids = new Set(selected.map(p => p.id))
        await this.profilesService.bulkDeleteProfiles(p => ids.has(p.id))
        this.clearSelection()
        await this.config.save()
    }

    // AISHELL: ===== 拖拽 =====

    private isGroupDescendantOf (candidateId: string, ancestorId: string): boolean {
        let currentId: string|undefined = candidateId
        let depth = 0
        while (currentId && depth <= 30) {
            if (currentId === ancestorId) { return true }
            const group = this.profilesService.resolveProfileGroup(currentId)
            if (!group) { return false }
            currentId = group.parentGroupId
            depth++
        }
        return false
    }

    /** cdkDropList enterPredicate：限制可放置的目标 */
    canDropItem (item: CdkDrag, container: CdkDropList): boolean {
        const data = item.data as TreeDragItemData
        const target = container.data as TreeDragTargetData
        if (!data || !target) { return false }
        const targetEditable = target.group?.editable ?? false

        if (data.kind === 'profile') {
            if (target.kind === 'root') { return true }
            if (target.kind === 'group-header') {
                return targetEditable || target.group?.id === 'ungrouped'
            }
            if (target.kind === 'profiles') {
                return target.group?.id !== 'built-in' && target.group?.id !== 'search'
            }
            return false
        }
        if (data.kind === 'group') {
            if (target.kind === 'root') { return true }
            // AISHELL: 分组头和分组内容区都可作为放置目标（内容区大、易命中）
            if ((target.kind === 'group-header' || target.kind === 'profiles') && targetEditable && data.group) {
                // 不能拖到自身或自己的子孙分组
                return target.group!.id !== data.group.id &&
                    !this.isGroupDescendantOf(target.group!.id, data.group.id)
            }
            return false
        }
        return false
    }

    onDragStarted (): void {
        this.isDragging = true
    }

    onDragEnded (): void {
        this.isDragging = false
    }

    async onTreeDrop (event: CdkDragDrop<TreeDragTargetData>): Promise<void> {
        const item = event.item.data as TreeDragItemData
        const target = event.container.data as TreeDragTargetData
        if (!item || !target) { return }

        if (item.kind === 'profile' && item.profile) {
            let targetGroupId: string|null = null
            if (target.kind === 'group-header' || target.kind === 'profiles') {
                targetGroupId = target.group?.id === 'ungrouped' || target.group?.id === 'built-in' ? null : (target.group?.id ?? null)
            }
            // 拖拽的 profile 在选中集内 → 整批移动
            const moving = this.selection.has(item.profile.id ?? '') ? this.getSelectedProfiles() : [item.profile]
            if (moving.length === 0) { return }
            if (moving.every(p => (p.group ?? null) === targetGroupId)) { return }
            await this.profilesService.bulkMoveProfiles(moving, targetGroupId)
            await this.config.save()
        } else if (item.kind === 'group' && item.group) {
            let targetGroupId: string|null|undefined
            if (target.kind === 'root') {
                targetGroupId = undefined
            } else if ((target.kind === 'group-header' || target.kind === 'profiles') && target.group) {
                targetGroupId = target.group.id
            } else {
                return
            }
            if (item.group.parentGroupId === targetGroupId && target.kind !== 'root') { return }
            if (!this.canDropItem({ data: item } as CdkDrag, { data: target } as CdkDropList)) { return }

            // AISHELL: 文件夹移动二次确认 + 完成提示
            const sourcePath = this.profilesService.resolveProfileGroupPath(item.group.id ?? '').join(' / ')
            const targetPath = targetGroupId
                ? this.profilesService.resolveProfileGroupPath(targetGroupId).join(' / ')
                : this.translate.instant('Top level')
            const profileCount = this.collectGroupProfilesRecursively(item.group).length
            const childGroupCount = this.profilesService.collectDescendantGroupIds(item.group.id ?? '').length - 1
            const confirmResult = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Move folder "{name}"?', { name: item.group.name }),
                detail: this.translate.instant('{source} → {target} ({n} profiles, {m} subfolders)', { source: sourcePath, target: targetPath, n: profileCount, m: childGroupCount }),
                buttons: [
                    this.translate.instant('Move'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (confirmResult.response !== 0) { return }

            const groupCopy: any = deepClone(item.group)
            delete groupCopy.collapsed
            delete groupCopy.children
            delete groupCopy.profiles
            groupCopy.parentGroupId = targetGroupId
            await this.profilesService.writeProfileGroup(groupCopy)
            await this.config.save()
            this.notifications.info(
                this.translate.instant('Folder moved'),
                `${sourcePath} → ${targetPath}`,
            )
        }
    }

    // AISHELL: ===== 右键菜单（含批量项） =====

    async profileContextMenu (profile: PartialProfile<Profile>, event: MouseEvent): Promise<void> {
        event.preventDefault()

        // 该 profile 在选中集内且有多选 → 显示批量菜单
        if (this.selection.size > 1 && this.selection.has(profile.id ?? '')) {
            const n = this.selection.size
            this.platform.popupContextMenu([
                {
                    type: 'normal',
                    label: this.translate.instant('Connect selected ({n})', { n }),
                    click: () => this.batchConnect(),
                },
                {
                    type: 'submenu',
                    label: this.translate.instant('Move to group'),
                    submenu: this.groupMoveMenuItems(),
                },
                {
                    type: 'normal',
                    label: this.translate.instant('Duplicate selected'),
                    click: () => this.batchDuplicate(),
                },
                {
                    type: 'normal',
                    label: this.translate.instant('Delete selected'),
                    click: () => this.batchDelete(),
                },
                { type: 'separator' },
            ])
            return
        }

        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('Run'),
                click: () => this.launchProfile(profile),
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit profile'),
                click: () => this.editProfile(profile),
                enabled: !(profile.isBuiltin ?? profile.isTemplate),
            },
            // AISHELL: 单台服务器复制（配合分组右键"粘贴"）
            {
                type: 'normal',
                label: this.translate.instant('Copy profile'),
                click: () => {
                    if (profile.id) {
                        this.treeClipboard = { kind: 'profiles', ids: [profile.id] }
                    }
                },
                enabled: !(profile.isBuiltin ?? profile.isTemplate),
            },
            // AISHELL: 单台服务器删除
            { type: 'separator' },
            {
                type: 'normal',
                label: this.translate.instant('Delete profile'),
                click: () => this.deleteProfile(profile),
                enabled: !(profile.isBuiltin ?? profile.isTemplate),
            },
        ])
    }

    /** AISHELL: 删除单台服务器（带确认） */
    async deleteProfile (profile: PartialProfile<Profile>): Promise<void> {
        if (profile.isBuiltin || profile.isTemplate) { return }
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete profile "{name}"?', { name: profile.name }),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) { return }
        const id = profile.id
        if (!id) { return }
        await this.profilesService.bulkDeleteProfiles(p => p.id === id)
        this.selection.delete(id)
        await this.config.save()
    }

    async groupContextMenu (group: PartialProfileGroup<CollapsableProfileGroup>, event: MouseEvent): Promise<void> {
        event.preventDefault()

        const groupProfiles = this.collectGroupProfilesRecursively(group)

        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('Connect all in group'),
                click: () => this.launchProfiles(groupProfiles),
                enabled: groupProfiles.length > 0,
            },
            {
                type: 'normal',
                label: this.translate.instant('Select all in group'),
                click: () => {
                    for (const p of groupProfiles) {
                        if (p.id) { this.selection.add(p.id) }
                    }
                },
                enabled: groupProfiles.length > 0,
            },
            { type: 'separator' },
            {
                type: 'normal',
                label: group.collapsed ? this.translate.instant('Expand group') : this.translate.instant('Collapse group'),
                click: () => this.toggleGroupCollapse(group),
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit group'),
                click: () => this.editProfileGroup(group),
                enabled: group.editable,
            },
            // AISHELL: 分组复制/粘贴/删除
            { type: 'separator' },
            {
                type: 'normal',
                label: this.translate.instant('Copy group'),
                click: () => {
                    if (group.id) {
                        this.treeClipboard = { kind: 'group', id: group.id }
                    }
                },
                enabled: group.editable,
            },
            {
                type: 'normal',
                label: this.translate.instant('Paste'),
                click: () => this.pasteIntoGroup(group.id ?? null),
                enabled: group.editable && !!this.treeClipboard,
            },
            { type: 'separator' },
            {
                type: 'normal',
                label: this.translate.instant('Delete group'),
                click: () => this.deleteGroup(group),
                enabled: group.editable,
            },
        ])
    }

    // AISHELL: ===== 分组复制/粘贴/删除 =====

    /** 粘贴剪贴板内容到目标分组下（分组=整棵子树深拷贝；服务器=拷贝进该分组） */
    async pasteIntoGroup (targetGroupId: string|null): Promise<void> {
        if (!this.treeClipboard) { return }
        try {
            if (this.treeClipboard.kind === 'group') {
                const src = this.profilesService.resolveProfileGroup(this.treeClipboard.id)
                if (!src) {
                    this.treeClipboard = null
                    return
                }
                await this.profilesService.duplicateProfileGroupTree(src, targetGroupId)
            } else {
                const all = await this.profilesService.getProfiles()
                const selected = this.treeClipboard.ids
                    .map(id => all.find(p => p.id === id))
                    .filter((p): p is PartialProfile<Profile> => !!p && !(p.isBuiltin ?? p.isTemplate))
                if (selected.length) {
                    const copies = await this.profilesService.duplicateProfiles(selected)
                    for (const copy of copies) {
                        copy.group = targetGroupId ?? undefined
                    }
                }
            }
            await this.config.save()
        } catch (e) {
            console.error('AIShell paste failed:', e)
            this.notifications.error(this.translate.instant('Paste failed'), String(e))
        }
    }

    /** 删除分组树：空分组直接删；有内容时确认后连同内容删除 */
    async deleteGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        if (!group.id) { return }
        const descendantIds = this.profilesService.collectDescendantGroupIds(group.id)
        const childGroupCount = descendantIds.length - 1
        const profileCount = this.collectGroupProfilesRecursively(group).length

        if (profileCount > 0 || childGroupCount > 0) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Delete group "{name}" and its contents?', { name: group.name }),
                detail: this.translate.instant('{n} profiles, {m} subgroups will be deleted. This cannot be undone.', { n: profileCount, m: childGroupCount }),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response !== 0) { return }
            await this.profilesService.deleteProfileGroupTree(group, { deleteContents: true })
        } else {
            await this.profilesService.deleteProfileGroupTree(group, { deleteContents: false })
        }
        await this.config.save()
    }

    private async tabStateChanged (): Promise<void> {
        // TODO: show active tab in the side panel with eye icon
    }

    async launchProfile<P extends Profile> (profile: PartialProfile<P>): Promise<any> {
        return this.profilesService.launchProfile(profile)
    }

    async onFilterChange (): Promise<void> {
        try {
            const q = this.filter.trim().toLowerCase()

            if (q.length === 0) {
                this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
                this.rebuildVisibleProfileIds()
                return
            }

            const profiles = await this.profilesService.getProfiles({
                includeBuiltin: this.config.store.terminal.showBuiltinProfiles,
                clone: true,
            })

            // AISHELL: 搜索键除名称/描述外加入 host（堡垒机会话的名字是目标机 IP，host 是堡垒机 IP）
            for (const p of profiles) {
                (p as any).host = (p as any).options?.host ?? ''
            }
            const matches = new FuzzySearch(
                profiles.filter(p => !p.isTemplate),
                ['name', 'description', 'host'],
                { sort: false },
            ).search(q)
            const matchedProfileIds = new Set(matches.map(p => p.id ?? ''))

            // AISHELL: 文件夹名命中 → 保留整个子树；否则只保留命中的服务器/子孙文件夹
            const pruneGroup = (group: PartialProfileGroup<CollapsableProfileGroup>): PartialProfileGroup<CollapsableProfileGroup>|null => {
                const nameHit = (group.name ?? '').toLowerCase().includes(q)
                const children = ((group as any).children ?? [])
                    .map((child: PartialProfileGroup<CollapsableProfileGroup>) => pruneGroup(child))
                    .filter((child: PartialProfileGroup<CollapsableProfileGroup>|null): child is PartialProfileGroup<CollapsableProfileGroup> => !!child)
                const groupProfiles = nameHit ? (group.profiles ?? []) : (group.profiles ?? []).filter(p => matchedProfileIds.has(p.id ?? ''))
                if (!nameHit && children.length === 0 && groupProfiles.length === 0) { return null }
                return {
                    ...group,
                    children,
                    profiles: groupProfiles,
                    collapsed: false, // 搜索结果全部展开
                }
            }

            const fullTree = this.profilesService.buildGroupTree(this.profileGroups as any) as any
            this.rootGroups = fullTree
                .map((g: any) => pruneGroup(g))
                .filter((g: PartialProfileGroup<CollapsableProfileGroup>|null): g is PartialProfileGroup<CollapsableProfileGroup> => !!g)
            this.rebuildVisibleProfileIds()
        } catch (error) {
            console.error('Error occurred during search:', error)
        }
    }

    ////// RESIZING //////
    startResize (event: MouseEvent): void {
        this.panelIsResizing = true
        this.panelStartX = event.clientX
        this.panelStartWidth = this.panelWidth
        event.preventDefault()
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove (event: MouseEvent): void {
        if (!this.panelIsResizing || this.collapsed) { return }
        const delta = event.clientX - this.panelStartX
        const width = Math.min(Math.max(this.panelMinWidth, this.panelStartWidth + delta), this.panelMaxWidth)
        this.panelWidth = width
        window.localStorage.profileTreeWidth = width
    }

    @HostListener('document:mouseup')
    stopResize (): boolean {
        this.panelIsResizing = false
        return true
    }

    @HostBinding('style.width.px')
    get panelWidth (): number {
        // AISHELL: 收起时宽度归零（配 SCSS 过渡动画），内容 overflow hidden
        return this.collapsed ? 0 : this.panelInternalWidth
    }

    set panelWidth (value: number) {
        this.panelInternalWidth = value
    }

    ////// GROUP COLLAPSING //////
    toggleGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        group.collapsed = !group.collapsed
        this.saveProfileGroupCollapse(group)
        this.rebuildVisibleProfileIds()
    }

    private saveProfileGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        profileGroupCollapsed[group.id] = group.collapsed
        window.localStorage.profileGroupCollapsed = JSON.stringify(profileGroupCollapsed)
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }

}
