# AIShell

面向服务器批量运维的终端客户端，基于 [Tabby](https://github.com/Eugeny/tabby)（Electron + Angular + Webpack）二次开发。

在保留 Tabby 原生 SSH/串口/终端能力的基础上，针对「多机房、多堡垒机、批量化服务器操作、日志排查」场景，新增了服务器清单同步、连接模板、批量命令、键盘广播、会话录制、多窗口日志分析、规则驱动的自动日志查询、AI 助手与密码安全存储等能力。核心新增代码集中在独立插件 `tabby/tabby-aishell/`，对上游的改动均以 `// AISHELL:` 注释标记，详见 [`docs/AISHELL-CHANGES.md`](docs/AISHELL-CHANGES.md)。

---

## 功能特性

| 功能 | 说明 | 入口 |
|---|---|---|
| 服务器清单同步 | 从监控平台批量拉取「机房/产品/模块/节点」，自动生成分组树 + SSH 连接，登录脚本自动跳转目标机并 `cd` 到模块日志目录 | 启动页 / 左侧树面板「获取服务器配置」 |
| 服务器树增强 | 多选、拖拽跨分组移动、批量移动/复制/删除、侧边栏收起 | 左侧服务器树 |
| 连接模板 | 模板 CRUD + 批量实例化 + 模板变更同步到派生连接 | 树面板「从模板新建 / 管理模板」 |
| 批量命令 | 向所有已连接终端广播命令，变量替换 + 危险命令二次确认 | 树面板「批量命令」 |
| 键盘广播 | SecureCRT 式「发送输入到所有标签页」 | 终端标签右键菜单 |
| 变量替换 | 登录脚本 / 批量命令 / 模板共用一套 `$VAR`、`${VAR}` 变量 | 连接后自动命令 |
| 智能 Keepalive | 全局保活默认值 + 跳板链深度自适应收紧 | SSH 配置 |
| 会话录制 | 终端输出实时落盘（全局自动 / 单标签手动），ANSI 剥离、可选时间戳 | 设置 / 标签右键 |
| 多窗口日志分析 | 多终端 + 日志文件合并为统一时间线，导出 + AI 分析 | 树面板「日志分析」/ AI 助手 |
| 自动日志查询 | 规则驱动的只读日志查询：识别 task_id → 路由模块 → 多窗口并行查询 → 字段解析链路 → 结论 | AI 助手快捷动作 |
| AI 助手 | OpenAI 兼容 / Anthropic 双协议，解释选中、诊断输出、分析日志 | 树面板「AI 助手」/ 终端右键 |
| 密码安全存储 | 密码迁入系统凭据管理器（Keychain/Credential Manager），配置文件零明文 | 启动自动迁移 / 批量改密 |
| 中文化 | AIShell 全部文案中文化 | — |

---

## 技术栈

- **框架**：Electron 38 + Angular 15 + Webpack 5 + TypeScript 4.9
- **终端**：xterm（`tabby-terminal`）、node-pty
- **SSH**：russh（`tabby-ssh`）
- **凭据**：keytar（macOS Keychain / Windows Credential Manager）
- **插件体系**：Tabby 插件架构，`tabby-aishell` 作为内置插件注册

---

## 目录结构

```
AIShell/
├── tabby/                      # Tabby 上游 fork（Electron 主进程 + 各内置插件）
│   ├── app/                    # Electron 主进程与渲染入口
│   ├── tabby-aishell/          # ★ 二开核心插件（模板/批量命令/AI/日志查询等）
│   │   └── src/
│   │       ├── components/     # 8 个弹窗组件
│   │       ├── services/       # 13 个业务服务
│   │       ├── commands.ts     # 启动页/顶栏入口
│   │       ├── contextMenu.ts  # 终端右键菜单
│   │       └── config.ts       # aishell 配置默认值
│   ├── tabby-core/ tabby-terminal/ tabby-ssh/ ...  # 上游插件（部分被二开）
│   └── scripts/                # 构建 / native 重编译脚本
├── docs/                       # 日志排查流程、错误码、自动日志解析方案等
├── tools/                      # 一次性数据迁移脚本
│   └── complete-bastion-import.mjs   # SecureCRT 会话 → Tabby 配置转换
└── README.md
```

---

## 快速开始

### 环境要求

- Node.js **24.x**
- Yarn **1.x**（1.22）
- macOS / Windows（native 模块需对应编译工具链）

### 安装依赖

```bash
cd tabby
yarn
```

国内网络建议指定镜像（GitHub / 境外 CDN 不通时必需）：

```bash
YARN_REGISTRY=https://registry.npmmirror.com \
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
SENTRYCLI_CDNURL=https://cdn.npmmirror.com/binaries/sentry-cli \
yarn
```

### 构建与启动

```bash
cd tabby
yarn build       # 编译类型声明 + 打包所有模块（首次约 2~3 分钟）
yarn start       # TABBY_DEV=1 electron app，启动开发版
```

改完代码用 `yarn watch` 持续构建，改单个插件也可直接：

```bash
cd tabby
./node_modules/.bin/webpack --config tabby-aishell/webpack.config.mjs
```

### ⚠️ Apple Silicon 架构注意

若本机 Node 是 x64（跑在 Rosetta）而 Electron 下载的是 arm64，会出现 `Failed to load native module: pty.node`。此时 native 模块需按 arm64 重编译：

```bash
cd tabby
ARCH=arm64 node scripts/build-native.mjs
```

任何 `yarn install` 之后，都建议重跑 `node scripts/build-native.mjs`（按当前 Electron ABI 重编译 node-pty、keytar 等）。

### 打包安装包

```bash
cd tabby
node scripts/prepackage-plugins.mjs
node scripts/build-macos.mjs     # 或 build-windows.mjs
```

产物输出到 `tabby/dist/`。打包需注意的符号链接 / 缓存 / 签名问题详见 `docs/AISHELL-CHANGES.md` 的「打包手册」。

---

## 功能详解

### 1. 服务器清单同步

从监控平台（默认 `http://172.16.14.123:8080/`）逐机房、逐产品、逐模块、逐分页拉取节点清单，生成「机房 / 产品 / 模块」三层分组树，并为每个存活节点创建 SSH 连接：

- 连接复用已有 SSH 配置作为「堡垒机模板」，host/port/user 来自登录配置；
- 自动注入登录脚本：`ssh 目标用户@目标IP` → 输入 `$TARGET_PASSWORD` → `cd /app/newgetui/<模块>/logs`；
- 自动追加旧版 DH KEX 算法以兼容老服务器；
- 只清理本工具此前生成的 profile（通过 `aishell:syncSource` / `aishell:syncKey` 标记），不动手工配置；
- 支持导出 CSV（带 BOM，中文 Excel 直接打开）。

### 2. 服务器树增强

左侧服务器树支持多选（批量移动 / 复制 / 删除）、跨分组拖拽、侧边栏收起（顶栏右侧「切换侧边栏」按钮，权重排在设置齿轮左侧）。树面板默认可见（`showProfileTree` 默认 `true`）。

### 3. 连接模板

把一组 SSH 选项（Keepalive / 登录脚本 / 跳板机 / 自定义变量等）保存为模板，批量实例化为真实连接：

- 清单格式每行支持 `host`、`user@host`、`host:port`、`user@host:port`，行尾 `#备注名`；
- 派生 profile 通过 `aishell:templateId` 关联回模板；
- 修改模板可一键同步到全部派生连接（跳过 `host/port/user/password` 等实例专属字段）。

### 4. 批量命令

向**已打开且连接就绪**的终端标签广播命令：

- 与登录脚本共用变量替换引擎；
- 危险命令（`rm -rf`、`mkfs`、`reboot`、`dd if=`、fork 炸弹等）需二次确认；
- 保存历史，报告每个目标发送成功/失败。

### 5. 键盘广播

终端标签右键 →「发送输入到所有标签页」，开启后当前标签的每次击键原样转发到其他已连接终端，切换活动标签自动重挂。

### 6. 变量替换与 Post-Connect 命令

登录脚本、批量命令、模板实例化共用同一套变量引擎，支持 `$VAR` 与 `${VAR}`：

- 内置变量：`$SERVER_NAME` / `$SERVER_IP` / `$SERVER_HOST` / `$SERVER_PORT` / `$SERVER_USER` / `$SERVER_GROUP`；
- 自定义变量：模板/连接的 `aishell:vars`；
- 特殊变量 `$TARGET_PASSWORD` 在连接时从系统凭据管理器注入，脚本里看不到明文。

### 7. 智能 Keepalive

`tabby-ssh` 增加全局 `keepaliveInterval` / `keepaliveCountMax` / `adaptiveKeepalive` 默认值；通过跳板链连接的会话，保活间隔随跳板深度每层减半（下限 5s），避免多级跳板时断链。

### 8. 会话录制

- 旁路订阅 `session.binaryOutput$` 实时落盘，不受清屏影响，重连后自动续写同一文件；
- 文件名 `{标签名}_{yyyyMMdd_HHmmss}.log`，默认目录 `~/AIShell/logs`；
- 支持 ANSI 剥离、每行本地时间戳前缀两个选项；
- 全局自动录制（设置开关）+ 单标签手动录制（右键菜单）。

### 9. 多窗口日志分析工作台

左栏多选终端标签（捕获 xterm 滚动缓冲）或加载日志文件，右栏把多来源日志按行内时间戳合并为统一时间线（`[时间] [模块] 内容`）：

- 支持 ISO / 日期时间 / syslog / `[HH:mm:ss]` 等常见时间戳格式；
- 无时间戳的行继承上一行时间；
- 支持导出合并结果、一键交给 AI 分析（运维 SRE 专用 system prompt）。

### 10. 自动日志查询（规则驱动）

在 AI 助手中输入类似 `查询 task_id=RASS_0901_xxx，cid=xxx 的消息下发情况`，本地规则引擎接管执行：

- 从自然语言提取 `task_id` / `cid` / `appid` / `日期` / `推送时间点`；
- 按 `task_id` 前缀路由起始模块：`RASA/GT→spd`、`RASL/RASS→psc`、`OSL/OSS→os`、`MM→mmp`；
- 所有命令由本地模板生成、只读（`zgrep`/`find` + 白名单校验），AI 不生成 shell；
- 多候选服务器并行连接（优先级：用户指定 > 已打开窗口 > 机房 杭州→北京→无锡）；
- 按字段解析结果自动路由下一模块（在线 `im→cm→as`、离线 `sdp/omp`、厂商回执 `gtpr` 等），直至给出结论。

规则、模块路径、字段含义详见 [`docs/日志解析.md`](docs/日志解析.md) 与 [`docs/日志排查流程文档.md`](docs/日志排查流程文档.md)。

### 11. AI 助手

- 支持 OpenAI 兼容（`/chat/completions`）与 Anthropic（`/v1/messages`，适配 CC Switch 本地代理）两种协议；
- 终端右键 AI 菜单：解释选中、诊断输出、分析日志；启动页 / 树面板常驻入口；
- 上下文智能截断（`maxContextChars`），AI 上下文只含 host/user/port 描述，绝不包含密码密钥。

### 12. 密码安全存储

- 所有密码迁入系统凭据管理器（macOS Keychain / Windows Credential Manager），配置文件不再保留明文；
- 首次启动自动把历史明文密码迁移（一次性，幂等标记）；打开「获取服务器配置」弹窗时自动把 `login.env` 一次性导入设置；
- 支持「批量修改登录密码」：把 SSH 连接密码 / 跳转目标机密码写入凭据管理器并清掉配置里的明文。

---

## 配置说明

配置文件为 Tabby 的用户配置 `config.yaml`，AIShell 相关项位于 `aishell:` 段：

```yaml
aishell:
  templates: []                      # 连接模板
  batchCommands:
    history: []                      # 批量命令历史
    confirmDangerousCommands: true   # 危险命令二次确认
  ai:
    enabled: false
    baseUrl: 'https://api.openai.com/v1'
    apiKey: ''
    model: ''
    maxOutputTokens: 2048
    maxContextChars: 24000           # 发给 AI 的上下文上限
    protocol: 'openai'               # openai | anthropic
  sessionLog:
    enabled: false
    directory: ''                    # 空则 ~/AIShell/logs
    stripAnsi: true
    addTimestamps: false
  inventory:                         # 服务器清单同步登录配置（非敏感）
    baseUrl: 'http://172.16.14.123:8080/'
    platformUser: ''
    bastionUser: ''
    targetUser: ''
    bastionHosts: { hzsd: '', bjmjq: '', wxgj: '' }
    migrated: false
```

---

## 凭据与安全

- 三份密码（监控平台 / 堡垒机 / 目标机）存储在系统凭据管理器（keytar），服务名 `AIShell:inventory`、`AIShell:ssh@host:port`、`AIShell:target-jump`；
- 旧版通过 `login.env` 文件提供登录信息，文件放在机器级目录（不随安装包分发）：
  - 查找顺序：`$TABBY_CONFIG_DIRECTORY/login.env` → `~/.aishell/login.env` → 应用 resources → cwd / execPath 上溯 6 级；
  - 格式（支持中文冒号）：

    ```ini
    堡垒机用户名：xxx
    堡垒机密码：xxx
    目标服务器用户名：xxx
    目标服务器密码：xxx
    杭州三墩堡垒机IP: 172.16.7.2
    北京马驹桥堡垒机IP: 172.16.14.123
    无锡国际堡垒机IP: 172.30.16.2
    ```
- 新版打开「获取服务器配置」弹窗会自动把 `login.env` 一次性导入设置 + 凭据管理器，之后不再依赖文件。

---

## 相关文档

- [`docs/AISHELL-CHANGES.md`](docs/AISHELL-CHANGES.md) —— 对上游源码的全部改动清单与修复记录
- [`docs/日志排查流程文档.md`](docs/日志排查流程文档.md) —— 各厂商推送错误码速查
- [`docs/日志解析.md`](docs/日志解析.md) —— 自动日志查询的解析方案与字段规则
- [`docs/查询命令.docx`](docs/查询命令.docx) / [`docs/日志排查.pdf`](docs/日志排查.pdf) —— 查询命令与排查参考

---

## 已知限制 / 待办

- AI API key 存于明文 `config.yaml`（后续迁移到 VaultService 加密存储）；
- 拖拽暂不支持组内排序（树按名称排序），只支持跨分组移动与分组重新挂载；
- 批量编辑公共字段入口暂未做（模板同步可覆盖大部分场景）；
- MCP 协议集成放在二期；
- 日志时间戳解析忽略时区偏移（同批日志通常同时区，排序不受影响）。
