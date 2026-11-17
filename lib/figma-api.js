import { downloadHttps } from './download.js'
import { FigmaError } from './errors.js'

const API = 'https://api.figma.com/v1'
const MAX_BYTES = 50 * 1024 * 1024
// Conservative observed hosts, not an exhaustive Figma contract. Unknown hosts fail closed.
const ASSET_HOSTS = new Set(['s3-alpha.figma.com', 'figma-alpha-api.s3.us-west-2.amazonaws.com', 'figma-alpha-api.s3-us-west-2.amazonaws.com'])
const fail = (code, message, status = 400) => { throw new FigmaError(code, message, status) }

export function parseTarget(input) {
  let url
  try { url = new URL(input) } catch { fail('invalid_target', '请输入包含 node-id 的 Figma 文件链接。') }
  if (typeof input !== 'string' || input.length > 4096 || url.protocol !== 'https:' || !['www.figma.com', 'figma.com'].includes(url.hostname) || url.username || url.password || url.port) fail('invalid_target', '仅支持 HTTPS 的 figma.com 文件链接。')
  const parts = url.pathname.split('/').filter(Boolean)
  const key = parts[2] === 'branch' ? parts[3] : parts[1]
  if (!['design', 'file', 'board', 'slides'].includes(parts[0]) || !/^[a-zA-Z0-9]{1,128}$/.test(key ?? '')) fail('invalid_target', '无法识别 Figma 文件或分支。')
  const raw = url.searchParams.get('node-id') ?? ''
  const ids = [...new Set(raw.split(',').map((id) => id.replace(/^(\d+)-(\d+)$/, '$1:$2')))]
  if (!ids.length || ids.length > 10 || ids.some((id) => !/^\d+:\d+$/.test(id))) fail('invalid_target', '链接需包含有效 node-id；单次最多导出 10 个节点。')
  return { key, ids }
}

export function safeAssetUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('unsafe_asset_url', 'Figma 返回了无效的图片地址。', 502) }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !ASSET_HOSTS.has(url.hostname)) fail('unsafe_asset_url', '图片域名不在安全允许列表中；未下载，请联系插件维护者。', 502)
  return url.href
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) fail('response_too_large', 'Figma 响应超过安全大小限制。', 502)
  const chunks = []; let size = 0
  if (!response.body) fail('invalid_response', 'Figma 返回了空响应。', 502)
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) { await response.body.cancel().catch(() => {}); fail('response_too_large', 'Figma 响应超过安全大小限制。', 502) }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export function pngSize(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('invalid_png', 'Figma 返回的图片不是有效 PNG。', 502)
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 32000000) fail('invalid_png', 'PNG 尺寸无效或超过 3200 万像素。', 502)
  return { width, height }
}

