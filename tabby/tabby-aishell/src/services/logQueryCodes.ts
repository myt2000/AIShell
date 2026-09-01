/**
 * AISHELL: 推送链路错误码/回执码规则库。
 * 数据来源：docs/日志排查流程文档.md（各厂商错误码 + gtpr 回执 actionId）。
 * 用法：执行器把日志中的码自动翻译为结论；AI 提示词只注入速查表，
 * 完整表按需查询，避免撑爆上下文。
 */

export type ReceiptKind = 'arrive' | 'click' | 'transmit-arrive' | 'fail' | 'info'

export interface ReceiptEntry {
    channel: string
    kind: ReceiptKind
    desc: string
}

/** 个推在线链路（as/rp-message）与 gtpr 回执的 actionId 统一表 */
export const RECEIPT_ACTION_IDS: Record<string, ReceiptEntry> = {
    // 个推通道
    '0': { channel: '个推', kind: 'arrive', desc: '个推到达' },
    '10000': { channel: '个推', kind: 'info', desc: '通知展示' },
    '10010': { channel: '个推', kind: 'click', desc: '通知点击' },
    '10030': { channel: '个推', kind: 'transmit-arrive', desc: '透传到达或通知启动应用' },
    '10009': { channel: 'APNs', kind: 'info', desc: 'iOS 展示' },
    '10019': { channel: 'APNs', kind: 'click', desc: 'iOS 点击' },
    '60002': { channel: '个推', kind: 'click', desc: '透传消息点击' },
    // 华为（安卓）
    '110000': { channel: '华为', kind: 'arrive', desc: '成功送达' },
    '110020': { channel: '华为', kind: 'fail', desc: '设备不在线' },
    '110030': { channel: '华为', kind: 'fail', desc: '应用未安装（通常已卸载）' },
    '110040': { channel: '华为', kind: 'fail', desc: '已弃用' },
    '110060': { channel: '华为', kind: 'fail', desc: 'Token 在当前终端用户下不存在/不一致（清数据、卸载重装、deleteToken、恢复出厂等）' },
    '110070': { channel: '华为', kind: 'fail', desc: '通知栏消息不展示（通知总开关/渠道开关关闭）' },
    '110080': { channel: '华为', kind: 'fail', desc: 'PushAPK 不允许弹通知栏（手机管家设置）' },
    '110090': { channel: '华为', kind: 'fail', desc: 'PushAPK 不允许弹通知栏（手机管家设置）' },
    '110100': { channel: '华为', kind: 'fail', desc: 'SDK 不允许弹通知栏（通知中心禁止展示）' },
    '110180': { channel: '华为', kind: 'fail', desc: '非活跃设备（30 天未联网，消息不下发）' },
    '110130': { channel: '华为', kind: 'fail', desc: '无设备路由信息' },
    '110140': { channel: '华为', kind: 'fail', desc: '设备在其他大区' },
    '110150': { channel: '华为', kind: 'fail', desc: '系统内部网络异常' },
    '110160': { channel: '华为', kind: 'fail', desc: '离线用户消息管控（collapse_key 覆盖/超 120 条缓存）' },
    '110018': { channel: '华为', kind: 'fail', desc: '应用华为 Push 通道开关被关闭' },
    '110019': { channel: '华为', kind: 'fail', desc: '目标用户 Push token 与本地不一致' },
    '110200': { channel: '华为', kind: 'fail', desc: 'Push 消息类型不对' },
    '110022': { channel: '华为', kind: 'fail', desc: 'userId 不匹配（多用户）' },
    '110024': { channel: '华为', kind: 'info', desc: 'userId 不匹配但不校验' },
    '110025': { channel: '华为', kind: 'info', desc: '本地无 App token 但不校验' },
    '110026': { channel: '华为', kind: 'info', desc: 'token 不一致但不校验' },
    '110027': { channel: '华为', kind: 'fail', desc: '目标应用进程不存在，透传消息被缓存' },
    '110028': { channel: '华为', kind: 'transmit-arrive', desc: '透传消息启动服务成功' },
    '110031': { channel: '华为', kind: 'fail', desc: '系统版本或应用不支持该消息' },
    '110051': { channel: '华为', kind: 'fail', desc: '开机未解锁状态' },
    '110102': { channel: '华为', kind: 'fail', desc: '营销类消息被频控（单设备单应用每日 3000 条，超限 24h）' },
    '110144': { channel: '华为', kind: 'fail', desc: '请检查 profile_id 字段' },
    '110201': { channel: '华为', kind: 'fail', desc: '无效 token 管控，服务端不下发' },
    '110256': { channel: '华为', kind: 'fail', desc: '资讯营销类当日超限/违规停发' },
    '1102010': { channel: '华为', kind: 'fail', desc: '用户已切换服务地（旧 Token 失效）' },
    '1102012': { channel: '华为', kind: 'fail', desc: '应用已卸载' },
    '1102015': { channel: '华为', kind: 'fail', desc: 'Token 与当前登录用户不匹配（多用户）' },
    '1102016': { channel: '华为', kind: 'fail', desc: '用户关闭了通知栏消息显示' },
    // 鸿蒙
    '330000': { channel: '鸿蒙', kind: 'arrive', desc: '成功送达' },
    '330030': { channel: '鸿蒙', kind: 'fail', desc: '应用未安装（已卸载）' },
    '330060': { channel: '鸿蒙', kind: 'fail', desc: 'Token 在当前终端用户下不存在/不一致' },
    '330070': { channel: '鸿蒙', kind: 'fail', desc: '通知消息不展示（通知总开关/渠道开关关闭）' },
    '330180': { channel: '鸿蒙', kind: 'fail', desc: '非活跃设备（30 天未联网）' },
    '330150': { channel: '鸿蒙', kind: 'fail', desc: '系统内部网络异常' },
    '330160': { channel: '鸿蒙', kind: 'fail', desc: '离线用户消息管控（collapse_key 覆盖）' },
    '330022': { channel: '鸿蒙', kind: 'fail', desc: 'userId 不匹配（多用户）' },
    '330027': { channel: '鸿蒙', kind: 'fail', desc: '应用进程不存在，透传消息被缓存' },
    '330031': { channel: '鸿蒙', kind: 'fail', desc: '系统版本或应用不支持该消息' },
    '330051': { channel: '鸿蒙', kind: 'fail', desc: '开机未解锁状态' },
    '330102': { channel: '鸿蒙', kind: 'fail', desc: '消息频控丢弃' },
    '330144': { channel: '鸿蒙', kind: 'fail', desc: 'profileId 不存在' },
    '330256': { channel: '鸿蒙', kind: 'fail', desc: '消息频次限制' },
    // 荣耀
    '180001': { channel: '荣耀', kind: 'transmit-arrive', desc: '透传到达' },
    '180002': { channel: '荣耀', kind: 'arrive', desc: '通知栏到达' },
    '180003': { channel: '荣耀', kind: 'fail', desc: '应用未安装' },
    '180004': { channel: '荣耀', kind: 'fail', desc: 'Token 在当前终端用户下不存在' },
    '180005': { channel: '荣耀', kind: 'fail', desc: '通知栏消息不展示' },
    '180006': { channel: '荣耀', kind: 'fail', desc: '目标应用被禁用' },
    '180008': { channel: '荣耀', kind: 'fail', desc: '不支持的消息类型' },
    '180009': { channel: '荣耀', kind: 'fail', desc: '消息重复发送/超过配额' },
    '180011': { channel: '荣耀', kind: 'fail', desc: '通知栏跳转目标页面失败' },
    '180013': { channel: '荣耀', kind: 'fail', desc: '系统息屏管控（亮屏后重新下发）' },
    '180014': { channel: '荣耀', kind: 'fail', desc: 'userId 不匹配当前终端用户' },
    '180015': { channel: '荣耀', kind: 'fail', desc: '通知栏展示失败（Intent 校验不过/超展示上限）' },
    '180000': { channel: '荣耀', kind: 'fail', desc: '应用进程不存在，透传消息被缓存' },
    // 小米 / 小米海外
    '120000': { channel: '小米', kind: 'arrive', desc: '消息送达' },
    '120010': { channel: '小米', kind: 'click', desc: '消息点击' },
    '120020': { channel: '小米', kind: 'fail', desc: '目标设备无效' },
    '120030': { channel: '小米', kind: 'fail', desc: '客户端调用 disablePush 禁用' },
    '120040': { channel: '小米', kind: 'fail', desc: '目标设备不符合过滤条件' },
    '120050': { channel: '小米', kind: 'fail', desc: '当日推送总量超限' },
    '120060': { channel: '小米', kind: 'fail', desc: '消息有效期 TTL 过期' },
    '190000': { channel: '小米海外', kind: 'arrive', desc: '消息送达' },
    '190010': { channel: '小米海外', kind: 'click', desc: '消息点击' },
    '190020': { channel: '小米海外', kind: 'fail', desc: '目标设备无效' },
    '190030': { channel: '小米海外', kind: 'fail', desc: '客户端禁用 Push' },
    '190040': { channel: '小米海外', kind: 'fail', desc: '不符合过滤条件' },
    // 魅族
    '130000': { channel: '魅族', kind: 'arrive', desc: '消息送达' },
    '130010': { channel: '魅族', kind: 'click', desc: '消息点击' },
    // OPPO / OPPO 海外
    '140000': { channel: 'OPPO', kind: 'arrive', desc: '消息到达' },
    '140001': { channel: 'OPPO', kind: 'fail', desc: 'regid 失效（卸载/注销/刷机/30 天未联网）' },
    '140002': { channel: 'OPPO', kind: 'fail', desc: '单应用单设备当日限量超限' },
    '140003': { channel: 'OPPO', kind: 'fail', desc: '应用维度日限额超限' },
    '140004': { channel: 'OPPO', kind: 'fail', desc: '管控时段下发消息' },
    '310000': { channel: 'OPPO海外', kind: 'arrive', desc: '消息到达' },
    '310001': { channel: 'OPPO海外', kind: 'fail', desc: 'regid 失效' },
    // vivo
    '150000': { channel: 'vivo', kind: 'arrive', desc: '消息到达' },
    '150101': { channel: 'vivo', kind: 'fail', desc: '消息审核不通过' },
    '150103': { channel: 'vivo', kind: 'fail', desc: '消息被覆盖' },
    '150104': { channel: 'vivo', kind: 'fail', desc: '消息未展示' },
    '1501000': { channel: 'vivo', kind: 'fail', desc: '管控其他（不在推送时间/版本不支持等）' },
    '1501017': { channel: 'vivo', kind: 'fail', desc: '运营消息夜间 23:00~07:00 不展示' },
    '1501020': { channel: 'vivo', kind: 'fail', desc: '不匹配其他（设备未注册等）' },
    '1501040': { channel: 'vivo', kind: 'fail', desc: '未展示其他' },
    '1502124': { channel: 'vivo', kind: 'fail', desc: '内容和标题完全相同的运营消息' },
    '1502144': { channel: 'vivo', kind: 'fail', desc: '消息已过有效期' },
    '1502158': { channel: 'vivo', kind: 'fail', desc: 'deeplink 跳转参数错误' },
    '1502161': { channel: 'vivo', kind: 'fail', desc: '被拉起 activity 非导出' },
    '1502162': { channel: 'vivo', kind: 'fail', desc: '被拉起 activity 未找到' },
    '1502183': { channel: 'vivo', kind: 'fail', desc: 'regid 失效，需重新获取' },
    '15011001': { channel: 'vivo', kind: 'fail', desc: '推送量级超限' },
    '15012000': { channel: 'vivo', kind: 'fail', desc: '单应用单用户频次限制' },
    '15010012': { channel: 'vivo', kind: 'fail', desc: '消息过期' },
    '15020001': { channel: 'vivo', kind: 'fail', desc: '用户未订阅' },
    '15020002': { channel: 'vivo', kind: 'fail', desc: '用户不存在' },
    '15020006': { channel: 'vivo', kind: 'fail', desc: '14 天未联网' },
    // 各渠道点击（gtpr 侧）
    '60020': { channel: '华为', kind: 'click', desc: '消息点击' },
    '60090': { channel: '鸿蒙', kind: 'click', desc: '消息点击' },
    '60070': { channel: '荣耀', kind: 'click', desc: '消息点击' },
    '60030': { channel: 'OPPO', kind: 'click', desc: '消息点击' },
    '60080': { channel: 'OPPO海外', kind: 'click', desc: '消息点击' },
    '60040': { channel: 'vivo', kind: 'click', desc: '消息点击' },
}

