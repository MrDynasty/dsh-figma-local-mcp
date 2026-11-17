# dsh-figma-local-mcp

[English](README.md) | [简体中文](README.zh-CN.md)

DSH 与 **Figma Desktop 本地 MCP 服务器** 的全局集成插件，为所有 Agent 预设提供设计稿读取与设计转代码指导。

设计读取继续使用本机 Figma Desktop MCP，**不需要 Token**。从 0.2.0 起，可选的 **原生 PNG 导出**使用 Figma REST API，需要在本机面板配置 Personal Access Token（PAT）；从 0.3.3 起同一条路径支持 **1x–4x PNG 与真正的 SVG / PDF 矢量**，并记录每次凭据变更的审计留痕。不会把截图放大来冒充高倍率导出。

## 功能

- 连接 DSH 自带的 `@deepseek-ai/dsh-mcp-client` 服务到 `http://127.0.0.1:3845/mcp`（自动重连；Figma 未打开时不阻塞 DSH）。该客户端随 DSH 一同分发——本插件只通过内置的 `cordis.patch.yml` 配置它，不声明任何 npm 依赖，因此始终使用宿主自带的版本。
- 全局路由提示：任何 Figma 链接、当前选中节点、设计转代码请求、资源导出请求，都会自动路由到 `mcp__figma__*` 工具，适用于所有 Agent 模式。
- 全局 `figma-design-to-code` Skill：把 Figma 输出适配到目标仓库的既有约定。
- 可选的原生导出：遵循当前会话沙箱权限，直接保存到任务工作区；支持 1x–4x PNG（单次最多三档）以及 SVG、PDF。
- 原生侧栏设置面板：管理凭据、自动检测有效状态、显示保存时间与剩余天数、提示到期，并实时跟随 DSH 皮肤。
- 只追加的凭据审计：`save`、`remove`、`read-invalid`、`check-fail`、`check-ok` 全部留痕，只记录 Token 指纹，面板以「最近变更」展示。
- `figma-design-to-code` Skill 采用薄正文 + 三个 references（`tools.md`、`targets.md`、`auth-state.md`），通过 `resourceBase` 随插件分发。

## 环境要求

- 安装并登录 **Figma Desktop**（macOS / Windows）。
- DSH Web 进程与 Figma Desktop 必须运行在同一台机器上（MCP 服务器监听 `127.0.0.1:3845`）。

## 如何开启本地 Figma MCP 服务器

1. 打开 **Figma Desktop** 并登录。
2. 打开要读取的设计文件。
3. 切换到 **Dev Mode**（右上角工具栏的 Develop 切换）。
4. 在 Dev Mode 检查面板中，展开 **MCP Server** 部分。
5. 打开 **Enable desktop MCP server** 开关。

开启后服务即运行在 `http://127.0.0.1:3845/mcp`。DSH 读取设计期间请保持 Figma Desktop 运行。

官方说明：<https://developers.figma.com/docs/figma-mcp-server/local-server-installation/>

## 安装

安装到 Web Profile（或其他任意 Profile）：

```sh
dsh plugin --profile web add dsh-figma-local-mcp
```

安装完成后重启 DSH Web 进程，再新建对话即可使用。

## 用法

在对话中发送以下任意内容：

- Figma 设计链接（`figma.com/design/...`）、FigJam 看板链接或 Slides 链接；
- 「按当前选中的 Figma 页面实现」；
- 「导出这个 Figma 节点的资源」；
- 「读取这个设计的变量、颜色和间距」。

可用工具以 `mcp__figma__get_design_context`、`mcp__figma__get_screenshot`、`mcp__figma__get_metadata`、`mcp__figma__get_variable_defs`、`mcp__figma__get_motion_context`、`mcp__figma__get_figjam` 暴露。

对工具集做主动限制的预设（例如固定工具的锚定引导阶段），只有在自身限制解除后才能看到 Figma 工具。

## PNG / SVG / PDF 导出与 Token 设置

