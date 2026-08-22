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

## 环境记录（Phase 0）
- Node v24.9.0（上游 CI 使用 22，暂用 24，若有 native 编译问题再切）
- Yarn 1.22.22
- VS2022 Community（VC 工具，native 模块编译用）
- Python 3.14.0（node-gyp 备用）
