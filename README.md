# dsh-figma-local-mcp

[English](README.md) | [简体中文](README.zh-CN.md)

## 中文简介

为 DeepSeek Harness（DSH）接入 **Figma Desktop 本地 MCP**，让各类 Agent 直接读取设计稿、当前选区、设计变量与资源，并按项目既有规范实现界面。

- **读取设计无需 Token**：启用 Figma Desktop 本地 MCP，并与 DSH 运行在同一台机器上即可使用。
- **原生 2x / 3x PNG 导出**：可选配置 Figma PAT，资源直接保存到当前任务工作区，不放大截图、不交付临时下载链接。
- **原生中文设置面板**：左侧栏点击 Figma，管理 Token、查看有效状态与到期提醒；面板跟随 DSH 皮肤。
- **安全边界**：Token 仅在设置面板输入；导出遵循当前会话沙箱权限。

安装、权限配置、使用示例及常见问题请参阅 **[完整中文文档](README.zh-CN.md)**。

## Overview

Global integration between DSH and the **local Figma Desktop MCP server**, with design-to-code guidance for every agent preset.

Design inspection still uses the local Figma Desktop MCP and needs **no token**. Since 0.2.0, optional **native 2x / 3x PNG exports** use Figma REST with a Personal Access Token configured in a local settings panel. Screenshots are never upscaled to fake higher-resolution exports.

## Features

- Connects the harness-provided `@deepseek-ai/dsh-mcp-client` service to `http://127.0.0.1:3845/mcp` (auto-reconnect, non-blocking when Figma is closed). The client ships with DSH itself — this plugin only configures it through the bundled `cordis.patch.yml` and declares no npm dependency on it, so it always runs against the host's own version.
- Global routing prompt: any Figma URL, current selection, design-to-code request, or asset-export request routes to the `mcp__figma__*` tools in every agent mode.
- Global `figma-design-to-code` skill that adapts Figma output to the target repository conventions.
- Optional native 2x / 3x PNG exports saved directly to the task workspace under the session sandbox policy.
- Native sidebar settings panel with credential health checks, expiry reminders and live DSH theme support.

## Requirements

- macOS or Windows with **Figma Desktop** installed and signed in.
- The DSH web process and Figma Desktop must run on the same machine (the MCP server listens on `127.0.0.1:3845`).

## How to enable the local Figma MCP server

1. Open **Figma Desktop** and sign in.
2. Open the design file you want to work with.
3. Switch to **Dev Mode** (the "Develop" toggle in the top-right toolbar).
4. In the Dev Mode inspector panel, open the **MCP Server** section.
5. Toggle **Enable desktop MCP server** to on.

You should now see the server running at `http://127.0.0.1:3845/mcp`. Keep Figma Desktop open while DSH needs to read the design.

Official instructions: <https://developers.figma.com/docs/figma-mcp-server/local-server-installation/>

## Install

Into the Web Profile (or any other profile):

```sh
dsh plugin --profile web add dsh-figma-local-mcp
```

Restart the DSH web process after installing, then open a new conversation.

## Usage

Send any of the following in a conversation:

- a Figma design URL (`figma.com/design/...`), FigJam board URL, or Slides URL;
- "implement this Figma selection / page";
- "export the assets of this Figma node";
- "read the variables, colors, and spacing of this design".

The available tools are exposed as `mcp__figma__get_design_context`, `mcp__figma__get_screenshot`, `mcp__figma__get_metadata`, `mcp__figma__get_variable_defs`, `mcp__figma__get_motion_context`, and `mcp__figma__get_figjam`.

Presets that intentionally restrict their tool set (for example a fixed-tool bootstrap phase) expose the Figma tools only after their own restriction is lifted.

## Native 2x / 3x PNG export

After upgrading, **restart the DSH Desktop / Web host**, then refresh the existing GUI. A page refresh alone cannot reload server-side plugins; no frontend dev watcher is required.