/** gtpr 回执 code 结果码 */
export const GTPR_CODES: Record<string, string> = {
    '200': '成功',
    '400': '推送苹果接口失败',
    '401': '用户不存在',
    '402': '非活跃用户',
    '500': '系统内部异常',
}

/** 厂商下发接口错误码（速查表主干，模块 → 码 → 含义） */
export const VENDOR_ERROR_CODES: Record<string, Record<string, string>> = {
    'gtps-hw': {
        '-5': '获取 Token 任务失败（检查混淆配置）', '502': '请求连接异常', '503': '流量控制',
        '6003': '指纹证书配置不一致', '6004': '接口鉴权权限不存在',
        '80100003': '消息结构体错误', '80100016': '消息体含敏感词汇',
        '80300002': '下发指定用户无权限', '80300007': '指定 Token 无效',
        '907122036': '未开通推送权益', '907122046': 'Push 不可服务', '907122047': '通用错误',
        '907122054': 'Push SDK 自动初始化中', '907122069': '不支持子用户操作',
        '907135000': '传入参数错误', '907135003': 'SDK 连接 HMS Core 失败', '907135702': 'OpenGW 未配置指纹证书',
    },
    'gtps-ho': {
        '200': '成功', '400': '参数错误', '403': '鉴权不通过', '404': '找不到服务',
        '500': '服务内部错误', '502': '请求连接异常', '503': '超出 QPS 限制',
        '80100000': '部分 Token 发送成功（查 failTokens）', '80100003': '消息结构体错误',
        '80300006': 'Push Token 重复', '80300007': '所有 Push Token 无效',
        '80300008': '消息体超 4096Bytes', '80300010': 'Token 数量超 1000',
        '80200020': 'receiptId 不匹配', '80200022': '无权限发送该类型消息',
        '80200047': '测试消息达当天上限', '80200050': '资讯营销类不支持 image 字段',
        '80200056': '标题或内容含敏感信息',
        '10001': 'timestamp 为空', '10205': 'appId 不存在', '10207': 'timestamp 不合法', '10300': 'Push Token 为空',
    },
    'gtps-vv': {
        '0': '请求成功', '10000': '权限认证失败（authToken 缺失/错误/过期）',
        '10043': '应用已关闭 push 通道', '10045': '应用审核中不可发正式消息',
        '10050': 'regId 为空', '10051': 'classification 不支持该消息类型',
        '10054': 'notifyType 不合法', '10055': 'title 为空', '10056': 'title 超 40 字符',
        '10057': 'content 为空', '10058': 'content 超 100 字符', '10059': 'timeToLive 不合法',
        '10060': 'skipType 不合法', '10065': 'networkType 不合法', '10067': '自定义 key/value 不合法',
        '10070': '运营消息发送量超限', '10071': '超出发送时间范围', '10072': '推送速度过快',
        '10073': '系统消息发送量超限', '10082': '系统消息开关未打开',
        '10094': '鉴权码与 appId 不一致', '10095': 'notifyId 非法', '10096': 'category 错误',
        '10097': 'category 与 classification 不对应', '10103': '推送内容含敏感信息', '10104': '请发送正式消息',
        '10150': 'regIds 为空', '10151': 'taskId 为空', '10152': 'taskId 不合法',
        '10153': 'regIds 个数不在 [2-1000]', '10155': '消息不存在或已过期',
        '10200': 'appId 为空', '10201': 'appKey 为空', '10202': 'appKey 不合法',
        '10203': 'timestamp 为空', '10204': 'sign 为空', '10205': 'appId 不存在',
        '10206': 'sign 不正确', '10207': 'timestamp 不合法', '10252': '批量发送消息体超限',
        '10302': 'regId 不合法（不存在/已卸载/清数据）', '10304': 'extra 含不支持的 key',
        '10305': 'callback 超 128 字符', '10306': 'callback.param 超 192 字符',
        '10311': '设备当前无法推送（通知权限关/不活跃）',
        '10352': 'requestId 为空', '10353': 'requestId 超 64 字符',
        '10800': 'registration_tokens 超 100', '10801': 'notification 为空',
    },
    'gtps-op': {
        '-2': '服务器流量控制', '-1': '服务不可用',
        '11': '不合法的 AuthToken', '12': 'HTTP 方法不允许', '13': 'App 调用受限',
        '14': '无效的 AppKey', '15': '缺少 AppKey', '16': 'sign 校验不通过', '17': '签名缺失',
        '18': '时间戳缺失', '19': '时间戳无效', '20': '不存在的方法名', '21': '缺少方法名',
        '22': 'Version 缺失', '23': '缺少版本参数', '24': 'Version 不支持',
        '25': '编码错误（需 UTF-8）', '26': 'IP 访问被拒/黑名单', '27': '没有此功能权限',
        '28': '应用不可用', '29': '缺少 Auth Token', '30': '没有 API 推送权限',
        '31': '数据不存在', '32': '数据重复冲突', '33': '消息条数超日限额', '34': '上传图片超日限额',
        '40': '参数缺失/message 为空', '41': '参数无效（格式/长度/敏感词等多种子类）',
        '42': '保存消息超每日限量', '55': 'APP 限流', '59': '无备用链接跳转权限',
        '67': 'category 错误', '69': '全局限制错误', '10000': '无效的 registrationId',
    },
    'gtps-xm': {
        '-1': '未知错误', '0': '成功', '1': '内部错误',
        '10001': '系统错误', '10002': '系统繁忙', '10003': '远程服务错误',
        '10008': '参数错误', '10012': '非法请求', '10016': '缺失必选参数', '10017': '参数值非法',
        '10027': 'API 调用太频繁', '10029': '不合法的设备', '10030': '获取失效 regid 太频繁',
        '10031': '应用在黑名单禁发消息', '10032': '获取失效 alias 太频繁', '10033': '黑名单禁发 feedback',
        '10034': '当日发送消息数量过多', '10036': '应用操作被禁止', '10037': '请求过期',
        '10041': 'title 或 description 不合规范',
        '20607': 'DB 错误', '20209': '不合法的主题', '20301': '发送消息失败',
        '21301': '认证失败', '21302': 'token 认证失败', '21303': '被限制的请求', '21305': '缺少必要参数',
        '22000': '非法应用', '22006': '应用程序 Id 不合法', '22007': '应用程序 Key 不合法',
        '22022': 'package name 不合法', '22102': '发送应用通知消息失败',
        '26003': 'Push 内部调用失败', '26004': '广播消息太频繁', '26006': '发送需要审核',
        '27001': 'channel 信息不匹配',
        '65003': '未找到 device（设备不在线）', '65009': '消息内容太长', '65028': '未查询到相应消息',
        '66006': '注册失败', '66007': 'regId 非法',
        '200001': '推送数量超当日限额', '200002': '推送 QPS 超限额',
    },
    'hps-hoshw': {
        '80000000': '发送成功', '80100000': '部分 Token 发送成功（查 msg 中失败 Token）',
        '80100001': '请求参数部分错误', '80100003': '消息结构体错误', '80100004': '过期时间小于当前时间',
        '80100016': '消息内容校验未通过（敏感词）', '80100022': '消息携带图片未验签',
        '80200001': '认证错误（Authorization/ProjectId/JWT 不匹配）', '80200005': 'JWT Token 过期',
        '80300002': '应用无权限下发推送', '80300007': '所有 Token 无效',
        '80300008': '消息体超 4096Bytes', '80300010': 'Token 数量超限',
        '80300029': '测试消息流量限制', '80300030': '测试消息 Token 数量超限',
        '80300036': 'JWT 有效期超 1 天', '80300037': '违规处罚无法发送',
        '81000001': '系统内部错误',
    },
}

