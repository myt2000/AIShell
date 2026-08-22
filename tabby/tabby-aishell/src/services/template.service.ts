import { Injectable } from '@angular/core'
import { ConfigService, ProfilesService, PartialProfile, Profile } from 'tabby-core'

import { AIShellTemplate, ServerRow, TEMPLATE_ID_KEY, VARS_KEY, SYNC_RESERVED_KEYS } from '../api'

function generateId (): string {
    return `aishell-tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 模板系统：模板 CRUD、批量实例化、模板变更同步到派生 profile
 */
@Injectable({ providedIn: 'root' })
export class TemplateService {

    constructor (
        private config: ConfigService,
        private profilesService: ProfilesService,
    ) { }

    getTemplates (): AIShellTemplate[] {
        const aishell = (this.config.store as any).aishell
        return aishell?.templates ?? []
    }

    private async writeTemplates (templates: AIShellTemplate[]): Promise<void> {
        const store = this.config.store as any
        store.aishell ??= {}
        store.aishell.templates = templates
        await this.config.save()
    }

    async createTemplate (name: string, profileType: string, options: Record<string, any>, vars: Record<string, string> = {}): Promise<AIShellTemplate> {
        const template: AIShellTemplate = {
            id: generateId(),
            name,
            profileType,
            options: deepClone(options),
            vars: { ...vars },
            createdAt: Date.now(),
        }
        await this.writeTemplates([...this.getTemplates(), template])
        return template
    }

    async updateTemplate (template: AIShellTemplate): Promise<void> {
        const templates = this.getTemplates().map(t => t.id === template.id ? deepClone(template) : t)
        await this.writeTemplates(templates)
    }

    async deleteTemplate (template: AIShellTemplate): Promise<void> {
        await this.writeTemplates(this.getTemplates().filter(t => t.id !== template.id))
    }

    /**
     * 解析服务器清单文本，每行支持：
     *   host / user@host / host:port / user@host:port，行尾可用 # 跟随备注名
     */
    parseServerLines (text: string): { rows: ServerRow[], errors: string[] } {
        const rows: ServerRow[] = []
        const errors: string[] = []
        for (const rawLine of text.split(/\r?\n/)) {
            let line = rawLine.trim()
            if (!line || line.startsWith('#')) { continue }
            let name: string|undefined
            const hashIdx = line.indexOf('#')
            if (hashIdx !== -1) {
                const namePart = line.slice(hashIdx + 1).trim()
                name = namePart || undefined
                line = line.slice(0, hashIdx).trim()
            }
            const match = line.match(/^(?:(\S+)@)?(\[?[^\]]+\]?)(?::(\d+))?$/)
            if (!match || !match[2]) {
                errors.push(rawLine)
                continue
            }
            const row: ServerRow = { host: match[2].replace(/^\[|\]$/g, '') }
            if (match[1]) { row.user = match[1] }
            if (match[3]) { row.port = parseInt(match[3], 10) }
            if (name) { row.name = name }
            rows.push(row)
        }
        return { rows, errors }
    }

    /**
     * 批量实例化：按清单 + 模板生成 profiles，放入指定分组
     */
    async instantiate (template: AIShellTemplate, rows: ServerRow[], groupId: string|null): Promise<PartialProfile<Profile>[]> {
        const created: PartialProfile<Profile>[] = []
        for (const row of rows) {
            const options: Record<string, any> = deepClone(template.options)
            options['host'] = row.host
            if (row.user ?? template.options['user']) { options['user'] = row.user ?? template.options['user'] }
            if (row.port ?? template.options['port']) { options['port'] = row.port ?? template.options['port'] }
            options[TEMPLATE_ID_KEY] = template.id
            if (template.vars && Object.keys(template.vars).length) {
                options[VARS_KEY] = { ...template.vars }
            }
            const profile: PartialProfile<Profile> = {
                type: template.profileType,
                name: row.name ?? row.host,
                options,
            } as PartialProfile<Profile>
            if (groupId) { profile.group = groupId }
            await this.profilesService.newProfile(profile)
            created.push(profile)
        }
        await this.config.save()
        return created
    }

    /** 找到从某模板派生的全部 profiles */
    async findDerivedProfiles (templateId: string): Promise<PartialProfile<Profile>[]> {
        const profiles = await this.profilesService.getProfiles({ includeBuiltin: false, clone: false })
        return profiles.filter(p => (p.options as any)?.[TEMPLATE_ID_KEY] === templateId)
    }

    /**
     * 模板变更同步：把模板 options 重新应用到派生 profiles（跳过实例专属字段）
     */
    async syncToDerived (template: AIShellTemplate): Promise<number> {
        const derived = await this.findDerivedProfiles(template.id)
        const stored = this.config.store.profiles
        const derivedIds = new Set(derived.map(p => p.id))
        let count = 0
        for (const p of stored) {
            if (!derivedIds.has(p.id)) { continue }
            p.options ??= {}
            for (const [key, value] of Object.entries(template.options)) {
                if (SYNC_RESERVED_KEYS.includes(key)) { continue }
                p.options[key] = deepClone(value)
            }
            count++
        }
        if (count > 0) {
            await this.config.save()
        }
        return count
    }
}

export function deepClone<T> (value: T): T {
    return JSON.parse(JSON.stringify(value))
}