1. Select **Figma** in the **left sidebar** page list; the settings page opens in the center area. There is no floating bottom-right entry. Switch back to **对话** to close the page and clear unsaved Token input; saved credentials remain. The panel follows the current DSH skin (including live color, typography and radius changes). This is the host's native left-sidebar panel entry, works in Desktop and Web, opens no extra window and goes through no isolated browser. Ordinary authenticated Web browsers may also open `/dsh-figma` on the current DSH origin, with a system light/dark fallback. The panel requires local-loopback access and DSH host authentication.
2. Create a PAT in [Figma settings](https://www.figma.com/settings), granting `file_content:read` for export and `current_user:read` for independent account checks. Paste it **only into the panel**, not chat. A failed candidate never replaces the working credential. When an existing credential is not known to be invalid/expired, the add-token form stays hidden; **增加令牌** opens it and **取消** closes it without changing the saved credential. Missing or explicitly rejected/expired credentials show the form automatically; transient network, quota and permission errors do not imply expiration.
3. Optionally enter the expiration chosen when creating the PAT. Figma has no documented public PAT expiry-introspection endpoint; unknown expiry stays unknown. Newly-created PATs last at most 90 days, but save time is not issuance time and revocation can happen earlier.
4. Once configured, give the agent a file/branch link containing `node-id`. During Figma implementation tasks it automatically exports needed raster assets at **both 2x and 3x into the current task workspace**, rather than handing you manual downloads. The panel retains optional manual node export/download controls.

`figma_export_images` accepts `{url, scales:[2,3], outputDir:"assets/figma"}` (both scales by default). It saves binaries through the calling session's sandbox in an exclusive `export-UUID` asset subdirectory, never overwrites, and returns persistent local paths, actual dimensions, byte counts and SHA-256. Missing host capability, read-only sessions and out-of-workspace destinations fail explicitly, without bypassing permissions or degrading to manual download links. Failed/cancelled writes can leave partial files but do not claim complete delivery.

`figma_token_status` returns health and panel URL (`check=true` probes immediately). Tokens are configured once in the native sidebar panel, never in chat or tool arguments. Inspect the target through Desktop MCP first. REST requires a file key, so selection alone is insufficient: supply the link rather than guessing. Up to ten same-file nodes can be comma-separated in the tool URL; the panel takes one node.

### Automatic validity and expiry checks

- Probe `/v1/me` on startup, candidate save, every **6 hours**, manual check, and before each export. Never poll the Tier 1 render endpoint. The visible panel polls local status every **60 seconds**, not Figma.
- User-supplied expiry produces an expired state at that time, and a warning **7 days** ahead. Otherwise exact expiry is unknown while API checks can still detect rejection.
- Explicit authentication rejection means **invalid or expired**; revoked/incorrect/expired cannot reliably be distinguished. Generic 403 means permission denied, not proven expiration. Network/5xx and 429 are transient/limited states; credentials and last-valid timestamp remain intact.
- `/v1/me` requires `current_user:read`; an export-only PAT can fail this probe without being expired. Scopes do not override file or organization ACLs. PATs cannot auto-renew: replace them manually in the panel.

### Security and output limits

- Secrets and optional expiry metadata use the **DSH credential-record service**, never plugin YAML, source, browser storage, tool results, or logs. The current local host backend is a permission-restricted file, **not a claim of Keychain encryption**; protect the profile and its backups. Secrets are never returned to the panel and can be removed there.
- PATs go only to fixed HTTPS `api.figma.com`; API redirects are rejected. Asset requests carry no token or cookies, use a narrow observed-host allowlist (not an official exhaustive Figma contract), reject redirects, validate DNS/public IPv4 addresses, and enforce byte/PNG-header limits. Unknown future hosts fail clearly rather than allowing arbitrary AWS domains.
- Export uses **cloud-saved state**, possibly different from unsaved Desktop edits. Figma caps renders at **32 megapixels**; oversized requests are rejected before rendering to avoid silent downscaling. Pixel mismatches are reported, never compensated by upscaling. Quotas depend on account/plan/seat, with one render request per scale.
- Conversation tools save PNGs into the current task workspace; **saved files do not expire with temporary links**. Download staging has a **100 MB** total cache and **50 MB** per-file cap. The panel's optional manual download links live in host memory for **10 minutes**; restarting, removing or replacing the token invalidates those links. Failed batches do not return partial success.

Development checks (no real credentials required):

```sh
npm test
npm run check
npm pack --dry-run
```

For an unpublished local upgrade, run `npm pack` and install its local tarball through DSH plugin management, rather than reinstalling an older registry release. Mock tests do not establish real-account scopes, quotas, export-host compatibility, or successful production exports without a real PAT and target.

References: [PATs](https://developers.figma.com/docs/rest-api/personal-access-tokens/), [users](https://developers.figma.com/docs/rest-api/users-endpoints/), [renders](https://developers.figma.com/docs/rest-api/file-endpoints/), [scopes](https://developers.figma.com/docs/rest-api/scopes/), [errors](https://developers.figma.com/docs/rest-api/errors/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/).

## Troubleshooting

- `✕ missing peer @deepseek-ai/...` lines in the `dsh plugin` output are expected. DSH profiles set `autoInstallPeers: false`; host packages such as `@deepseek-ai/cordis`, `@deepseek-ai/dsh-mcp-client`, `dsh-llm`, `dsh-tools`, etc. are provided by the DSH installation itself at runtime through the profile module fallback, so pnpm's peer check reports them as "missing" even though they resolve fine. This is normal for every DSH plugin, including the officially bundled ones.
- `No session found for sessionId` after restarting Figma Desktop: expected — the MCP session is process-local. Restart the DSH web process (or wait for the bridge reconnect) and retry.
- `get_design_context` timeouts on first call or on large files: the tool renders code and exports every SVG in-process; if it exceeds the 60 s default `toolCallTimeoutMs`, raise it in the plugin config (`figma-mcp-client.config.toolCallTimeoutMs`, for example 120000).

## License

MIT
