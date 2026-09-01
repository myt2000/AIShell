/**
 * AISHELL: 日志自动查询规则。
 * 字段位置统一使用从 1 开始的文档编号，避免和 JavaScript 下标混淆。
 */

export interface LogModuleRule {
    id: string
    path: string
}

export interface LogQueryRequest {
    taskId: string
    cid: string
    appId?: string
    date?: string
    server?: string
    mode?: 'auto' | 'confirm'
}

export interface LogQueryStep {
    module: string
    logType: string
    command: string
}

export const LOG_MODULES: Record<string, LogModuleRule> = {
    spd: { id: 'spd', path: '/app/newgetui/spd/logs' },
    psc: { id: 'psc', path: '/app/newgetui/psc/logs' },
    os: { id: 'os', path: '/app/newgetui/openservice/logs' },
    mmp: { id: 'mmp', path: '/app/newgetui/mmp/logs' },
    im: { id: 'im', path: '/app/newgetui/im/logs' },
    cm: { id: 'cm', path: '/app/newgetui/cm/logs' },
    as: { id: 'as', path: '/app/newgetui/as/logs' },
    sdp: { id: 'sdp', path: '/app/newgetui/sdp/logs' },
    omp: { id: 'omp', path: '/app/newgetui/omp/logs' },
    gtpr: { id: 'gtpr', path: '/app/newgetui/gtpr/logs' },
    gpmrs: { id: 'gpmrs', path: '/app/newgetui/gpmrs/logs' },
    apn: { id: 'apn', path: '/app/newgetui/apn/logs' },
    apns: { id: 'apns', path: '/app/newgetui/apns/logs' },
    'gtps-hw': { id: 'gtps-hw', path: '/app/newgetui/gtps-hw/logs' },
    'gtps-xm': { id: 'gtps-xm', path: '/app/newgetui/gtps-xm/logs' },
    'gtps-mz': { id: 'gtps-mz', path: '/app/newgetui/gtps-mz/logs' },
    'gtps-op': { id: 'gtps-op', path: '/app/newgetui/gtps-op/logs' },
    'gtps-vv': { id: 'gtps-vv', path: '/app/newgetui/gtps-vv/logs' },
    'gtps-ho': { id: 'gtps-ho', path: '/app/newgetui/gtps-ho/logs' },
    'hps-hoshw': { id: 'hps-hoshw', path: '/app/newgetui/hps-hoshw/logs' },
}

export const INITIAL_MODULES: Record<string, string> = {
    RASA: 'spd',
    GT: 'spd',
    RASL: 'psc',
    RASS: 'psc',
    OSL: 'os',
    OSS: 'os',
    MM: 'mmp',
}

export const VENDOR_SUCCESS_MODULES: Record<string, string> = {
    GTPS_HW_SUCCESS: 'gtps-hw',
    GTPS_XM_SUCCESS: 'gtps-xm',
    GTPS_VV_SUCCESS: 'gtps-vv',
    GTPS_OP_SUCCESS: 'gtps-op',
    GTPS_MZ_SUCCESS: 'gtps-mz',
    HPS_HOSHW_SUCCESS: 'hps-hoshw',
    IOS_SUCCESS: 'apn',
}

export const READONLY_LOG_TYPES = new Set([
    'rp-bi',
    'rp-message',
    'rp-command',
    'push-result',
    'rp-logout',
    'gexin-bi-display',
    // AISHELL: 按日志排查流程文档补充的各模块主查类型
    'rp-broadcasting',
    'rp-login',
])

/**
 * AISHELL: 各模块主要查询的日志类型（docs/日志排查流程文档.md）。
 * 未列出的模块使用通用白名单 READONLY_LOG_TYPES。
 */
export const MODULE_LOG_TYPES: Record<string, string[]> = {
    'gtps-hw': ['rp-bi', 'rp-message', 'push-result', 'rp-broadcasting'],
    'gtps-ho': ['rp-bi', 'rp-message', 'push-result', 'rp-broadcasting'],
    'hps-hoshw': ['rp-bi', 'rp-message', 'push-result', 'rp-broadcasting'],
    'gtps-op': ['rp-bi', 'rp-message', 'push-result', 'rp-broadcasting', 'rp-login'],
    'gtps-vv': ['rp-bi', 'rp-message', 'push-result', 'rp-login'],
    'gtps-xm': ['rp-bi', 'rp-message', 'push-result'],
    'gtps-mz': ['rp-bi', 'rp-message', 'push-result'],
    gtpr: ['rp-bi'],
}

/** 模块允许查询的日志类型集合（模块表 ∪ 通用白名单） */
export function allowedLogTypesFor (module: string): Set<string> {
    const extra = MODULE_LOG_TYPES[module] ?? []
    return new Set([...READONLY_LOG_TYPES, ...extra])
}

export function initialModuleForTask (taskId: string): string|null {
    const prefix = taskId.trim().split('_', 1)[0].toUpperCase()
    return INITIAL_MODULES[prefix] ?? null
}

export function normaliseDate (value: string|undefined): string|undefined {
    if (!value) { return undefined }
    const compact = value.replace(/-/g, '')
    return /^20\d{6}$/.test(compact) ? compact : undefined
}

/** 从常见 task_id 的 MMDD 段推断日志日期；年份仍需由用户或当前日期提供。 */
export function dateFromTaskId (taskId: string, now = new Date()): string|undefined {
    const match = /_(\d{4})(?:_|$)/.exec(taskId)
    if (!match) { return undefined }
    const month = parseInt(match[1].slice(0, 2), 10)
    const day = parseInt(match[1].slice(2), 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) { return undefined }
    let year = now.getFullYear()
    const candidate = new Date(year, month - 1, day)
    if (candidate.getTime() > now.getTime()) {
        year--
    }
    return `${year}${match[1]}`
}
