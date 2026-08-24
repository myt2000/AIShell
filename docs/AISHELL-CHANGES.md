# AIShell 二开改动清单

本文件记录对 Tabby 上游源码 (`tabby/`) 的所有直接改动，便于日后合并上游更新。
约定：所有直接改动的代码处使用 `// AISHELL:` 或 `/* AISHELL: */` 注释标记。

## 新增包

| 包 | 说明 |
|---|---|
| `tabby/tabby-aishell/` | 新内置插件：模板系统、批量命令引擎、AI 助手（Phase 2/4/6），已注册进 `scripts/vars.mjs` builtinPlugins |

## 直接改动的上游文件

### Phase 1：服务器树增强（多选 / 拖拽 / 批量操作）
- `tabby-core/src/components/profileTree.component.ts` — 多选状态、批量操作、拖拽逻辑
- `tabby-core/src/components/profileTree.component.pug` — 多选 UI、拖拽属性、批量操作条
- `tabby-core/src/components/profileTree.component.scss` — 选中态/拖拽态样式
- `tabby-core/src/services/profiles.service.ts` — 新增 bulkMoveProfiles / bulkUpdateProfiles / duplicateProfiles / collectGroupProfiles
- `app/src/global.scss` — 拖拽预览全局样式（.aishell-tree-drag-preview）

### Phase 3：Post-Connect 命令变量替换
- `tabby-terminal/src/middleware/loginScriptProcessing.ts` — LoginScriptsOptions 增加 variables；send 前替换 $VAR/${VAR}
- `tabby-terminal/src/components/loginScriptsSettings.component.pug` — 变量说明
- `tabby-ssh/src/session/shell.ts` — SSH 会话构建变量上下文（$SERVER_NAME/$SERVER_IP/$SERVER_PORT/$SERVER_USER + aishell:vars）

### Phase 5：智能 Keepalive
- `tabby-ssh/src/config.ts` — 全局 keepaliveInterval/keepaliveCountMax/adaptiveKeepalive 默认值
- `tabby-ssh/src/session/ssh.ts` — computeKeepaliveIntervalSeconds：全局默认 + 跳板链深度自动收紧（每层减半，下限 5s）

### Phase 7：中文化
- `tabby/locale/zh-CN.po` — 新增全部 AISHELL 功能文案（约 72 条）；上游 STOP.txt 的 Crowdin 流程在 fork 后不再使用

### 构建/环境
- `scripts/vars.mjs` — builtinPlugins 增加 tabby-aishell
- `app/patches/node-pty+1.2.0-beta.8.patch` — 移除 SpectreMitigation 要求（本机 VS 无 Spectre 库时的编译修复）
- git tag `v1.0.231-nightly.0` — 使构建脚本 `git describe --tags` 可用
- git 全局配置：`http.https://github.com.proxy` 指向本机代理 127.0.0.1:7897

## tabby-aishell 插件结构
- `src/api.ts` — AIShellTemplate / ServerRow 数据模型；TEMPLATE_ID_KEY/VARS_KEY/SYNC_RESERVED_KEYS
- `src/config.ts` — aishell.templates / aishell.batchCommands / aishell.ai 配置默认值
- `src/services/template.service.ts` — 模板 CRUD、服务器清单解析、批量实例化、同步派生 profile
- `src/services/variableSubstitution.service.ts` — 变量替换引擎（模板/登录脚本/批量命令共用）
- `src/services/batchCommand.service.ts` — 批量广播：自动连接 + sendInput + 危险命令检测
- `src/services/ai.service.ts` — OpenAI 兼容 chat 接口（fetch 直连，无第三方 SDK）
- `src/services/terminalContext.service.ts` — 终端选区/滚动缓冲/目标信息捕获
- `src/components/` — fromTemplateModal / manageTemplatesModal / batchCommandModal / aiAssistantModal / aiSettingsModal
- `src/commands.ts` — 左侧工具栏按钮：从模板新建 / 批量命令 / AI 助手
- `src/contextMenu.ts` — 终端右键 AI 菜单（解释选中/诊断输出/分析日志）

## 已知取舍 / 待办
- AI API key 存于明文 config.yaml（后续可迁移 VaultService 加密存储）
- AI 上下文只含 host/user/port 描述，绝不包含密码/密钥
- MCP 协议集成放在二期
- 拖拽暂不支持组内排序（树按名称排序），只支持跨分组移动与分组重新挂载
- 批量编辑公共字段入口暂未做（模板同步可覆盖此场景大部分需求）

## 启动卡死问题修复记录（2026-08-24）

现象：dev 和打包版都卡在 Tabby 启动页。根因与修复：

1. **`@tabby-gang/windows-process-tree` 未安装**（主因）
   - 它是 `app/package.json` 的 **optionalDependencies**，首次安装因网络失败被 yarn 静默跳过
   - `tabby-electron` 的 platform.service.ts 中它与 `windows-native-registry` 在同一个
     try 块里赋值，前者 require 失败导致后者永远为 undefined，Angular 注入
     SSHService 时崩溃
   - 修复：手动从 npmmirror 拉取 tarball 解压到 `app/node_modules/@tabby-gang/windows-process-tree/`
     （自带预编译 .node），并对其 binding.gyp 打了 Spectre 补丁：
     `app/patches/@tabby-gang+windows-process-tree+0.6.1.patch`
   - **注意**：如果重装依赖后再现卡启动页，优先检查该包是否存在：
     `ls app/node_modules/@tabby-gang/windows-process-tree`