/** Verify the bytes really match the requested format; vector output has no fixed pixel size. */
export function assertAsset(bytes, format = 'png') {
  if (format === 'png') return pngSize(bytes)
  if (format === 'pdf') {
    if (bytes.length < 8 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail('invalid_asset', 'Figma 返回的内容不是有效 PDF。', 502)
    return { width: null, height: null }
  }
  if (!/<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'))) fail('invalid_asset', 'Figma 返回的内容不是有效 SVG。', 502)
  return { width: null, height: null }
}

export class FigmaApi {
  constructor({ fetch: fetcher, now = Date.now } = {}) {
    this.fetch = fetcher ?? globalThis.fetch; this.now = now; this.blockedUntil = 0
    this.controller = new AbortController()
    this.downloadBytes = fetcher ? async (url, options) => {
      const response = await fetcher(url, { redirect: 'error', signal: options.signal })
      if (!response.ok) fail('asset_download_failed', '图片下载失败，请重新导出。', 502)
      return boundedBody(response, options.maxBytes)
    } : downloadHttps
  }

  scope(signal) {
    if (this.controller.signal.aborted) fail('disposed', '插件已停用。', 503)
    if (signal?.aborted) fail('cancelled', '导出已取消。', 499)
    const controller = new AbortController()
    const abort = () => controller.abort()
    this.controller.signal.addEventListener('abort', abort, { once: true })
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 60000); timer.unref?.()
    return { signal: controller.signal, close: () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort) } }
  }

  dispose() { this.controller.abort() }

  async json(path, token, signal) {
    const scope = this.scope(signal)
    try {
      if (this.blockedUntil > this.now()) fail('rate_limited', `Figma 请求额度受限，请至少 ${Math.ceil((this.blockedUntil - this.now()) / 1000)} 秒后重试。`, 429)
      const response = await this.fetch(API + path, { headers: { 'X-Figma-Token': token, Accept: 'application/json' }, redirect: 'error', signal: scope.signal })
      let body = {}
      const bytes = await boundedBody(response, 2 * 1024 * 1024)
      try { body = JSON.parse(bytes.toString('utf8')) } catch { if (response.ok) fail('invalid_response', 'Figma 返回了无法解析的响应。', 502) }
      if (response.status === 401 || (response.status === 403 && /(?:invalid|expired|revoked)\s+(?:access\s+)?token|token\s+(?:is\s+)?(?:invalid|expired|revoked)/i.test(String(body?.err ?? body?.message ?? '')))) fail('invalid_or_expired', 'Token 已失效或过期，请重新生成并配置。', 401)
      if (response.status === 403) fail('permission_denied', '权限不足：请检查 Token scopes、文件分享权限或组织策略；不代表 Token 过期。', 403)
      if (response.status === 429) {
        const retry = response.headers.get('retry-after')
        const seconds = /^\d+(?:\.\d+)?$/.test(retry ?? '') ? Number(retry) : (Date.parse(retry) - this.now()) / 1000
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 60
        this.blockedUntil = this.now() + wait * 1000
        fail('rate_limited', `Figma 请求额度受限，请至少 ${Math.ceil(wait)} 秒后重试。`, 429)
      }
      if (response.status === 404) fail('not_found', 'Figma 文件或节点不存在，或当前账号无法访问。', 404)
      if (response.status >= 500) fail('network_error', 'Figma 服务暂时不可用，未判定 Token 过期。', 502)
      if (!response.ok) fail('figma_request_failed', 'Figma 请求失败，请检查链接、节点和导出设置。', 400)
      return body
    } catch (error) {
      if (signal?.aborted) fail('cancelled', '导出已取消。', 499)
      if (error instanceof FigmaError) throw error
      fail('network_error', '无法连接 Figma，未判定 Token 过期。', 502)
    } finally { scope.close() }
  }

  async verify(token, signal) {
    const body = await this.json('/me', token, signal)
    if (typeof body.id !== 'string' || !body.id) fail('invalid_response', 'Figma 未返回有效的账号验证结果。', 502)
  }

  async nodes(key, ids, token, signal) {
    return (await this.json(`/files/${key}/nodes?ids=${encodeURIComponent(ids.join(','))}`, token, signal)).nodes
  }

  async render(key, ids, { scale, format = 'png' } = {}, token, signal) {
    const query = new URLSearchParams({ ids: ids.join(','), format, contents_only: 'true' })
    if (format === 'png' && scale) query.set('scale', String(scale))
    const body = await this.json(`/images/${key}?${query}`, token, signal)
    return body.images
  }

  async download(url, budget = MAX_BYTES, signal, format = 'png') {
    const scope = this.scope(signal)
    try {
      const bytes = await this.downloadBytes(safeAssetUrl(url), { maxBytes: Math.min(MAX_BYTES, budget), signal: scope.signal })
      return { bytes, ...assertAsset(bytes, format) }
    } catch (error) {
      if (signal?.aborted) fail('cancelled', '导出已取消。', 499)
      if (error instanceof FigmaError) throw error
      fail('asset_download_failed', '图片下载失败或超时，请重新导出。', 502)
    } finally { scope.close() }
  }
}
