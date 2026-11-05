import test from 'node:test'
import assert from 'node:assert/strict'
import { createService } from '../lib/service.js'
import { FigmaApi, safeAssetUrl } from '../lib/figma-api.js'

const url = 'https://www.figma.com/design/AbC/Test?node-id=1-2,3-4,5-6'
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const apiBase = () => ({ verify: async () => {}, nodes: async () => Object.fromEntries(['1:2', '3:4', '5:6'].map((id) => [id, { document: { absoluteBoundingBox: { width: 100, height: 50 } } }])), render: async () => ({ '1:2': 'https://s3-alpha.figma.com/1', '3:4': 'https://s3-alpha.figma.com/2', '5:6': 'https://s3-alpha.figma.com/3' }) })
function harness(api) {
  let record = { token: 'fake-test' }, writes = 0
  const service = createService({ api, store: { read: async () => record, write: async (v) => { record = v; writes++ }, remove: async () => { record = undefined } } })
  return { service, writes: () => writes }
}
test('disposal during candidate validation prevents credential write', async () => {
  const pending = deferred(); const started = deferred()
  const h = harness({ verify: async () => { started.resolve(); await pending.promise } })
  const result = h.service.save({ token: 'new-fake-test' })
  await started.promise; h.service.dispose(); pending.resolve()
  await assert.rejects(result, { code: 'disposed' }); assert.equal(h.writes(), 0)
})
test('disposal during download stops later requests and artifact publication', async () => {
  const pending = deferred(); const started = deferred(); let downloads = 0
  const h = harness({ ...apiBase(), download: async () => { downloads++; started.resolve(); await pending.promise; return { bytes: Buffer.from('fake'), width: 200, height: 100 } } })
  const result = h.service.export({ url, scales: [2] })
  await started.promise; h.service.dispose(); pending.resolve()
  await assert.rejects(result, { code: 'disposed' }); assert.equal(downloads, 1)
})
test('running batch budget stops downloads before retaining a fourth file', async () => {
  let downloads = 0
  const h = harness({ ...apiBase(), download: async () => { downloads++; return { bytes: { length: 40 * 1024 * 1024 }, width: 200, height: 100 } } })
  await assert.rejects(h.service.export({ url, scales: [2, 3] }), { code: 'cache_limit' })
  assert.equal(downloads, 3)
})
test('oversized native render is rejected before consuming render quota', async () => {
  let renders = 0
  const h = harness({ ...apiBase(), nodes: async () => ({ '1:2': { document: { absoluteBoundingBox: { width: 4000, height: 4000 } } } }), render: async () => { renders++ } })
  await assert.rejects(h.service.export({ url: url.split(',')[0], scales: [2] }), { code: 'image_too_large' }); assert.equal(renders, 0)
})
test('asset URL constraints reject credentials, ports, redirects targets and localhost', () => {
  for (const value of ['http://s3-alpha.figma.com/x', 'https://user:pass@s3-alpha.figma.com/x', 'https://s3-alpha.figma.com:444/x', 'https://s3-alpha.figma.com.evil.test/x', 'https://127.0.0.1/x', 'https://169.254.169.254/x', 'https://another-bucket.s3.us-west-2.amazonaws.com/x']) assert.throws(() => safeAssetUrl(value), { code: 'unsafe_asset_url' })
})
test('rate limit respects Retry-After before any repeated Figma request', async () => {
  let calls = 0, now = 1000
  const api = new FigmaApi({ now: () => now, fetch: async () => { calls++; return Response.json({}, { status: 429, headers: { 'Retry-After': '60' } }) } })
  await assert.rejects(api.verify('fake'), { code: 'rate_limited' }); await assert.rejects(api.verify('fake'), { code: 'rate_limited' }); assert.equal(calls, 1)
  now += 61000
  await assert.rejects(api.verify('fake'), { code: 'rate_limited' }); assert.equal(calls, 2)
})
