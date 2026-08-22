import { Injectable } from '@angular/core'
import { ProfilesService, PartialProfile, Profile } from 'tabby-core'

import { VARS_KEY } from '../api'

/**
 * 变量替换引擎：供登录脚本（连接后自动命令）、批量命令、模板实例化共用。
 * 支持 $VAR 与 ${VAR} 两种写法。
 */
@Injectable({ providedIn: 'root' })
export class VariableSubstitutionService {

    constructor (private profilesService: ProfilesService) { }

    /**
     * 构建 profile 的完整变量上下文：内置变量 + profile 自定义变量
     */
    async buildContext (profile: PartialProfile<Profile>): Promise<Record<string, string>> {
        const options = (profile.options ?? {}) as Record<string, any>
        const groupPath = this.profilesService.resolveProfileGroupPath(profile.group ?? '').join('/')

        const context: Record<string, string> = {
            SERVER_NAME: profile.name ?? '',
            SERVER_IP: options['host'] ?? '',
            SERVER_HOST: options['host'] ?? '',
            SERVER_PORT: String(options['port'] ?? ''),
            SERVER_USER: options['user'] ?? '',
            SERVER_GROUP: groupPath,
        }

        const vars = options[VARS_KEY]
        if (vars && typeof vars === 'object') {
            for (const [key, value] of Object.entries(vars)) {
                context[key] = String(value)
            }
        }

        return context
    }

    /**
     * 替换文本中的 $VAR / ${VAR}
     */
    substitute (text: string, context: Record<string, string>): string {
        if (!text) { return text }
        return text.replace(
            /\$\{(\w+)\}|\$(\w+)/g,
            (match, braced, plain) => {
                const name = braced ?? plain
                return Object.prototype.hasOwnProperty.call(context, name) ? context[name] : match
            },
        )
    }
}
