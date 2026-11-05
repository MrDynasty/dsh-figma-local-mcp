import test from 'node:test'
import assert from 'node:assert/strict'
import { createService } from '../lib/service.js'
import { parseTarget, FigmaApi } from '../lib/figma-api.js'

const SECRET = 'figd_FAKE_TEST_TOKEN_NOT_A_REAL_SECRET'
const url = 'https://www.figma.com/design/AbC123/Test?node-id=12-34'
const png = (width = 200, height = 100) => { const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b }
function setup() {
  let stored, clock = Date.parse('2026-01-01T00:00:00Z')
  const requests = []
  let me = () => Response.json({ id: 'test-user' })
  let render = () => Response.json({ images: { '12:34': 'https://s3-alpha.figma.com/export.png?signature=fake' } })
  const fetch = async (input, options = {}) => {
    requests.push({ url: String(input), options })
    if (String(input).endsWith('/me')) return me()
    if (String(input).includes('/nodes?')) return Response.json({ nodes: { '12:34': { document: { absoluteBoundingBox: { width: 100, height: 50 }, absoluteRenderBounds: { width: 100, height: 50 } } } } })
    if (String(input).includes('/images/')) return render()
    return new Response(png())
  }
  const store = { read: async () => stored, write: async (v) => { stored = v }, remove: async () => { stored = undefined } }
  const service = createService({ store, api: new FigmaApi({ fetch }), now: () => clock })
  return { service, requests, stored: () => stored, setMe: (v) => { me = v }, setRender: (v) => { render = v }, advance: (ms) => { clock += ms } }
}

