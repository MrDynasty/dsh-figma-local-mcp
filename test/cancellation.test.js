import test from 'node:test'
import assert from 'node:assert/strict'
import { createService } from '../lib/service.js'
import { FigmaApi } from '../lib/figma-api.js'

function fixture() {
  const calls = []
  const api = {
    verify: async () => { calls.push('verify') },
    nodes: async () => ({ '1:2': { document: { absoluteBoundingBox: { width: 1, height: 1 } } } }),
    render: async (_k, _ids, scale) => { calls.push('render' + scale); return { '1:2': 'image' } },
    download: async () => { calls.push('download'); return { bytes: Buffer.from('png'), width: 2, height: 2 } },
  }
  return { calls, api, service: createService({ store: { read: async () => ({ token: 'fake' }) }, api }) }
}
const input = { url: 'https://figma.com/design/key/name?node-id=1-2' }

test('cancel during 2x render stops downloads, 3x render and publication', async () => {
  const f = fixture(), controller = new AbortController()
  f.api.render = async () => { f.calls.push('render2'); controller.abort(); return { '1:2': 'image' } }
  await assert.rejects(f.service.export(input, { signal: controller.signal }), { code: 'cancelled' })
  assert.deepEqual(f.calls, ['verify', 'render2'])
})

test('canceled queued call consumes no quota and does not cancel another session', async () => {
  const f = fixture(), controller = new AbortController()
  let unblock
  f.api.verify = () => { f.calls.push('verify'); return unblock ? Promise.resolve() : new Promise((ok) => { unblock = ok }) }
  const first = f.service.export(input)
  while (!unblock) await Promise.resolve()
  const canceled = f.service.export(input, { signal: controller.signal }); controller.abort()
  unblock()
  assert.equal((await first).files.length, 2)
  const count = f.calls.length
  await assert.rejects(canceled, { code: 'cancelled' })
  assert.equal(f.calls.length, count)
})

test('per-call API signal aborts active fetch without disposing other callers', async () => {
  let entered
  const ready = new Promise((ok) => { entered = ok })
  let calls = 0
  const api = new FigmaApi({ fetch: async (_url, { signal }) => {
    if (++calls === 2) return Response.json({ id: 'account' })
    entered()
    return new Promise((_ok, no) => { signal.addEventListener('abort', () => no(new Error('aborted')), { once: true }) })
  } })
  const controller = new AbortController()
  const pending = api.verify('fake', controller.signal)
  await ready; controller.abort()
  // A missing signal hook must fail promptly, not keep a real 60-second timer.
  const outcome = await Promise.race([pending.catch((e) => e.code), Promise.resolve().then(() => new Promise((ok) => setImmediate(() => ok('not-aborted'))))])
  assert.equal(outcome, 'cancelled')
  await api.verify('fake')
  api.dispose()
})