2. **tabby-aishell 的 TranslateService 导入源错误**
   - 不能从 `@ngx-translate/core` 直接导入（不在 webpack externals，会打包出私有副本，
     导致 NullInjectorError）；必须与其他插件一致 **从 'tabby-core' 导入**
3. native 模块 ABI：`yarn install --force` 会用 npm 预编译版（ABI 137）覆盖
   electron 重编译版（ABI 139），重装依赖后必须重跑 `node scripts/build-native.mjs`
4. 已将 4 个第三方插件（tabby-post-connect-actions / better-sidebar / ai-assistant /
   workspace-manager）从 `%APPDATA%\tabby\plugins\node_modules` 移除备份到
   `%APPDATA%\tabby\plugins-disabled-backup`（它们与本项目的内置功能重复）

## 服务器树面板消失修复记录（2026-08-24）
- 现象：打包版左侧服务器树（文件夹管理 + AIShell 工具栏）完全不显示
- 根因：上游默认 `showProfileTree: false`（`tabby-core/src/configDefaults.yaml`），
  `appRoot.component.pug` 只在 `config.store.showProfileTree` 为真时渲染 `<profile-tree>`，
  用户配置未覆盖该键 → 整个树面板不渲染（AIShell 工具栏在树面板内部，一起消失）
- 修复：
  1. `tabby-core/src/configDefaults.yaml`：默认改为 `true`（AIShell 以服务器管理为核心，
     树面板理应默认可见）
  2. 用户配置 `%APPDATA%\tabby\config.yaml` 显式写入 `showProfileTree: true`（双保险）
- 右上角"固定/重新连接"悬浮按钮说明：属 Tabby 原生终端工具栏
  （`tabby-terminal/terminalToolbar`，作用于当前终端标签），非 AIShell 功能；
  AIShell 的 4 个工具按钮只在左侧树面板和启动页出现

## Windows 打包手册（已跑通）


产物：`tabby/dist/` 下
- `tabby-*-setup-x64.exe`：NSIS 安装包（含 VC++ 运行库）
- `tabby-*-portable-x64.zip`：免安装便携版

打包命令（在 tabby/ 目录，需先完成 yarn install + yarn build）：
```bash
node scripts/prepackage-plugins.mjs
node scripts/build-windows.mjs
```

### 本机环境要点（换机器需重做）
1. **git tag 必须指向 HEAD**（构建脚本用 `git describe --tags` 算版本号）：
   `git tag -f v1.0.231-nightly.0 HEAD`
2. **`tabby/build/vc_redist.exe`**：NSIS 安装包要嵌入 VC++ 运行库，缺失会报
   `File: "build/vc_redist.exe" -> no files found`。
   下载：`curl -L -o build/vc_redist.exe https://aka.ms/vs/17/release/vc_redist.x64.exe`（25MB，不入库）
3. **winCodeSign 符号链接问题**（非管理员 Windows 打包的通病）：官方压缩包含两个 macOS
   符号链接，7za 解压报"客户端没有所需的特权"。解法：预先把无符号链接的净化版内容放到
   `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\`（app-builder
   检测到目录存在即跳过下载与校验）。净化包制作：从任一次部分解压的缓存目录把
   `darwin/10.12/lib/libcrypto.dylib、libssl.dylib` 两个 0 字节文件用同名 `.1.0.0.dylib`
   实文件覆盖后整体 7z 打包即可。
4. **NSIS 缓存预置**（避免下载后重命名被文件锁打断）：把 `nsis-3.0.4.1.7z`、
   `nsis-resources-3.4.1.7z` 直接解压到
   `%LOCALAPPDATA%\electron-builder\Cache\nsis\nsis-3.0.4.1\` 与 `...\nsis-resources-3.4.1\`。
5. **打包时环境变量**（网络相关）：
   - `ELECTRON_BUILDER_BINARIES_MIRROR`：指向含 winCodeSign/nsis 的镜像（注意尾部斜杠）
   - `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7897`：本机代理，github 访问用
   - 打包版与 dev 版共用 `~/.config/tabby` 配置目录，**同时只能开一个实例**（单实例锁）；
     dev 版在跑时启动打包版会静默退出，先关掉另一个再开

### 改名称/图标（如需换 AIShell 品牌）
- `electron-builder.yml`：appId/productName/artifactName/shortcutName
- `app/package.json`、`build/windows/icon.ico`
- 注意：productName 变更会改变用户数据目录，现有配置（服务器列表）需手动迁移

## 环境记录（Phase 0）
- Node v24.9.0（上游 CI 使用 22，暂用 24，若有 native 编译问题再切）
- Yarn 1.22.22
- VS2022 Community（VC 工具，native 模块编译用）
- Python 3.14.0（node-gyp 备用）