test('parses canonical file and branch targets, normalizes node ids', () => {
  assert.deepEqual(parseTarget(url), { key: 'AbC123', ids: ['12:34'] })
  assert.equal(parseTarget('https://www.figma.com/design/Main/branch/Branch/Name?node-id=1%3A2').key, 'Branch')
  for (const value of ['http://www.figma.com/design/AbC/X?node-id=1-2', 'https://figma.com.evil.test/design/AbC/X?node-id=1-2', 'https://www.figma.com/design/AbC/X', 'https://a:b@www.figma.com/design/AbC/X?node-id=1-2']) assert.throws(() => parseTarget(value))
})
test('missing status is safe and includes no secret', async () => {
  const s = setup(); assert.equal((await s.service.status()).state, 'missing')
  await assert.rejects(s.service.export({ url, scales: [2] }), { code: 'missing' })
})
test('save validates, stores server-side and returns allowlisted status only', async () => {
  const s = setup(); const result = await s.service.save({ token: SECRET, expiresAt: '2026-01-03T00:00:00Z' })
  assert.equal(result.state, 'expiring'); assert.equal(s.stored().token, SECRET)
  assert.ok(!JSON.stringify(result).includes(SECRET)); assert.equal(result.expirySource, 'user')
  assert.equal(s.requests[0].options.headers['X-Figma-Token'], SECRET)
  assert.equal(s.requests[0].options.redirect, 'error')
})
test('unknown expiration is never invented as 90 days from save', async () => {
  const s = setup(); const r = await s.service.save({ token: SECRET }); assert.equal(r.expiresAt, null); assert.equal(r.expirySource, 'unknown')
})
test('rejected candidate does not destroy existing credential', async () => {
  const s = setup(); await s.service.save({ token: SECRET })
  s.setMe(() => Response.json({ err: 'Invalid token ' + SECRET }, { status: 403 }))
  await assert.rejects(s.service.save({ token: 'figd_other_fake' }), { code: 'invalid_or_expired' })
  assert.equal(s.stored().token, SECRET)
})
for (const [name, response, state] of [
  ['generic 403 is permission not expiry', () => Response.json({ err: 'Forbidden' }, { status: 403 }), 'permission_denied'],
  ['401 means invalid or expired', () => Response.json({}, { status: 401 }), 'invalid_or_expired'],
  ['explicit token rejection', () => Response.json({ err: 'Invalid token' }, { status: 403 }), 'invalid_or_expired'],
  ['429 is quota not expiry', () => Response.json({}, { status: 429, headers: { 'Retry-After': '60' } }), 'rate_limited'],
  ['network failures do not expire token', () => { throw new Error('network ' + SECRET) }, 'network_error'],
  ['500 is transient', () => Response.json({}, { status: 500 }), 'network_error'],
]) test(name, async () => {
  const s = setup(); await s.service.save({ token: SECRET }); s.setMe(response)
  const result = await s.service.check(); assert.equal(result.state, state); assert.ok(result.lastValidAt); assert.ok(!JSON.stringify(result).includes(SECRET)); assert.ok(s.stored())
})
test('known expiration is checked without network and deletion removes credential', async () => {
  const s = setup(); await s.service.save({ token: SECRET, expiresAt: '2026-01-02T00:00:00Z' }); const n = s.requests.length
  s.advance(2 * 86400000); assert.equal((await s.service.check()).state, 'expired'); assert.equal(s.requests.length, n)
  assert.equal((await s.service.remove()).configured, false); assert.equal(s.stored(), undefined)
})
test('native scale requests, preflight validity, dimensions and download headers', async () => {
  const s = setup(); await s.service.save({ token: SECRET }); const result = await s.service.export({ url, scales: [2, 3] })
  const renders = s.requests.filter((r) => r.url.includes('/images/'))
  assert.equal(renders.length, 2); assert.equal(new URL(renders[0].url).searchParams.get('scale'), '2'); assert.equal(new URL(renders[1].url).searchParams.get('scale'), '3')
  assert.equal(s.requests.filter((r) => r.url.endsWith('/me')).length, 2)
  assert.equal(result.files[0].width, 200); assert.equal(result.files[0].height, 100)
  assert.equal(result.files[0].warnings.length, 0); assert.equal(result.files[1].warnings.length, 1)
  assert.ok(!JSON.stringify(result).includes('signature')); assert.ok(!JSON.stringify(result).includes(SECRET))
  for (const r of s.requests.filter((r) => r.url.startsWith('https://s3-alpha'))) assert.equal(r.options.headers?.['X-Figma-Token'], undefined)
  assert.ok(s.service.download(result.files[0].id).bytes.equals(png()))
  s.advance(11 * 60000); assert.throws(() => s.service.download(result.files[0].id), { code: 'download_expired' })
})
test('generic file 403 and null render never invalidate saved PAT', async () => {
  const s = setup(); await s.service.save({ token: SECRET }); s.setRender(() => Response.json({ err: 'Forbidden' }, { status: 403 }))
  await assert.rejects(s.service.export({ url, scales: [2] }), { code: 'permission_denied' }); assert.equal((await s.service.status()).state, 'valid')
  s.setRender(() => Response.json({ images: { '12:34': null } }))
  await assert.rejects(s.service.export({ url, scales: [2] }), { code: 'render_failed' })
})
test('rejects unknown download hosts and bad pngs without leaking token', async () => {
  const s = setup(); await s.service.save({ token: SECRET }); s.setRender(() => Response.json({ images: { '12:34': 'https://evil.test/x' } }))
  await assert.rejects(s.service.export({ url, scales: [2] }), { code: 'unsafe_asset_url' })
  assert.ok(!s.requests.some((r) => r.url.includes('evil.test')))
  const api = new FigmaApi({ fetch: async () => new Response('not a png') })
  await assert.rejects(api.download('https://s3-alpha.figma.com/x'), { code: 'invalid_png' })
})
test('bounded and validated inputs reject before requests', async () => {
  const s = setup()
  for (const token of ['', 'x\nHeader:bad', 'x'.repeat(2049)]) await assert.rejects(s.service.save({ token }))
  await assert.rejects(s.service.save({ token: SECRET, expiresAt: 'yesterday' }))
  await s.service.save({ token: SECRET }); const n = s.requests.length
  for (const scales of [[1], [4], [], [2, 2], [2, 3, 3]]) await assert.rejects(s.service.export({ url, scales }))
  assert.equal(s.requests.length, n)
})
