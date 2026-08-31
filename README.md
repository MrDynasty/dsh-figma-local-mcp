# dsh-figma-local-mcp

Global integration between DSH and the **local Figma Desktop MCP server**, with design-to-code guidance for every agent preset.

This plugin does NOT use the Figma REST API and does not need a Figma token. It connects to the MCP server that Figma Desktop itself exposes on your machine, so it can read the currently open file, the current selection, and export assets from it.

## Features

- Connects the harness-provided `@deepseek-ai/dsh-mcp-client` service to `http://127.0.0.1:3845/mcp` (auto-reconnect, non-blocking when Figma is closed). The client ships with DSH itself — this plugin only configures it through the bundled `cordis.patch.yml` and declares no npm dependency on it, so it always runs against the host's own version.
- Global routing prompt: any Figma URL, current selection, design-to-code request, or asset-export request routes to the `mcp__figma__*` tools in every agent mode.
- Global `figma-design-to-code` skill that adapts Figma output to the target repository conventions.

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

## Troubleshooting

- `✕ missing peer @deepseek-ai/...` lines in the `dsh plugin` output are expected. DSH profiles set `autoInstallPeers: false`; host packages such as `@deepseek-ai/cordis`, `@deepseek-ai/dsh-mcp-client`, `dsh-llm`, `dsh-tools`, etc. are provided by the DSH installation itself at runtime through the profile module fallback, so pnpm's peer check reports them as "missing" even though they resolve fine. This is normal for every DSH plugin, including the officially bundled ones.
- `No session found for sessionId` after restarting Figma Desktop: expected — the MCP session is process-local. Restart the DSH web process (or wait for the bridge reconnect) and retry.
- `get_design_context` timeouts on first call or on large files: the tool renders code and exports every SVG in-process; if it exceeds the 60 s default `toolCallTimeoutMs`, raise it in the plugin config (`figma-mcp-client.config.toolCallTimeoutMs`, for example 120000).

## License

MIT
