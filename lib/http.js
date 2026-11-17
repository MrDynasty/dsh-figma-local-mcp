import { readFile } from 'node:fs/promises'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { FigmaError, publicError } from './errors.js'

const ROOT = '/dsh-figma'
const ASSETS = new Map([
  [ROOT, ['panel.html', 'text/html; charset=utf-8']],
  [ROOT + '/', ['panel.html', 'text/html; charset=utf-8']],
  [ROOT + '/panel.js', ['panel.js', 'text/javascript; charset=utf-8']],
  [ROOT + '/panel.css', ['panel.css', 'text/css; charset=utf-8']],
])
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
const fail = (code, message, status) => { throw new FigmaError(code, message, status) }

function admit(req, connection, protocol, csrfToken) {
  let url
  const host = req.headers.host
  try { url = new URL(`${protocol}//${host}`) } catch { fail('forbidden', '请求来源不被允许。', 403) }
  if (typeof host !== 'string' || url.host !== host || url.username || url.password || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('forbidden', '此面板仅允许本机访问。', 403)
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) fail('forbidden', '此面板仅允许本机访问。', 403)
  if (req.socket.localPort && Number(url.port || (protocol === 'https:' ? 443 : 80)) !== req.socket.localPort) fail('forbidden', '请求端口不匹配。', 403)
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) fail('forbidden', '不允许跨来源请求。', 403)
  if (req.headers.origin !== undefined && req.headers.origin !== url.origin) fail('forbidden', '不允许跨来源请求。', 403)
  let rejection
  try {
    if (typeof connection?.requestRejection !== 'function') fail('forbidden', '宿主身份验证不可用。', 403)
    rejection = connection.requestRejection(req)
  } catch { fail('forbidden', '宿主身份验证未通过。', 403) }
  if (rejection != null && rejection !== false) fail('unauthorized', '请先在当前 DSH 中登录，再打开配置面板。', rejection === 401 ? 401 : 403)
  if (!['GET', 'HEAD'].includes(req.method)) {
    // Desktop's owned dsh-app:// bridge strips Origin and authenticates with
    // its private Host cookie. Require a challenge obtained by authenticated
    // same-origin GET; never accept a missing Origin solely because it is local.
    const nonce = req.headers['x-dsh-figma-csrf']
    const challenged = typeof nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(nonce) && timingSafeEqual(Buffer.from(nonce), Buffer.from(csrfToken))
    if ((req.headers.origin === undefined ? !challenged : req.headers.origin !== url.origin) || req.headers['x-dsh-figma'] !== '1') fail('forbidden', '配置操作需要同来源面板请求。', 403)
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) fail('invalid_content_type', '仅接受 JSON 请求。', 415)
  }
}

async function jsonBody(req) {
  if (Number(req.headers['content-length']) > 8192) fail('body_too_large', '请求超过大小限制。', 413)
  let bytes = 0; const chunks = []
  const consume = async () => {
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 8192) fail('body_too_large', '请求超过大小限制。', 413)
      chunks.push(Buffer.from(chunk))
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { fail('invalid_json', 'JSON 格式错误。', 400) }
    if (!body || Array.isArray(body) || typeof body !== 'object') fail('invalid_json', '需要 JSON 对象。', 400)
    return body
  }
  let timer
  try {
    return await Promise.race([consume(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new FigmaError('request_timeout', '请求超时。', 408)), 10000)
      timer.unref?.()
    })])
  } finally { clearTimeout(timer) }
}

export function createHandler({ service, connection, protocol = 'http:' }) {
  const csrfToken = randomBytes(32).toString('base64url')
  return async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers })
      res.end(body)
    }
    const json = (status, value) => send(status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' })
    try {
      admit(req, connection, protocol, csrfToken)
      const url = new URL(req.url, `${protocol}//${req.headers.host}`)
      const path = url.pathname
      if (ASSETS.has(path)) {
        if (req.method !== 'GET') fail('method_not_allowed', '方法不被允许。', 405)
        const [name, type] = ASSETS.get(path)
        send(200, await readFile(new URL(name, import.meta.url)), { 'Content-Type': type, 'Content-Security-Policy': CSP })
        return
      }
      if (path === ROOT + '/status' && req.method === 'GET') return json(200, { ...await service.status(), csrfToken })
      if (path === ROOT + '/token' && req.method === 'PUT') return json(200, await service.save(await jsonBody(req), { actor: 'panel' }))
      if (path === ROOT + '/token' && req.method === 'DELETE') { await jsonBody(req); return json(200, await service.remove({ actor: 'panel' })) }
      if (path === ROOT + '/check' && req.method === 'POST') { await jsonBody(req); return json(200, await service.check({ actor: 'panel' })) }
      if (path === ROOT + '/export' && req.method === 'POST') return json(200, await service.export(await jsonBody(req), { actor: 'panel' }))
      if (path === ROOT + '/download' && req.method === 'GET') {
        const id = url.searchParams.get('id')
        if (!id || id.length > 100 || url.searchParams.size !== 1) fail('invalid_download', '下载参数无效。', 400)
        const file = service.download(id)
        const filename = file.filename.replace(/[^a-zA-Z0-9@_.-]/g, '_')
        return send(200, file.bytes, { 'Content-Type': file.contentType ?? 'image/png', 'Content-Length': String(file.bytes.length), 'Content-Disposition': `attachment; filename="${filename}"` })
      }
      if (['/status', '/token', '/check', '/export', '/download'].some((p) => path === ROOT + p)) fail('method_not_allowed', '方法不被允许。', 405)
      fail('not_found', '页面不存在。', 404)
    } catch (error) {
      const safe = publicError(error)
      json(safe.status, { error: { code: safe.code, message: safe.message } })
    }
  }
}
