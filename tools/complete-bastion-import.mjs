/**
 * AISHELL: 完成 SecureCRT 会话到 Tabby 配置的转换。
 *
 * 前置状态：587 个 profile 已由早前导入（含堡垒机 host/user/password），分组为扁平
 * 的 "站点/模块" 命名，仅 2 个 profile 手工配置了登录脚本。
 *
 * 本脚本做两件事：
 * 1. 分组嵌套化：「站点/模块」扁平组 → 站点根组 + 模块子组（parentGroupId），
 *    与 SecureCRT Sessions 目录树一致；
 * 2. 补全堡垒机跳转登录脚本（复用用户已验证的 172.16.12.249 模式）：
 *    expect '$' → send 'ssh log@<目标IP>'
 *    expect ':' → send 'log*gexin'
 *    纯 ASCII 模块名再加 expect '$' → send 'cd /app/newgetui/<模块>/logs'（跟随
 *    gtps-fcm 已确认的部署路径约定，猜错只是多一行 no such file 报错，无副作用）
 *
 * 跳过：已配置有效脚本的 profile；3 个 log@172.16.12.66 直连会话（拓扑不明，留手工处理）。
 *
 * 用法：node tools/complete-bastion-import.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// 复用 tabby 的 yaml 依赖
const require = createRequire(join(repoRoot, 'tabby', 'package.json'))
const YAML = require('yaml')

const dry = process.argv.includes('--dry')
const configPath = join(process.env.APPDATA, 'tabby', 'config.yaml')

const cfg = YAML.parse(readFileSync(configPath, 'utf8'))
const groups = cfg.groups
const profiles = cfg.profiles

// ---------- 1. 分组嵌套化 ----------
const siteRoots = new Map() // siteName -> group object
let nested = 0
for (const g of groups) {
    if (!g.name.includes('/')) { continue }
    const idx = g.name.indexOf('/')
    const site = g.name.slice(0, idx)
    const module = g.name.slice(idx + 1)
    if (!siteRoots.has(site)) {
        const root = { id: randomUUID(), name: site }
        groups.push(root)
        siteRoots.set(site, root)
    }
    const original = g.name
    g.name = module
    g.parentGroupId = siteRoots.get(site).id
    nested++
    if (nested <= 3 || !nested) { void original }
}
console.log(`嵌套化分组: ${nested} 个模块组挂到 ${siteRoots.size} 个站点根组下`)

const groupById = new Map(groups.map(g => [g.id, g]))

// ---------- 2. 补全登录脚本 ----------
const MODULE_PATH_OK = /^[A-Za-z][A-Za-z0-9-]*$/
const hasRealScripts = p => (p.options?.scripts ?? []).some(s => (s.send ?? '').trim() !== '')

let added = 0, skippedScripted = 0, skippedDirect = 0, withCd = 0
for (const p of profiles) {
    const o = p.options ?? {}
    if (hasRealScripts(p)) { skippedScripted++; continue }
    // 3 个 log@172.16.12.66 直连会话：拓扑不明，不自动加脚本
    if (o.user === 'log' && o.host === '172.16.12.66') { skippedDirect++; continue }
    if (!o.host || !o.user) { continue }

    const scripts = [
        { expect: '$', send: `ssh log@${p.name}` },
        { expect: ':', send: 'log*gexin' },
    ]
    const groupName = groupById.get(p.group)?.name ?? ''
    // 嵌套化后 group.name 就是模块名；根组（站点）名不含模块 → 不加 cd
    if (MODULE_PATH_OK.test(groupName)) {
        scripts.push({ expect: '$', send: `cd /app/newgetui/${groupName.toLowerCase()}/logs` })
        withCd++
    }
    o.scripts = scripts
    added++
}
console.log(`补全登录脚本: ${added} 个（含 cd ${withCd} 个），跳过已有脚本 ${skippedScripted} 个、直连会话 ${skippedDirect} 个`)

// ---------- 写回 ----------
if (dry) {
    console.log('[dry-run] 未写回')
} else {
    writeFileSync(configPath, YAML.stringify(cfg), 'utf8')
    console.log(`已写回 ${configPath}`)
    // 回读校验
    const check = YAML.parse(readFileSync(configPath, 'utf8'))
    const roots = check.groups.filter(g => !g.parentGroupId).length
    const children = check.groups.filter(g => g.parentGroupId).length
    console.log(`校验: profiles=${check.profiles.length} groups=${check.groups.length}（根组 ${roots} / 子组 ${children}）`)
}
