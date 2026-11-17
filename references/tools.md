# Tool selection and export contract

## Read-only Desktop MCP tools

| Need | Tool |
| --- | --- |
| Implement UI from a design | `mcp__figma__get_design_context` |
| Navigate a large file, discover node ids | `mcp__figma__get_metadata` (then `get_design_context` on the exact node) |
| Visual reference or verification | `mcp__figma__get_screenshot` |
| Colors, typography, spacing, tokens | `mcp__figma__get_variable_defs` |
| Animation context | `mcp__figma__get_motion_context` (only after design context) |
| FigJam board | `mcp__figma__get_figjam` |

Do not use `get_metadata` as a substitute for `get_design_context`. Do not guess inspectable details when the MCP connection is available.

## `figma_export_images` (this plugin's own tool)

Renders through the Figma REST API and writes files directly into the calling task workspace.

| Parameter | Meaning |
| --- | --- |
| `url` | HTTPS `figma.com` file/branch URL containing `node-id`; at most 10 node ids |
| `format` | `png` (default), `svg`, or `pdf`. Raster scales apply to PNG only |
| `scales` | `1`–`4`, up to three distinct values, default `[2,3]` |
| `outputDir` | Task-relative asset directory, default `assets/figma`; use the project's real asset directory |

Rules:

- Call it in the same task that needs the assets; never defer to a follow-up turn.
- Default to PNG `[2,3]` for raster assets. Use `svg` only when the project consumes vectors (icons, logos). Use `pdf` only when explicitly requested.
- Preflight is real: 32 MP applies per raster file, 100 MB per batch, downloads expire after 10 minutes.
- The result is `delivery: workspace` with persistent paths, actual dimensions and SHA-256. Temporary `/dsh-figma/download` links are a manual interface, never the delivery mechanism.
- The tool never upscales and never fabricates a file key. A failed write is an error, not a reason to hand the user a download link.

## Failure semantics

| Error | Meaning | Action |
| --- | --- | --- |
| `missing` | No PAT configured | Point the user to the left-sidebar Figma row settings panel, then resume |
| `invalid_or_expired` | Figma rejected the token | Ask the user to replace the PAT in that panel (never in chat) |
| `permission_denied` | Token scopes or file ACLs | Explain scopes (`file_content:read`, `current_user:read`) or sharing; do not claim expiry |
| `render_failed` | Missing/hidden node, or empty render | Verify the node id with `get_metadata`; do not retry with other scales |
| `image_too_large` | Over 32 MP at that scale | Lower the scale or export a smaller node |
| `unsafe_asset_url` | Unexpected asset host | Stop; report the error. Do not bypass |
