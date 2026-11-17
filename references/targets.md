# Target resolution

## Reading a link

- Accepted hosts: `www.figma.com`, `figma.com` — HTTPS only, no userinfo, no explicit port.
- Accepted paths: `/design/…`, `/file/…`, `/board/…`, `/slides/…`.
- File key is the segment after the path kind; for `/design/<key>/branch/<branchKey>/…` the **branch key** is used.
- Node ids come from the `node-id` query parameter. Normalize `123-456` to `123:456`. Multiple ids may be comma-separated (max 10).
- A link without `node-id` has no exportable target for REST rendering. Ask for a node link instead of guessing a key.

## Current selection

The Figma Desktop MCP can read the current selection, but a selection alone does not reveal a reliable file key for REST export. Use MCP tools for inspection, and ask for the link when a real file must be written.

## Output location

- `outputDir` is resolved inside the calling session workspace by the host, not by this plugin. Paths outside it fail closed.
- Default `assets/figma`; prefer the repository's existing convention (`public/images`, `Sources/Assets.xcassets`, …).
- One export call per logical batch; the tool creates an exclusive subdirectory so repeated runs never overwrite earlier files.
- Files keep the real pixel size Figma produced. If the reported size disagrees with `node × scale`, the tool adds a warning and does not compensate.

## Coordinate with implementation

1. Resolve the target and read the design before writing code.
2. Export the exact nodes the implementation needs, not whole frames.
3. Reference the returned workspace paths in code; verify both scales exist before reporting completion.
