import { PartialProfile, Profile } from 'tabby-core'

/**
 * AIShell 连接模板：存储一组 profile 选项（Keepalive / 登录脚本 / 跳板机 / 自定义变量等），
 * 可批量实例化为真实服务器连接，实例通过 aishell:templateId 关联回模板。
 */
export interface AIShellTemplate {
    id: string
    name: string
    /** ProfileProvider id，如 'ssh' */
    profileType: string
    /** 模板携带的 profile options（不含 host/user/port 等实例字段） */
    options: Record<string, any>
    /** 自定义变量（实例化时替换到登录脚本等位置） */
    vars: Record<string, string>
    createdAt: number
}

/** 服务器清单行：`host`、`user@host`、`host:port` 或 `user@host:port`，可后缀 ` #备注名` */
export interface ServerRow {
    host: string
    user?: string
    port?: number
    name?: string
}

/** 从模板派生的 profile 在 options 里记录模板 id */
export const TEMPLATE_ID_KEY = 'aishell:templateId'
export const VARS_KEY = 'aishell:vars'

/** 同步模板时不应覆盖的实例专属字段 */
export const SYNC_RESERVED_KEYS = ['host', 'port', 'user', 'name', 'password', TEMPLATE_ID_KEY, VARS_KEY]

export type PartialProfileWithTemplate = PartialProfile<Profile> & { options?: Record<string, any> }
