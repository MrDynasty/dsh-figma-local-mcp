import { fileURLToPath } from 'node:url'
import { installExport } from './plugin.js'

const name = 'figma-mcp-global-guidance'
const inject = ['systemPrompt', 'skills']
const references = fileURLToPath(new URL('../references', import.meta.url))

const skillContent = `# Figma Design-to-Code

Use this guidance whenever a request contains a Figma design, FigJam, or Slides URL; asks you to implement or modify UI from Figma; refers to the current Figma selection; or asks to inspect, compare, or export Figma assets.

## Required workflow

1. Inspect the target repository first: framework, component library, design tokens, asset conventions, routing, test commands.
2. Resolve the target — read \`references/targets.md\` before parsing a link or choosing \`outputDir\`.
3. Call \`mcp__figma__get_design_context\` first for design-to-code work, with the known framework and languages. Do not substitute metadata for design context.
4. Verify visually with \`mcp__figma__get_screenshot\`; read variable definitions for colors, typography and spacing; read motion context only when the target animates.
5. Adapt the returned reference code to the project. Reuse local components and tokens instead of replacing established architecture.
6. Deliver real assets inside the same task: call \`figma_export_images\` with the exact nodes and the project asset directory. It saves files into the workspace and returns persistent paths, dimensions and SHA-256. Confirm the requested scales exist before reporting completion.
7. Implement the complete requested state, including responsive layout and interaction states that the design shows or clearly implies.
8. Run the repository's checks and compare the rendered result against the Figma screenshot at desktop and mobile sizes. Fix visible differences before finishing.

## References

- \`references/tools.md\` — which MCP tool to use, the \`figma_export_images\` contract, failure semantics.
- \`references/targets.md\` — URL/file-key/node-id parsing, current selection limits, output directory rules.
- \`references/auth-state.md\` — token states, where users configure the PAT, and the credential audit trail.

## Hard rules

- Never ask for, echo, or paste a Figma token in chat. Users configure PATs only in the native panel behind the left-sidebar Figma row; send them there and resume the task.
- Never upscale a screenshot, fabricate a file key, or leave temporary download links as the deliverable. Missing credentials or denied writes are real errors.
- Exact token expiry is user-supplied or unknown; never invent one, and never treat a generic file 403 as proven expiry.
- If the Figma Desktop MCP is unavailable, say that Figma Desktop must be running with the local MCP server enabled at \`http://127.0.0.1:3845/mcp\` instead of guessing design details.`

function apply(ctx) {
  ctx.inject(['webServer', 'credentials', 'connection', 'tools', 'workingDirectory', 'sandboxPolicy', 'shell'], installExport)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'integration:figma-mcp',
    order: 560,
    text: 'Figma Desktop MCP is a global capability. When a request contains a Figma URL, asks to implement UI from Figma, refers to the current Figma selection, or requests Figma asset export, load the figma-design-to-code skill and use the mcp__figma__* tools before implementing or exporting. Do not guess inspectable design details. For raster assets needed by a Figma implementation, automatically call figma_export_images with scales [2,3] in the same task, choose the project asset outputDir, and integrate the returned workspace files before claiming completion. Vector work may use format svg. Do not leave temporary download links, defer asset export to a follow-up, upscale screenshots, or fabricate file keys. Missing/invalid PATs require the native Figma settings panel (left sidebar Figma row), never the isolated sidebar browser or chat secrets; then resume the task. Sandbox write failures are errors, not a manual-download fallback.',
  }), 'figma-mcp.prompt')

  ctx.effect(() => ctx.skills.register({
    name: 'figma-design-to-code',
    description: 'Read Figma designs through the local Desktop MCP and implement them using the target project conventions.',
    whenToUse: 'Use for Figma URLs, current Figma selections, design-to-code work, UI comparison, variable inspection, and Figma asset export.',
    content: skillContent,
    resourceBase: { kind: 'directory', path: references },
    source: 'plugin',
    invocation: {
      modelInvocable: true,
      userInvocable: true,
    },
    provider: 'dsh-figma-local-mcp',
  }), 'figma-mcp.skill')
}

export { apply, inject, name }