1. 升级后**重启 DSH Desktop / Web 宿主**，刷新原有 GUI。仅刷新网页不会加载新的服务端插件；此插件不依赖前端 dev watcher。
2. 在**左侧侧栏**的页面列表里选择 **Figma**，在中间区域打开设置页；**不再显示右下角悬浮入口**。切回「对话」即可关闭设置页，清空未保存的 Token 输入；已保存凭据保留。面板实时跟随当前 DSH 皮肤的颜色、字体和圆角。这是宿主原生的左侧栏入口，支持 Desktop 和 Web，不打开额外窗口，也不经过隔离浏览器。普通 Web 浏览器仍可在已登录的当前 DSH 地址后加 `/dsh-figma`，独立页面使用系统浅色／深色兜底；此面板只允许本机、已通过 DSH 身份验证的请求。
3. 到 [Figma 官方设置](https://www.figma.com/settings) 创建 PAT，开启 `file_content:read`（导出）和 `current_user:read`（独立账号健康检查）。在面板中粘贴 Token，点击「验证并保存」。验证失败不会覆盖已有 Token。已有令牌且未明确失效／到期时，默认隐藏新增表单；点击「增加令牌」展开，「取消」收起且不修改已有凭据。缺失或明确失效／到期时自动显示表单；网络、限流和权限错误不会被当作到期。
4. 可填写创建 PAT 时选择的到期时间；留空表示**精确到期时间未知**。Figma 没有公开的 PAT 到期时间查询接口，不能按保存时间加 90 天推算。新 PAT 最长 90 天，但可以更短或提前撤销。
5. 配置一次后，在对话中给出具体节点的文件／分支链接（必须含 `node-id`）。Agent 做设计实现时，会在**当前任务内自动导出所需位图的 2x、3x 并保存到工作区**，不是让你再点下载。面板的手动导出可选择 **PNG（1x–4x）、SVG 或 PDF**；矢量格式不适用倍率，因为不存在固定像素尺寸。

对话工具 `figma_export_images` 接受 `{url, format:"png"|"svg"|"pdf", scales:[2,3], outputDir:"assets/figma"}`：PNG 默认导出 2x、3x，最多三档、取值 1–4；SVG / PDF 只输出一个文件，并跳过像素上限预检。每次在项目资源目录内新建独占 `export-UUID` 子目录，不覆盖已有文件；返回永久本地路径、实际尺寸、字节数及 SHA-256，Agent 应直接使用这些文件。保存必须通过**当前会话的沙箱权限**；只读会话、越界目录、缺少宿主能力会明确失败，不绕过权限或降级为手动下载。取消或保存失败可能留下部分文件，但不会报告完整交付。

`figma_token_status` 只查看状态；设置仍由原生侧边栏面板完成。**不要把 Token 发进聊天**；工具不接受设置 Token 参数。单次最多 10 个同文件节点，链接的 `node-id` 可用逗号分隔；面板输入单个节点。

### 自动检测规则

- 启动时、保存候选 Token 时、后台每 **6 小时**、手动检查时、每次导出前调用低成本的 `/v1/me` 验证；不会用图片渲染接口轮询健康状态。面板可见时每 **60 秒**读取本机状态，不额外调用 Figma。
- 用户填写的到期时间到达后显示「已到期」；有效 Token 在到期前 **7 天**提示「即将到期」。没有填写时显示「到期未知」，仍能通过 API 检测失效。
- 明确的认证拒绝显示「无效或已到期」，无法可靠区分撤销、错误 Token 和过期。普通 403 显示权限不足；网络错误、5xx 和 429 分别显示网络异常／请求受限，保留凭据及最近有效时间，**不误报过期**。
- `/v1/me` 需要 `current_user:read`。只有导出 scope 的 Token 可能健康检查失败，这不证明过期。`file_content:read` 也不会绕过文件分享或组织访问限制。
- PAT 不能自动续期；失效后需在 Figma 创建新 Token，并在面板替换。

### 凭据审计留痕

- 每次 `save`（保存令牌）、`remove`（移除令牌）、`read-invalid`（记录格式非法）、`check-fail`（检查失败）以及恢复时的 `check-ok` 都会向 `~/.dsh/figma-local-mcp/audit.jsonl` 追加一行（目录 `0700`、文件 `0600`，超过上限时轮转为最新 200 条）。记录内容只有时间、动作、来源（`panel` / `tool` / `background` / `plugin`）、受影响 Token 的 **SHA-256 前 8 位**、适用到期时间和结果状态，**不包含 Token 本身**。
- 面板与接口返回最新 5 条「最近变更」。因此「令牌不见了」可以直接从证据判断：出现 `remove` 表示在面板中明确点击过移除（确认框保护），而不是后台自动清理。
- 凭据记录格式非法时只记为 `read-invalid`，插件**不会**自动删除它；面板报错文案改为先看「最近变更」，不再建议直接删除重配。
- 同一种后台失败会去重，只记录一次，直到状态变化，避免长时间故障刷满日志。

### 数据与导出边界

- Token 及可选到期元数据存入 **DSH 官方凭据记录服务**，不写入插件 YAML、源码、浏览器存储、工具结果或日志；审计文件只记录指纹，且接口响应会等待审计写入完成，面板不会显示过期的历史。当前宿主的本地凭据后端使用权限受限的文件，**不等同于系统钥匙串加密**；应保护 DSH Profile 及备份。面板不会回显 Token，支持移除。
- Token 只发送到固定 HTTPS `api.figma.com`；禁止 API 重定向。图片下载不携带 Token／Cookie，只接受安全列表中的 Figma 已知图片域名，禁止重定向并校验 DNS、PNG 头部和响应大小。若 Figma 更换图片域名，会明确拒绝而不是开放任意域名。
- REST 导出使用**云端已保存版本**，可能与 Desktop 未保存修改不同。只有当前选中节点不足以确定 REST 文件 key，需提供链接，不猜测。
- Figma 最大 **3200 万像素**；超限批次会拒绝，防止静默降采样。若实际 PNG 尺寸与预期不符，明确提示，绝不再放大补偿。导出额度受账号、席位及计划限制，2x、3x 分别占用渲染请求。
- 对话工具会把 PNG 保存到当前任务工作区，**已保存文件不受临时链接过期影响**。下载阶段总缓存上限 **100 MB**、单文件上限 **50 MB**。面板手动下载链接仅在宿主内存保留 **10 分钟**，关闭宿主、移除或替换 Token 后失效；批次失败不会返回部分成功结果。

开发验证（不需要真实 Token）：

```sh
npm test
npm run check
npm pack --dry-run
```

本地未发布版本可先 `npm pack`，再通过 DSH 插件管理器安装生成的本地 tarball；不要用注册表旧版代替本地升级。没有真实 PAT 和目标文件时，自动测试只能验证模拟响应，不能证明真实账号的导出权限、额度或图片域名兼容。

官方依据：[PAT](https://developers.figma.com/docs/rest-api/personal-access-tokens/)、[用户接口](https://developers.figma.com/docs/rest-api/users-endpoints/)、[文件／导出接口](https://developers.figma.com/docs/rest-api/file-endpoints/)、[权限](https://developers.figma.com/docs/rest-api/scopes/)、[错误分类](https://developers.figma.com/docs/rest-api/errors/)、[限额](https://developers.figma.com/docs/rest-api/rate-limits/)。

## 常见问题

- `dsh plugin` 输出中出现 `✕ missing peer @deepseek-ai/...` 属于正常现象。DSH Profile 设置了 `autoInstallPeers: false`；`@deepseek-ai/cordis`、`@deepseek-ai/dsh-mcp-client`、`dsh-llm`、`dsh-tools` 等宿主包由 DSH 安装本身在运行时通过 Profile 模块回退机制提供，因此 pnpm 的 peer 检查会报告「缺失」，但实际都能正常解析。所有 DSH 插件（包括官方自带插件）都是如此。
- 「令牌不见了」：打开面板看「最近变更」。出现 `remove` 说明是面板里点过移除（移除按钮有确认框）；出现 `read-invalid` 说明记录格式非法。插件不会自动清理凭据，插件升级也不会改写 `~/.dsh/.credentials.yaml`。
- 重启 Figma Desktop 后报 `No session found for sessionId`：正常现象——MCP 会话是进程级的。重启 DSH Web 进程（或等待桥接重连）后重试即可。
- `get_design_context` 首次调用或大文件超时：该工具需要在进程内渲染代码并导出全部 SVG；如果超过默认 60 秒的 `toolCallTimeoutMs`，可在插件配置中调大（`figma-mcp-client.config.toolCallTimeoutMs`，例如 120000）。

## 许可证

MIT