/** 把 actionId 翻译为人类可读结论；未知码返回 null */
export function describeActionId (actionId: string): ReceiptEntry|null {
    return RECEIPT_ACTION_IDS[actionId.trim()] ?? null
}

/** 厂商模块下发接口错误码含义；未知返回 null */
export function describeVendorCode (module: string, code: string): string|null {
    return VENDOR_ERROR_CODES[module]?.[code.trim()] ?? null
}

/** 把一批 actionId 行翻译为摘要文本（去重，按出现顺序） */
export function describeActionIds (actionIds: string[]): string {
    const parts: string[] = []
    const seen = new Set<string>()
    for (const id of actionIds) {
        const trimmed = id.trim()
        if (!trimmed || seen.has(trimmed)) { continue }
        seen.add(trimmed)
        const entry = describeActionId(trimmed)
        parts.push(entry ? `${trimmed}(${entry.channel}-${entry.desc})` : `${trimmed}(未知 actionId，请人工核对)`)
    }
    return parts.join('、')
}

/** AI 提示词用的速查表（只含到达/点击主干 + 常见失败码 + gtpr code） */
export function receiptCheatSheet (): string {
    return [
        '【回执 actionId 速查】到达：个推=0，透传到达=10030，华为=110000，鸿蒙=330000，荣耀通知=180002/透传=180001，小米=120000(海外190000)，魅族=130000，OPPO=140000(海外310000)，vivo=150000，APNs展示=10009。点击：个推=10010(透传60002)，华为=60020，鸿蒙=60090，荣耀=60070，小米=120010(海外190010)，魅族=130010，OPPO=60030(海外60080)，vivo=60040，APNs=10019。展示：个推=10000。',
        '常见失败 actionId：110020/330180 设备不在线或非活跃，110030/330030/180003 应用未安装(卸载)，110060/180004/1502183/140001 Token或regid失效，110070/330070/180005/150104 通知不展示，110102/330102/15012000 频控，15020002 用户不存在，15020006 14天未联网。',
        '【gtpr code】200=成功，400=推送苹果接口失败，401=用户不存在，402=非活跃用户，500=系统内部异常。',
        '完整厂商下发错误码表在本地规则库（执行器会自动标注日志中出现的码）。判定口径：厂商接口/push-result 返回 200 只代表个推请求厂商成功，是否到达以 gtpr/as 回执 actionId 为准。分析推送结果时优先依据回执 actionId 判定到达/点击/失败原因。',
    ].join('\n')
}
