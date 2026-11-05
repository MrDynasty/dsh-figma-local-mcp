import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createHandler } from '../lib/http.js'

function harness(connection = { requestRejection: () => undefined }) {
  let mutations = 0
  const service = { status: async () => ({ configured: false, state: 'missing' }), save: async () => { mutations++; return { configured: true } }, check: async () => { mutations++; return { state: 'valid' } }, remove: async () => { mutations++; return {} }, export: async () => { mutations++; return { files: [] } }, download: () => ({ filename: 'figma-1-2@2x.png', bytes: Buffer.from('png') }) }
  const handler = createHandler({ service, connection, protocol: 'http:' })
  return { mutations: () => mutations, async request(path, { method = 'GET', headers = {}, body = '' } = {}) {
    const req = Readable.from(body ? [Buffer.from(body)] : [])
    Object.assign(req, { url: path, method, headers: { host: '127.0.0.1:61058', ...headers }, socket: { remoteAddress: '127.0.0.1', localPort: 61058 } })
    const res = { status: null, headers: {}, data: null, writeHead(status, headers) { this.status = status; this.headers = headers }, end(data = '') { this.data = data } }
    await handler(req, res); return res
  } }
}
const mutation = { method: 'PUT', headers: { origin: 'http://127.0.0.1:61058', 'content-type': 'application/json', 'x-dsh-figma': '1' }, body: '{"token":"fake"}' }

test('all routes require host authentication; missing/throwing guard fails closed', async () => {
  for (const connection of [{}, { requestRejection: () => 401 }, { requestRejection: () => { throw Error('private-secret') } }]) {
    const h = harness(connection); const r = await h.request('/dsh-figma/status'); assert.ok([401, 403].includes(r.status)); assert.ok(!String(r.data).includes('private-secret'))
  }
})
test('rejects DNS rebinding and cross-origin including null and fetch-site markers', async () => {
  for (const headers of [{ host: 'evil.test:61058' }, { origin: 'https://evil.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const h = harness(); const r = await h.request('/dsh-figma/token', { ...mutation, headers: { ...mutation.headers, ...headers } }); assert.equal(r.status, 403); assert.equal(h.mutations(), 0)
  }
})
test('mutations require explicit same-origin, custom header and json', async () => {
  for (const headers of [{}, { origin: 'http://127.0.0.1:61058' }, { origin: 'http://127.0.0.1:61058', 'x-dsh-figma': '1', 'content-type': 'text/plain' }]) {
    const h = harness(); assert.ok((await h.request('/dsh-figma/token', { ...mutation, headers })).status >= 400); assert.equal(h.mutations(), 0)
  }
  const h = harness(); assert.equal((await h.request('/dsh-figma/token', mutation)).status, 200); assert.equal(h.mutations(), 1)
})
test('GET is read-only, methods and oversized json are rejected', async () => {
  const h = harness(); assert.equal((await h.request('/dsh-figma/status')).status, 200)
  assert.equal((await h.request('/dsh-figma/token')).status, 405)
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, body: 'x'.repeat(9000) })).status, 413)
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, body: '{oops' })).status, 400)
  assert.equal(h.mutations(), 0)
})
test('responses disable caching and sniffing; HTML has restrictive CSP', async () => {
  const h = harness(); const r = await h.request('/dsh-figma/status')
  assert.equal(r.headers['Cache-Control'], 'no-store'); assert.equal(r.headers['X-Content-Type-Options'], 'nosniff')
  const html = await h.request('/dsh-figma'); assert.equal(html.status, 200); assert.ok(html.headers['Content-Security-Policy'].includes("frame-ancestors 'self'"))
})
test('Desktop origin-stripping bridge needs an authenticated CSRF challenge for mutations', async () => {
  const h = harness()
  const status = await h.request('/dsh-figma/status')
  const csrf = JSON.parse(status.data).csrfToken
  assert.match(csrf ?? '', /^[A-Za-z0-9_-]{43}$/)
  const headers = { 'content-type': 'application/json', 'x-dsh-figma': '1' }
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, headers })).status, 403)
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, headers: { ...headers, 'x-dsh-figma-csrf': 'wrong' } })).status, 403)
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, headers: { ...headers, 'x-dsh-figma-csrf': csrf } })).status, 200)
  assert.equal((await h.request('/dsh-figma/token', { ...mutation, headers: { ...headers, origin: 'null', 'x-dsh-figma-csrf': csrf } })).status, 403)
  assert.equal(h.mutations(), 1)
  const denied = harness({ requestRejection: () => 401 })
  assert.equal((await denied.request('/dsh-figma/token', { ...mutation, headers: { ...headers, 'x-dsh-figma-csrf': csrf } })).status, 401)
})

test('download is attachment and never accepts an arbitrary URL', async () => {
  const h = harness(); const r = await h.request('/dsh-figma/download?id=abc')
  assert.equal(r.status, 200); assert.ok(r.headers['Content-Disposition'].startsWith('attachment;'))
  assert.equal((await h.request('/dsh-figma/download?url=https://evil.test')).status, 400)
})
