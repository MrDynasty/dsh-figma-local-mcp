const name = 'figma-mcp-global-guidance'
const inject = ['systemPrompt', 'skills']

const skillContent = `# Figma Design-to-Code

Use this guidance whenever a request contains a Figma design, FigJam, or Slides URL; asks you to implement or modify UI from Figma; refers to the current Figma selection; or asks to inspect, compare, or export Figma assets.

## Required workflow

1. Inspect the target repository before generating code. Identify its framework, component library, design tokens, asset conventions, routing, and test commands.
2. Extract the node id from the URL query parameter \`node-id\` and normalize \`123-456\` to \`123:456\`. When no node id is supplied, use the current Figma Desktop selection.
3. Call \`mcp__figma__get_design_context\` first for design-to-code work. Supply the known framework and languages and the appropriate artifact/task type. Do not use metadata as a substitute for design context.
4. Call \`mcp__figma__get_screenshot\` to verify the visual target. Call variable definitions for colors, typography, spacing, and tokens when relevant. Call motion context after design context when the target contains animation.
5. Adapt the returned reference code to the existing project. Reuse local components and tokens; do not replace established architecture with generated scaffolding.
6. Use real assets returned by Figma. Do not invent placeholders when inspectable assets exist. Preserve aspect ratio and choose a project-appropriate asset location.
7. Implement the complete requested state, including responsive layout and interaction states that are visible or structurally implied by the selected design.
8. Run the repository's checks and verify the rendered result against the Figma screenshot at relevant desktop and mobile sizes. Correct visible layout, typography, overflow, and asset differences before finishing.

## Tool selection

- Prefer \`get_design_context\` for implementation.
- Use \`get_metadata\` only to navigate a large file or discover node ids, then call \`get_design_context\` on the exact target.
- Use \`get_screenshot\` for visual inspection and verification.
- Use \`get_variable_defs\` for design variables and tokens.
- Use \`get_motion_context\` only after design context.
- Use \`get_figjam\` only for FigJam board URLs.

If Figma Desktop MCP is unavailable, explain that Figma Desktop must be running with the local MCP server enabled at \`http://127.0.0.1:3845/mcp\`. Do not silently continue with guessed design details.`

function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'integration:figma-mcp',
    order: 560,
    text: 'Figma Desktop MCP is a global capability. When a request contains a Figma URL, asks to implement UI from Figma, refers to the current Figma selection, or requests Figma asset export, load the figma-design-to-code skill and use the mcp__figma__* tools before implementing or exporting. Do not guess inspectable design details.',
  }), 'figma-mcp.prompt')

  ctx.effect(() => ctx.skills.register({
    name: 'figma-design-to-code',
    description: 'Read Figma designs through the local Desktop MCP and implement them using the target project conventions.',
    whenToUse: 'Use for Figma URLs, current Figma selections, design-to-code work, UI comparison, variable inspection, and Figma asset export.',
    content: skillContent,
    source: 'plugin',
    invocation: {
      modelInvocable: true,
      userInvocable: true,
    },
    provider: 'dsh-figma-local-mcp',
  }), 'figma-mcp.skill')
}

export { apply, inject, name }
