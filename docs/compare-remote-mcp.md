# 与 dsh-figma-mcp 的连接方式对照

对比对象：[lubanqihao9875/dsh-figma-mcp](https://github.com/lubanqihao9875/dsh-figma-mcp)（clone 快照单 commit「Initial commit」，2026-10-17）
对照对象：本仓库 `dsh-figma-local-mcp` 0.3.2。

本文只讨论**连接方式**（MCP 端点、认证、密钥落点、导出语义），不评价代码质量。所有结论都标注了证据位置，便于复核。

---

## 1. 骨架相同，连接对象不同

两边都是同一种 DSH 集成写法：插件包自带 `cordis.patch.yml` → `insert` 一条 `@deepseek-ai/dsh-mcp-client` → 再注入一个 Skill 和一块 UI。所以两边 Agent 看到的工具名都是 `mcp__figma__*`。

差异从"连哪个 MCP 服务器"开始分叉：

| 维度 | dsh-figma-mcp | 本仓库 dsh-figma-local-mcp |
|---|---|---|
| MCP 端点 | `https://mcp.figma.com/mcp`（Figma 云端托管） | `http://127.0.0.1:3845/mcp`（本机 Figma Desktop） |
| 是否需要 Figma 桌面端 | 不需要 | 必须运行且开启 Dev Mode 的 desktop MCP |
| 认证 | Figma OAuth 2.0（PKCE + 动态注册客户端） | Personal Access Token |
| Token scope | `mcp:connect` | `file_content:read`、`current_user:read` |
| 密钥落点 | 明文写入 `~/.dsh/cordis.patch.yml` | `~/.dsh/.credentials.yaml` 中的凭据 record（0600） |
| token 入口 | 浏览器 OAuth 一键 | 侧边栏面板粘贴 PAT |
| 过期处理 | 记 `expiresAt`，支持静默 refresh | Figma 不提供 PAT 精确到期，靠 `GET /v1/me` 探测 |
| 切图落地 | 远端 MCP `download_assets` → 临时 URL | 自研 REST → PNG 直接写入任务 workspace |
| 写能力 | 支持（`use_figma` / FigJam / Slides / Shader / Weave） | 只读 |
| UI 位置 | 设置页卡片（`dsh-client-ui-settings`） | 侧边栏行 + 自有面板 iframe（`dsh-client-ui-layout`） |

---

## 2. 他们的连接流程

**2.1 端点与默认配置**（`lib/index.js:34-41`）

```js
serverName: 'figma'
transport: 'streamable-http'
url: 'https://mcp.figma.com/mcp'
headers: { Authorization: '' }      // 运行时替换为 Bearer <access_token>
toolCallTimeoutMs: 60_000
```

**2.2 OAuth**（`lib/oauth.js`）

1. 动态注册：`POST https://api.figma.com/v1/oauth/mcp/register`，`scope: 'mcp:connect'`，`token_endpoint_auth_method: 'client_secret_post'`，`client_name` 硬编码为 `'Claude Code'`。
2. 授权：`https://www.figma.com/oauth/mcp`，PKCE `S256`，redirect 指向插件自己起的临时监听 `127.0.0.1:<随机端口>/callback`（`lib/index.js:157-225`）。
3. 换 token / 刷新：`POST https://api.figma.com/v1/oauth/token`，按 `expires_in` 折算 `expiresAt`。

**2.3 密钥落点**（`lib/patch.js`）——在 home patch 里维护一段带标记的块：

```yaml
# --- figma-mcp managed (auto-generated; do not edit) ---
# figma-token-expires: 2026-…
# figma-refresh-b64: <base64(client_id, client_secret, refresh_token)>
- insert:
    - id: mcp-figma
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: figma
        transport: streamable-http
        url: https://mcp.figma.com/mcp
        headers: { Authorization: 'Bearer <access_token>' }
# --- end figma-mcp managed ---
```

`readFigmaStatus()` 也只是正则解析这段 YAML。**"连接"在这套设计里等价于"把密钥写进配置文件"。** README 明确承认代价：卸载插件前不点「断开」，patch 文件里会残留一条仍然有效的 token。

---

## 3. 我们的连接流程（对照）

- 端点写死在 `cordis.patch.yml:5-17`，`failOnStartupError: false` + 重连策略，Figma 没开也不阻塞 DSH 启动。
- MCP 会话**不带任何认证头**：本机 `127.0.0.1:3845` 端口即信任边界。
- PAT 只服务我们自己的 REST 客户端（`GET /v1/images/:key?scale=2|3&format=png` 与 `/v1/me` 健康检查），token 从凭据库按需读取，配置文件里没有密钥。
- 面板是本插件自己的侧边栏 iframe，不是设置页卡片。

---

## 4. 导出能力：倍率不是差异点

上一版梳理时曾误判"他们的倍率受 MCP 工具限制"。核对他们随包分发的 [references/tools.md](https://github.com/lubanqihao9875/dsh-figma-mcp/blob/main/skills/dsh-figma-mcp-skill/references/tools.md) 第 2 节后修正：

> `download_assets`：单节点导出，返回原始图像与 SVG icon 集合。**默认遵循节点自身的 export 设置**，仅在用户明确指定时再传入 `defaultFormat` / `defaultScale`。返回的图像 URL 为临时链接，需及时下载。

所以 2x/3x 他们是能做到的。真正的差异是三条：

| | 他们 `download_assets` | 我们 `figma_export_images` |
|---|---|---|
| 倍率怎么给 | 传 `defaultScale`；**不传则跟随节点自身 export 设置**（常见 1x） | 每次显式 `scale=[2,3]`，一次拿两个倍率 |
| 副作用 | 覆盖用户在 Figma 里配好的 export 设置，因此他们文档要求"仅在用户明确要求时才传" | 只读渲染，不改节点任何设置 |
| 产物 | 临时 URL，需要 Agent 再下载、再命名 | 直接写任务 workspace，返回 SHA-256 与真实像素 |
| 格式自由度 | 超集：PNG / JPG / SVG / PDF、icon 集合、`export_video` | 仅 PNG，且要求带 `node-id` 的 Figma URL |
| 失败面 | 云端：链接有效期、文件大小、Weave 计费等额度 | 本机：Figma Desktop 必须运行、本地 MCP 已开启 |

**一句话结论**：格式自由度他们是超集，产物可靠性与可审计性我们是超集；"3x 能不能拿到"两边都能。

---

## 5. 风险与已知坑

1. **明文密钥**：他们的 access/refresh token 都写在用户会手动编辑的 `cordis.patch.yml` 里，`figma-refresh-b64` 还包含 client_secret。任何读取该文件的工具、日志、备份都会带出可用凭据。
2. **未用 DSH 原生凭据模板**：`@deepseek-ai/dsh-mcp-client` 本来支持 transport 字符串里的 `${credential:NAME}` + `expandTemplates: true`（`dsh-mcp-client/src/credentials.ts`，`dsh-mcp-manager` 即如此），会在运行时解析并对诊断信息脱敏。他们没接这套，token 因此无法享受"凭据库 + 自动脱敏"。
3. **动态写 patch 是否立即生效（推断，未实机验证）**：`dsh-app-boot` 只在配置 reload 路径上重载，未发现 loader 侧的配置 watcher；他们直接写文件、不走 plugin-manager 安装流程，因此新 `Authorization` 头可能要到 DSH 重启后才生效。我们不存在该问题——PAT 在导出时按需读取，改完立即生效。
4. **`client_name: 'Claude Code'` 属非公开契约**：借 Figma × Claude 那条已开放的 OAuth 链路，Figma 侧策略调整即可能失效。
5. **`defaultScale` 会覆盖用户导出设置**：默认路径拿到的往往只是节点自身 1x 配置，和"要 2x/3x"的意图不符。
6. **两个插件不能同时安装**：双方都注册 `serverName: figma`，而 `dsh-mcp-client` 要求 `serverName` 在同一注册作用域内唯一（`dsh-mcp-client/src/index.ts` 的 `serverName` 说明）。共存需要改一方的名字空间，否则工具名 `mcp__figma__*` 冲突。
7. **卸载残留是两个插件共有的问题**：我们这边是会留下孤儿凭据 record（DSH 文档要求 surface 只报告、不自动清理）；他们那边是留下可用 token 明文。

---

## 6. 选型建议

- **要读写 Figma / FigJam / Slides、要 Code Connect、要设计系统检索、或不允许装桌面端** → `dsh-figma-mcp`（云端 MCP + OAuth）。
- **要把 2x/3x PNG 可靠落到仓库、要求可审计、不想把凭据放配置文件** → 本仓库（本地 MCP + PAT）。
- **想同时具备**：短期保持二者互斥（改 `serverName` 才能并存）；长期应按第 5 节第 2 条走 `${credential:FIGMA_MCP_TOKEN}` + `expandTemplates: true`，让远端 MCP 条目只持有对凭据库的引用，密钥仍由本插件面板写入。

---

## 7. 可吸取项（详见后续优化方案）

1. 把远端 MCP 作为**可选第二后端**，密钥走 `${credential:…}` 而不是 patch 明文。
2. 学他们的**产品化细节**：`expiresAt` 落库 + 面板显示"剩余 N 天 / 即将过期" + 一键 refresh；设置卡片式入口。
3. 不学：把 token / refresh bundle 写进用户可编辑的配置文件、把"断开"的责任交给用户记忆。
4. 反向补强我们自己的短板：token 保存/移除/读取失败写 append-only 审计，避免再次出现"token 不知道为什么没了"无法归因的情况。

---

## 8. 落地状态（0.3.3）

第 7 节的可吸取项中，P4（远端 MCP 第二后端）按计划暂缓，其余已在本仓库实现：

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 凭据只追加审计 | 已实现 | `lib/audit.js`（`~/.dsh/figma-local-mcp/audit.jsonl`，目录 0700 / 文件 0600，只存指纹），面板「最近变更」显示最新 5 条 |
| 读取失败不再建议删除 | 已实现 | `lib/plugin.js` 的 `credential_error` 文案 + `lib/panel.js` 的未知状态文案 |
| 保存时间 / 剩余天数 / 即将到期一键更换 | 已实现 | payload `savedAt`、`snapshot()` 的 `savedAt`/`daysLeft`、面板 `#saved-at`/`#renew-button` |
| 导出格式与倍率 | 已实现 | `figma_export_images` 支持 `format: png\|svg\|pdf` 与 1x–4x（最多三档）；SVG/PDF 跳过 32MP 位图预检 |
| Skill 薄正文 + references | 已实现 | `lib/index.js` 通过 `skills.register({ resourceBase })` 分发 `references/{tools,targets,auth-state}.md` |
| 远端 MCP 第二后端 | 暂缓 | 需要 `serverName` 改名与 `${credential:…}` ref 形态，单独排期 |

仍未对齐、且**不建议**对齐的部分见第 5 节：明文密钥、动态改写用户配置文件、把"断开"责任交给用户记忆。
