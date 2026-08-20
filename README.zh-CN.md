# dsh-figma-local-mcp

DSH 与 **Figma Desktop 本地 MCP 服务器** 的全局集成插件，为所有 Agent 预设提供设计稿读取与设计转代码指导。

本插件**不使用 Figma REST API，也不需要 Figma Token**。它连接 Figma Desktop 在本机暴露的 MCP 服务器，因此可以读取当前打开的文件、当前选中节点，并导出其中的资源。

## 功能

- 全局连接 `@deepseek-ai/dsh-mcp-client` 到 `http://127.0.0.1:3845/mcp`（自动重连；Figma 未打开时不阻塞 DSH）。
- 全局路由提示：任何 Figma 链接、当前选中节点、设计转代码请求、资源导出请求，都会自动路由到 `mcp__figma__*` 工具，适用于所有 Agent 模式。
- 全局 `figma-design-to-code` Skill：把 Figma 输出适配到目标仓库的既有约定。

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

## 常见问题

- 重启 Figma Desktop 后报 `No session found for sessionId`：正常现象——MCP 会话是进程级的。重启 DSH Web 进程（或等待桥接重连）后重试即可。
- `get_design_context` 首次调用或大文件超时：该工具需要在进程内渲染代码并导出全部 SVG；如果超过默认 60 秒的 `toolCallTimeoutMs`，可在插件配置中调大（`figma-mcp-client.config.toolCallTimeoutMs`，例如 120000）。

## 许可证

MIT
