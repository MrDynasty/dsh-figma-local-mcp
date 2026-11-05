import { FigmaApi } from './figma-api.js'
import { createService, CHECK_INTERVAL_MS } from './service.js'
import { createHandler } from './http.js'
import { FigmaError, publicError } from './errors.js'
import { prepareWorkspaceSave } from './workspace.js'

const KEY = 'dsh-figma-local-mcp/personal-access-token'
const ROOT = '/dsh-figma'

function credentialStore(credentials) {
  if (!['readRecord', 'modifyRecord', 'deleteRecord'].every((name) => typeof credentials?.[name] === 'function')) throw new Error('Figma export requires the DSH credential-record service; no plaintext-config fallback is allowed.')
  return {
    async read() {
      const record = await credentials.readRecord(KEY)
      if (!record) return undefined
      const data = record.kind === 'grant' ? record.payload : null
      if (!data || typeof data.token !== 'string' || !/^[\x21-\x7E]{1,2048}$/.test(data.token) || (data.expiresAt != null && !Number.isFinite(Date.parse(data.expiresAt)))) throw new FigmaError('credential_error', '本机 Token 记录无法读取，请删除后重新配置。', 503)
      return data
    },
    write: (payload, assertLive) => credentials.modifyRecord(KEY, () => { assertLive(); return { kind: 'grant', payload } }),
    remove: () => credentials.deleteRecord(KEY),
  }
}

function tool(name, description, properties, required, execute) {
  return {
    name, description, timeoutMs: 30 * 60 * 1000,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      try { return await execute(args, exec) } catch (error) {
        const safe = publicError(error)
        return { error: { code: safe.code, message: safe.message } }
      }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  }
}

export function createExportTool(ctx, service, lifetimeSignal) {
  const definition = tool('figma_export_images',
    'Render real 2x/3x PNGs through Figma REST and automatically SAVE BOTH to the current task workspace in this call. Returns persistent file paths, SHA-256 and actual dimensions, NOT manual-download work. Default outputDir assets/figma; choose the project asset directory as needed. Requires a Figma URL containing node-id and a PAT configured once in the native Figma sidebar panel. Inspect exact targets with Desktop MCP first; do not upscale screenshots, guess keys, or request Tokens in chat. Uses cloud-saved state, not unsaved edits. Requires file_content:read and current_user:read; enforces 32 MP and the calling session sandbox. Missing credentials/denied writes are explicit errors, never silently downgraded.',
    {
      url: { type: 'string', description: 'HTTPS Figma file/branch URL including node-id. Do not guess the file key from selection.' },
      scales: { type: 'array', items: { type: 'integer', enum: [2, 3] }, description: 'Native PNG scales: [2], [3], or [2,3] (default both).' },
      outputDir: { type: 'string', description: 'Task-relative asset directory within the original session workspace; default assets/figma. An exclusive export subdirectory prevents overwrites.' },
    }, ['url'],
    async (args, exec) => {
      // Validate task write capability BEFORE spending render quota. The shell
      // is confined to this session, never the host deployment's default root.
      const save = await prepareWorkspaceSave(ctx, exec, args.outputDir, lifetimeSignal)
      const result = await service.export(args, { signal: exec.signal })
      const files = result.files.map((file) => ({ ...file, bytes: service.download(file.id).bytes }))
      return { ...await save(files), delivery: 'workspace' }
    },
  )
  const execute = definition.execute
  definition.execute = async (args, exec) => ({ ...await execute(args, exec), panelUrl: ctx.webServer.getOrigin() + ROOT })
  return definition
}

export function installExport(ctx) {
  const lifetime = new AbortController()
  const service = createService({ store: credentialStore(ctx.credentials), api: new FigmaApi() })
  const handler = createHandler({ service, connection: ctx.connection, protocol: ctx.webServer.protocol })
  const panelUrl = () => ctx.webServer.getOrigin() + ROOT
  for (const path of [ROOT, ROOT + '/', ...['panel.js', 'panel.css', 'status', 'token', 'check', 'export', 'download'].map((p) => `${ROOT}/${p}`)]) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), 'figma-export.route')
  }
  ctx.effect(() => ctx.tools.register(tool('figma_token_status',
    'Read Figma export Token health and the local settings panel URL. Never ask users to paste a Token into chat. check=true performs an account health check; file permission failures do not prove expiry.',
    { check: { type: 'boolean', description: 'Perform a fresh account check (uses current_user:read); default false.' } }, [],
    async (args) => ({ ...(args.check === true ? await service.check() : await service.status()), panelUrl: panelUrl() }),
  )), 'figma-export.status-tool')
  ctx.effect(() => ctx.tools.register(createExportTool(ctx, service, lifetime.signal)), 'figma-export.export-tool')
  ctx.effect(() => {
    // Low-cost Tier 3 probe; never poll the Tier 1 image-render endpoint.
    const probe = () => { void service.check().catch(() => {}) }
    const timer = setInterval(probe, CHECK_INTERVAL_MS)
    timer.unref?.()
    probe()
    return () => { lifetime.abort(); clearInterval(timer); service.dispose() }
  }, 'figma-export.health-check')
}
