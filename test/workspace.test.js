import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { prepareWorkspaceSave } from '../lib/workspace.js'

async function fixture(t, resultOverride) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-figma-workspace-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const signal = new AbortController().signal
  const exec = { agent: { session: { id: 'current-session' } }, signal }
  const policy = { mode: 'workspace-write', workspaceRoot: cwd, sessionId: 'current-session' }
  const calls = []
  const ctx = {
    workingDirectory: { ensure: async (agent, s) => { assert.equal(agent, exec.agent); assert.equal(s, signal); return cwd } },
    sandboxPolicy: { resolve: ({ session }) => { assert.equal(session, exec.agent.session); return policy } },
    shell: {
      sandboxMode: 'workspace-write', resolve: (r) => { calls.push(r); return r },
      async execute(spec) {
        return { result: async () => {
          if (resultOverride) return resultOverride
          // Exercise the exact fixed helper and binary stdin, not a pretend fs write.
          const child = spawn('bash', ['-c', spec.command], { cwd: spec.workdir, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], signal: spec.signal })
          const out = [], err = []
          child.stdout.on('data', (b) => out.push(b)); child.stderr.on('data', (b) => err.push(b)); child.stdin.end(spec.stdin)
          const code = await new Promise((ok, no) => { child.once('close', ok); child.once('error', no) })
          return { exitCode: code, stdout: { text: Buffer.concat(out).toString() }, stderr: { text: Buffer.concat(err).toString() }, sandbox: { mode: policy.mode, denied: false } }
        } }
      },
    },
  }
  return { cwd, ctx, exec, policy, calls }
}
const files = () => [2, 3].map((scale) => ({ filename: `figma-1-2@${scale}x.png`, width: 10 * scale, height: 5 * scale, bytes: Buffer.from([137, 80, 78, 71, 0, scale, 255]), warnings: [] }))

test('one export writes both binaries to the current workspace via session-confined shell stdin', async (t) => {
  const f = await fixture(t)
  const save = await prepareWorkspaceSave(f.ctx, f.exec)
  const result = await save(files())
  assert.equal(result.files.length, 2)
  for (let i = 0; i < 2; i++) {
    const file = result.files[i]
    assert.ok(file.path.startsWith(join(f.cwd, 'assets', 'figma') + '/'))
    assert.deepEqual(await readFile(file.path), files()[i].bytes)
    assert.equal(file.width, files()[i].width)
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    assert.equal(file.downloadUrl, undefined)
  }
  assert.deepEqual(f.calls[0].sandboxPolicy, f.policy)
  assert.ok(Buffer.isBuffer(f.calls[0].stdin))
  assert.equal(f.calls[0].workdir, f.cwd)
  assert.equal(f.calls[0].onExpiry, 'kill')
  assert.ok(!f.calls[0].command.includes(files()[0].bytes.toString('base64')))
})

test('output directory is task-relative, subsequent exports never overwrite files', async (t) => {
  const f = await fixture(t)
  const first = await (await prepareWorkspaceSave(f.ctx, f.exec, 'public/design assets'))(files())
  const second = await (await prepareWorkspaceSave(f.ctx, f.exec, 'public/design assets'))(files())
  assert.notEqual(first.files[0].path, second.files[0].path)
  assert.deepEqual(await readFile(first.files[0].path), files()[0].bytes)
})

test('unsafe destinations and unconfined/unavailable service fail before render or write', async (t) => {
  const f = await fixture(t)
  for (const dir of ['/tmp/outside', '../escape', 'assets/../../outside', 'a\u0000b']) await assert.rejects(prepareWorkspaceSave(f.ctx, f.exec, dir))
  await assert.rejects(prepareWorkspaceSave(f.ctx, {}))
  f.ctx.shell.sandboxMode = undefined
  await assert.rejects(prepareWorkspaceSave(f.ctx, f.exec))
  assert.equal(f.calls.length, 0)
})

test('read-only session or cd outside immutable workspace is not silently escalated', async (t) => {
  const f = await fixture(t)
  f.policy.mode = 'read-only'
  await assert.rejects(prepareWorkspaceSave(f.ctx, f.exec), (e) => e.code === 'workspace_denied')
  f.policy.mode = 'workspace-write'
  f.ctx.workingDirectory.ensure = async () => resolve(f.cwd, '..')
  await assert.rejects(prepareWorkspaceSave(f.ctx, f.exec), (e) => e.code === 'workspace_denied')
})

test('sandbox rejection, nonzero exit, cancellation and bad receipts never claim saved paths', async (t) => {
  for (const result of [
    { exitCode: 1 }, { exitCode: 0, aborted: true }, { exitCode: 0, timedOut: true },
    { exitCode: 0, sandbox: { mode: 'workspace-write', denied: true } },
    { exitCode: 0, sandbox: { mode: 'workspace-write', denied: false }, stdout: { text: '{}' } },
  ]) {
    const f = await fixture(t, result)
    await assert.rejects((await prepareWorkspaceSave(f.ctx, f.exec))(files()), (e) => e.code === 'workspace_save_failed')
  }
})

test('malicious filenames cannot escape batch directory; already-cancelled tools do no write', async (t) => {
  const f = await fixture(t)
  const save = await prepareWorkspaceSave(f.ctx, f.exec)
  await assert.rejects(save([{ ...files()[0], filename: '../escaped.png' }]))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(prepareWorkspaceSave(f.ctx, { ...f.exec, signal: abort.signal }))
  assert.equal(f.calls.length, 0)
})
