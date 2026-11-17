import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuditLog, fingerprintToken, auditPath } from '../lib/audit.js'

const SECRET = 'figd_FAKE_TEST_TOKEN_NOT_A_REAL_SECRET'
const clock = () => new Date('2026-01-01T00:00:00Z')

async function withLog(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'figma-audit-'))
  try {
    const log = createAuditLog({ file: join(dir, 'audit.jsonl'), now: clock, ...options })
    return await run(log, join(dir, 'audit.jsonl'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('fingerprints are stable, short, and never reversible', () => {
  const a = fingerprintToken(SECRET)
  assert.match(a, /^[0-9a-f]{8}$/)
  assert.notEqual(a, SECRET); assert.equal(a, fingerprintToken(SECRET))
  assert.notEqual(a, fingerprintToken(SECRET + 'x'))
  assert.equal(fingerprintToken(''), null); assert.equal(fingerprintToken(undefined), null)
})

test('audit path stays inside the DSH home and never escapes it', () => {
  assert.equal(auditPath({ DSH_HOME: '/tmp/home' }), '/tmp/home/figma-local-mcp/audit.jsonl')
  assert.match(auditPath({}), /\/\.dsh\/figma-local-mcp\/audit\.jsonl$/)
})

test('entries keep only allowlisted fields, newest first', async () => {
  await withLog(async (log, file) => {
    await log.record('save', { actor: 'panel', fingerprint: fingerprintToken(SECRET), expiresAt: '2026-01-03T00:00:00Z', token: SECRET, payload: SECRET })
    await log.record('remove', { actor: 'panel', fingerprint: fingerprintToken(SECRET), note: SECRET })
    const entries = await log.tail()
    assert.deepEqual(entries.map((e) => e.action), ['remove', 'save'])
    assert.equal(entries[1].at, '2026-01-01T00:00:00.000Z')
    assert.equal(entries[1].actor, 'panel'); assert.equal(entries[1].expiresAt, '2026-01-03T00:00:00Z')
    const raw = await readFile(file, 'utf8')
    assert.ok(!raw.includes(SECRET)); assert.ok(!raw.includes('"token"'))
    assert.ok(!('token' in entries[1]) && !('payload' in entries[1]))
  })
})

test('unknown actions, actors and states normalise instead of leaking', async () => {
  await withLog(async (log, file) => {
    await log.record('SAVE; rm -rf', { actor: 'someone', state: 'Bad State<script>', at: 'not a date' })
    const [entry] = await log.tail()
    assert.equal(entry.action, 'unknown'); assert.equal(entry.actor, 'unknown')
    assert.equal(entry.state, null); assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/)
    assert.ok(!(await readFile(file, 'utf8')).includes('script'))
  })
})

test('tail is bounded, read failures degrade to empty, and writes rotate', async () => {
  await withLog(async (log, file) => {
    assert.deepEqual(await log.tail(), [])
    for (let index = 0; index < 40; index += 1) await log.record('check-fail', { actor: 'background', state: 'network_error' })
    assert.equal((await log.tail()).length, 5)
    assert.equal((await log.tail(2)).length, 2)
    const kept = (await log.tail(1000)).length
    assert.ok(kept < 40 && kept >= 8, `rotation kept ${kept} entries`)
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(file))
    assert.ok(size > 0)
  }, { limit: 512, keep: 8 })
})

test('record never rejects even when the directory is unusable', async () => {
  const log = createAuditLog({ file: '/dev/null/audit.jsonl', now: clock })
  await assert.doesNotReject(log.record('save', { actor: 'panel' }))
  assert.deepEqual(await log.tail(), [])
})
