/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, Optional, Inject, HostBinding, HostListener, NgZone } from '@angular/core'
import { auditTime, interval } from 'rxjs'
import { TabContextMenuItemProvider } from '../api/tabContextMenuProvider'
import { BaseTabComponent } from './baseTab.component'
import { SplitTabComponent } from './splitTab.component'
import { HotkeysService } from '../services/hotkeys.service'
import { AppService } from '../services/app.service'
import { HostAppService, Platform } from '../api/hostApp'
import { ConfigService } from '../services/config.service'
import { BaseComponent } from './base.component'
import { MenuItemOptions } from '../api/menu'
import { PlatformService } from '../api/platform'

/** @hidden */
@Component({
    selector: 'tab-header',
    templateUrl: './tabHeader.component.pug',
    styleUrls: ['./tabHeader.component.scss'],
})
export class TabHeaderComponent extends BaseComponent {
    @Input() index: number
    @Input() @HostBinding('class.active') active: boolean
    @Input() tab: BaseTabComponent
    @Input() progress: number|null
    Platform = Platform

    constructor (
        public app: AppService,
        public config: ConfigService,
        public hostApp: HostAppService,
        private hotkeys: HotkeysService,
        private platform: PlatformService,
        private zone: NgZone,
        @Optional() @Inject(TabContextMenuItemProvider) protected contextMenuProviders: TabContextMenuItemProvider[],
    ) {
        super()
        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, (hotkey) => {
            if (this.app.activeTab === this.tab) {
                if (hotkey === 'rename-tab') {
                    this.app.renameTab(this.tab)
                }
            }
        })
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    ngOnInit () {
        this.subscribeUntilDestroyed(this.tab.progress$.pipe(
            auditTime(300),
        ), progress => {
            this.zone.run(() => {
                this.progress = progress
            })
        })
        // AISHELL: 连接状态点——蓝点（未查看的新输出）即时跟随 activity$，
        // 会话状态（绿/红）低频轮询（session 变化无跨包可订阅事件）
        this.subscribeUntilDestroyed(this.tab.activity$, hasActivity => {
            this.zone.run(() => this.recomputeStatus(hasActivity))
        })
        this.subscribeUntilDestroyed(interval(500), () => {
            this.recomputeStatus()
        })
    }

    /** AISHELL: 绿=已连接已查看；蓝=有未查看新输出；红=连接断开/失败；null=非终端或连接中 */
    statusDot: 'green'|'blue'|'red'|null = null

    private recomputeStatus (hasActivityOverride?: boolean): void {
        const tab: any = this.tab
        const hasActivity = hasActivityOverride ?? tab.hasActivity
        if (hasActivity) {
            this.statusDot = 'blue'
            return
        }
        // SplitTabComponent 容器需展开；duck-typing 判终端标签（core 不能依赖 tabby-terminal）
        const tabs: any[] = tab.getAllTabs ? tab.getAllTabs() : [tab]
        const terminals = tabs.filter((t: any) => t && 'session' in t)
        if (!terminals.length) {
            this.statusDot = null
            return
        }
        if (terminals.some((t: any) => t.session === null && t.reconnectOffered)) {
            this.statusDot = 'red'
            return
        }
        this.statusDot = terminals.some((t: any) => t.session?.open) ? 'green' : null
    }

    async buildContextMenu (): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        // Top-level tab menu
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(this.tab, true)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        if (this.tab instanceof SplitTabComponent) {
            const tab = this.tab.getFocusedTab()
            if (tab) {
                for (let section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(tab, true)))) {
                    // eslint-disable-next-line @typescript-eslint/no-loop-func
                    section = section.filter(item => !items.some(ex => ex.label === item.label))
                    if (section.length) {
                        items.push({ type: 'separator' })
                        items = items.concat(section)
                    }
                }
            }
        }
        return items.slice(1)
    }

    onTabDragStart (tab: BaseTabComponent) {
        this.app.emitTabDragStarted(tab)
    }

    onTabDragEnd () {
        setTimeout(() => {
            this.app.emitTabDragEnded()
            this.app.emitTabsChanged()
        })
    }

    @HostBinding('class.flex-width') get isFlexWidthEnabled (): boolean {
        return this.config.store.appearance.flexTabs
    }

    @HostListener('dblclick', ['$event']) onDoubleClick ($event: MouseEvent): void {
        this.app.renameTab(this.tab)
        $event.stopPropagation()
    }

    @HostListener('mousedown', ['$event']) async onMouseDown ($event: MouseEvent) {
        if ($event.which === 2) {
            $event.preventDefault()
        }
    }

    @HostListener('mouseup', ['$event']) async onMouseUp ($event: MouseEvent) {
        if ($event.which === 2) {
            this.app.closeTab(this.tab, true)
        }
    }

    @HostListener('contextmenu', ['$event']) async onContextMenu ($event: MouseEvent) {
        $event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(), $event)
    }
}
