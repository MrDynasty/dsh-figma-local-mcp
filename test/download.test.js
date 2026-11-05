import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { downloadHttps } from '../lib/download.js'

function network({ address = '8.8.8.8', status = 200, chunks = [], length, aborted = false } = {}) {
  const req = new EventEmitter(); req.destroy = () => { req.emit('close') }
  const res = new EventEmitter(); res.headers = length ? { 'content-length': String(length) } : {}; res.statusCode = status; res.destroy = () => { res.emit('close') }
  let options
  const get = (url, opts, callback) => {
    options = opts
    queueMicrotask(() => opts.lookup(url.hostname, { all: true }, (err) => {
      if (err) { req.emit('error', err); return }
      callback(res)
      if (status !== 200 || length > opts.testLimit) return
      for (const chunk of chunks) res.emit('data', Buffer.from(chunk))
      if (aborted) res.emit('aborted'); else { res.complete = true; res.emit('end') }
      req.emit('close')
    }))
    return req
  }
  return { get, lookup: (_h, _o, cb) => cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]), options: () => options }
}
const asset = new URL('https://s3-alpha.figma.com/test?signature=secret')
test('production transport sends no credentials and accepts bounded public-address response', async () => {
  const net = network({ chunks: ['abc'] })
  assert.equal((await downloadHttps(asset, { ...net, maxBytes: 5 })).toString(), 'abc')
  assert.deepEqual(net.options().headers, { Accept: 'image/png' })
})
test('production DNS fence rejects private, reserved and IPv4-mapped addresses', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::ffff:127.0.0.1']) await assert.rejects(downloadHttps(asset, network({ address })), { code: 'asset_download_failed' })
})
test('production transport rejects redirects, overflow, and aborted response', async () => {
  await assert.rejects(downloadHttps(asset, network({ status: 302 })), { code: 'asset_download_failed' })
  await assert.rejects(downloadHttps(asset, { ...network({ chunks: ['123', '456'] }), maxBytes: 5 }), { code: 'cache_limit' })
  await assert.rejects(downloadHttps(asset, network({ chunks: ['partial'], aborted: true })), { code: 'asset_download_failed' })
})
test('disposed transport fails without starting another request', async () => {
  const controller = new AbortController(); controller.abort(); let requests = 0
  await assert.rejects(downloadHttps(asset, { signal: controller.signal, get: () => { requests++ } }), { code: 'disposed' })
  assert.equal(requests, 0)
})
