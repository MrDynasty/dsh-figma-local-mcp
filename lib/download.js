import { get } from 'node:https'
import { lookup } from 'node:dns'
import { isIP } from 'node:net'
import { FigmaError } from './errors.js'

function publicAddress(ip) {
  if (isIP(ip) !== 4) return false // IPv6 (including mapped IPv4) fails closed.
  const [a, b, c] = ip.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113))
}

export function downloadHttps(url, { maxBytes = 50 * 1024 * 1024, signal, get: request = get, lookup: resolveDns = lookup } = {}) {
  if (signal?.aborted) return Promise.reject(new FigmaError('disposed', '插件已停用。', 503))
  return new Promise((resolve, reject) => {
    let settled = false, timer, req
    const finish = (error, bytes) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(bytes)
    }
    const failed = () => finish(new FigmaError('asset_download_failed', '图片下载失败或超时，请重新导出。', 502))
    const overflow = () => finish(new FigmaError('cache_limit', '图片超过单文件 50 MB 或批次 100 MB 限额，请减少节点或倍率。', 413))
    const abort = () => { failed(); req?.destroy() }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      req = request(url, { signal, headers: { Accept: 'image/png' }, lookup(host, options, callback) {
        resolveDns(host, { all: true, family: 4 }, (err, addresses) => {
          if (err || !addresses?.length || addresses.some((a) => !publicAddress(a.address))) return callback(new Error('unsafe DNS result'))
          const result = addresses[0]
          if (options.all) callback(null, [result]); else callback(null, result.address, result.family)
        })
      } }, (res) => {
        // Reject redirects; never forward credentials to the binary host.
        if (res.statusCode !== 200) { failed(); res.destroy(); return }
        if (Number(res.headers['content-length']) > maxBytes) { overflow(); res.destroy(); return }
        const chunks = []; let size = 0
        res.on('data', (chunk) => {
          if (settled) return
          size += chunk.length
          if (size > maxBytes) { overflow(); res.destroy() } else chunks.push(chunk)
        })
        res.on('end', () => finish(null, Buffer.concat(chunks)))
        res.on('error', failed); res.on('aborted', failed)
        res.on('close', () => { if (!res.complete) failed() })
      })
      timer = setTimeout(() => { failed(); req.destroy() }, 60000); timer.unref?.()
      req.on('error', failed)
    } catch { failed() }
  })
}
