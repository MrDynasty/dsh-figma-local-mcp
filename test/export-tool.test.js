import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createExportTool } from '../lib/plugin.js'

async function harness(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-figma-tool-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const files = [2, 3].map((scale) => ({ id: String(scale), filename: `figma-1-2@${scale}x.png`, width: 100 * scale, height: 50 * scale, warnings: [], downloadUrl: '/dsh-figma/download?id=' + scale }))
  let exports = 0
  const service = { export: async () => { exports++; return { files } }, download: (id) => ({ bytes: Buffer.from([137, 80, 78, 71, 0, Number(id), 255]) }) }
  const exec = { agent: { session: { id: 'task' } }, signal: new AbortController().signal }
  const ctx = {
    webServer: { getOrigin: () => 'http://127.0.0.1:56275' },
    workingDirectory: { ensure: async () => cwd },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: cwd, sessionId: 'task' }) },
    shell: { sandboxMode: 'workspace-write', resolve: (s) => s, async execute(spec) { return { result: async () => {
      const child = spawn('bash', ['-c', spec.command], { cwd, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'] })
      const chunks = []; child.stdout.on('data', (c) => chunks.push(c)); child.stderr.resume(); child.stdin.end(spec.stdin)
      const exitCode = await new Promise((ok, no) => { child.once('close', ok); child.once('error', no) })
      return { exitCode, stdout: { text: Buffer.concat(chunks).toString() }, sandbox: { mode: 'workspace-write', denied: false } }
    } } } },
  }
  return { cwd, ctx, exec, service, exports: () => exports }
}

test('conversation tool renders and saves both scales in one call, returning persistent paths not manual download links', async (t) => {
  const h = await harness(t)
  const tool = createExportTool(h.ctx, h.service)
  assert.ok(tool.parameters.properties.outputDir)
  const result = await tool.execute({ url: 'https://www.figma.com/design/key/Name?node-id=1-2' }, h.exec)
  assert.equal(h.exports(), 1)
  assert.equal(result.files.length, 2)
  assert.equal(result.delivery, 'workspace')
  for (const file of result.files) {
    assert.ok(file.path.startsWith(h.cwd + '/assets/figma/'))
    assert.equal((await readFile(file.path))[5], file.width / 100)
    assert.equal(file.downloadUrl, undefined)
  }
})

test('unsupported or denied task write capability fails before consuming Figma render quota', async (t) => {
  const h = await harness(t)
  delete h.ctx.shell
  const result = await createExportTool(h.ctx, h.service).execute({ url: 'https://www.figma.com/design/key/Name?node-id=1-2' }, h.exec)
  assert.equal(result.error.code, 'workspace_unavailable')
  assert.equal(h.exports(), 0)
  assert.equal(result.panelUrl, 'http://127.0.0.1:56275/dsh-figma')
})
