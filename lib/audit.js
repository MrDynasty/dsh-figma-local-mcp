import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const AUDIT_FILENAME = 'audit.jsonl'
export const AUDIT_LIMIT_BYTES = 256 * 1024
export const AUDIT_TAIL_ENTRIES = 5
const KEEP_ON_ROTATE = 200
const ACTIONS = new Set(['save', 'remove', 'read-invalid', 'check-fail', 'check-ok'])
const ACTORS = new Set(['panel', 'tool', 'background', 'plugin', 'unknown'])
const STATE = /^[a-z][a-z0-9_]{0,39}$/
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const FINGERPRINT = /^[0-9a-f]{8}$/

/** Append-only audit trail for the stored credential. Contains no secret material. */
export function auditPath(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'figma-local-mcp', AUDIT_FILENAME)
}

/** Stable, non-reversible short fingerprint so saves/removals can be correlated. */
export function fingerprintToken(token) {
  if (typeof token !== 'string' || token === '') return null
  return createHash('sha256').update(token).digest('hex').slice(0, 8)
}

function normalize(value) {
  if (!value || typeof value !== 'object') return null
  const at = typeof value.at === 'string' && value.at.length <= 40 && Number.isFinite(Date.parse(value.at)) ? new Date(value.at).toISOString() : null
  if (!at) return null
  return {
    at,
    action: ACTIONS.has(value.action) ? value.action : 'unknown',
    actor: ACTORS.has(value.actor) ? value.actor : 'unknown',
    fingerprint: typeof value.fingerprint === 'string' && FINGERPRINT.test(value.fingerprint) ? value.fingerprint : null,
    expiresAt: typeof value.expiresAt === 'string' && STAMP.test(value.expiresAt) ? value.expiresAt : null,
    state: typeof value.state === 'string' && STATE.test(value.state) ? value.state : null,
  }
}

export function createAuditLog({ file = auditPath(), now = Date.now, limit = AUDIT_LIMIT_BYTES, keep = KEEP_ON_ROTATE } = {}) {
  let queue = Promise.resolve()
  async function append(action, detail) {
    const line = JSON.stringify(normalize({
      at: new Date(now()).toISOString(),
      action,
      actor: detail?.actor,
      fingerprint: detail?.fingerprint,
      expiresAt: detail?.expiresAt,
      state: detail?.state,
    })) + '\n'
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    let size = 0
    try { size = (await stat(file)).size } catch { size = 0 }
    if (size + Buffer.byteLength(line) > limit) {
      // Keep the file bounded without losing the most recent history.
      const kept = (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).slice(-keep)
      await writeFile(file, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
    }
    await appendFile(file, line, { mode: 0o600 })
  }
  return {
    /** Never rejects: an audit failure must not break a token operation. */
    record(action, detail = {}) {
      queue = queue.then(() => append(action, detail)).catch(() => {})
      return queue
    },
    async tail(count = AUDIT_TAIL_ENTRIES) {
      let text
      try { text = await readFile(file, 'utf8') } catch { return [] }
      const entries = []
      for (const raw of text.split('\n').reverse()) {
        if (entries.length >= count) break
        const line = raw.trim()
        if (!line) continue
        let parsed
        try { parsed = JSON.parse(line) } catch { continue }
        const entry = normalize(parsed)
        if (entry) entries.push(entry)
      }
      return entries
    },
  }
}
