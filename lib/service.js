import { randomUUID } from 'node:crypto'
import { FigmaError } from './errors.js'
import { parseTarget } from './figma-api.js'

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DOWNLOAD_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_BYTES = 100 * 1024 * 1024
const MESSAGES = {
  missing: '尚未配置 Token。', valid: '最近一次验证通过。', expiring: 'Token 将在 7 天内到期，请提前更换。',
  expired: '已到填写的到期时间，请更换 Token。', unknown: '尚未验证；到期时间未知，请检查 Token。',
}

export function createService({ store, api, now = Date.now }) {
  let queue = Promise.resolve()
  let state = 'unknown', message = MESSAGES.unknown, checkedAt = null, lastValidAt = null
  let stopped = false
  const artifacts = new Map()
  const assertLive = () => { if (stopped) throw new FigmaError('disposed', '插件已停用。', 503) }
  const active = (signal) => { assertLive(); if (signal?.aborted) throw new FigmaError('cancelled', '导出已取消。', 499) }
  const live = async (promise, signal) => { try { return await promise } finally { active(signal) } }
  function serial(fn) {
    const task = queue.then(() => { assertLive(); return fn() })
    queue = task.catch(() => {})
    return task
  }
  const isoNow = () => new Date(now()).toISOString()
  function purge() {
    for (const [id, file] of artifacts) if (file.expires <= now()) artifacts.delete(id)
  }
  function snapshot(record) {
    let effective = state
    if (!record) effective = 'missing'
    else if (record.expiresAt && Date.parse(record.expiresAt) <= now()) effective = 'expired'
    else if (state === 'valid' && record.expiresAt && Date.parse(record.expiresAt) - now() <= 7 * 86400000) effective = 'expiring'
    return {
      configured: Boolean(record), state: effective, checkedAt, lastValidAt: lastValidAt ?? record?.lastValidAt ?? null,
      expiresAt: record?.expiresAt ?? null, expirySource: record?.expiresAt ? 'user' : 'unknown',
      message: MESSAGES[effective] ?? message, checkIntervalMinutes: CHECK_INTERVAL_MS / 60000,
    }
  }
  async function checkRecord(record, signal) {
    active(signal)
    checkedAt = isoNow()
    if (!record) return snapshot(record)
    if (record.expiresAt && Date.parse(record.expiresAt) <= now()) { state = 'expired'; return snapshot(record) }
    try {
      await live(api.verify(record.token, signal), signal)
      state = 'valid'; lastValidAt = isoNow(); message = MESSAGES.valid
    } catch (error) {
      active(signal)
      state = error instanceof FigmaError ? error.code : 'network_error'
      message = error instanceof FigmaError ? error.message : '验证暂时失败，未判定 Token 过期。'
    }
    return snapshot(record)
  }
  function validateSave({ token, expiresAt } = {}) {
    if (typeof token !== 'string' || !/^[\x21-\x7E]{1,2048}$/.test(token)) throw new FigmaError('invalid_token', '请输入 Token，不得包含空格、换行或超过 2048 字符。')
    if (expiresAt != null && expiresAt !== '') {
      if (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))) throw new FigmaError('invalid_expiry', '到期时间格式无效。')
      if (Date.parse(expiresAt) <= now()) throw new FigmaError('expired', '填写的到期时间已过，请使用新的 Token。')
      expiresAt = new Date(expiresAt).toISOString()
    } else expiresAt = null
    return { token, expiresAt }
  }
  return {
    status: () => serial(async () => { purge(); return snapshot(await live(store.read())) }),
    check: () => serial(async () => checkRecord(await live(store.read()))),
    save: (input) => serial(async () => {
      const record = validateSave(input)
      await live(api.verify(record.token)) // Validate candidate before replacing a working credential.
      record.lastValidAt = isoNow()
      await live(store.write(record, assertLive))
      state = 'valid'; message = MESSAGES.valid; checkedAt = record.lastValidAt; lastValidAt = record.lastValidAt
      artifacts.clear() // Do not retain downloads from an earlier credential.
      return snapshot(record)
    }),
    remove: () => serial(async () => {
      await live(store.remove()); artifacts.clear(); state = 'missing'; checkedAt = null; lastValidAt = null
      return snapshot(null)
    }),
    export: (input = {}, { signal } = {}) => serial(async () => {
      active(signal)
      const { url, scales = [2, 3] } = input
      const { key, ids } = parseTarget(url)
      if (!Array.isArray(scales) || !scales.length || scales.length > 2 || new Set(scales).size !== scales.length || scales.some((s) => s !== 2 && s !== 3)) throw new FigmaError('invalid_scale', '仅支持 2x、3x，且倍率不得重复。')
      const record = await live(store.read(), signal)
      if (!record) throw new FigmaError('missing', MESSAGES.missing, 409)
      const status = await checkRecord(record, signal)
      if (!['valid', 'expiring'].includes(status.state)) throw new FigmaError(status.state, status.message, 409)
      const staged = []; let size = 0
      try {
        const nodes = await live(api.nodes(key, ids, record.token, signal), signal)
        for (const id of ids) {
          const node = nodes?.[id]?.document
          const bounds = node?.absoluteRenderBounds ?? node?.absoluteBoundingBox
          if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) throw new FigmaError('render_failed', '节点不存在、不可见或无法取得尺寸；请检查 node-id。', 422)
          if (scales.some((scale) => Math.ceil(bounds.width * scale) * Math.ceil(bounds.height * scale) > 32000000)) throw new FigmaError('image_too_large', '所选倍率超过 Figma 3200 万像素上限；为避免静默降采样，请缩小导出节点。', 422)
        }
        for (const scale of scales) {
          const images = await live(api.render(key, ids, scale, record.token, signal), signal)
          for (const nodeId of ids) {
            if (!images?.[nodeId]) throw new FigmaError('render_failed', `节点 ${nodeId} 在 ${scale}x 下渲染失败；没有将空结果当作成功。`, 422)
            if (size >= MAX_CACHE_BYTES) throw new FigmaError('cache_limit', '批次图片超过 100 MB，请减少节点或倍率后重试。', 413)
            const image = await live(api.download(images[nodeId], MAX_CACHE_BYTES - size, signal), signal)
            size += image.bytes.length
            if (size > MAX_CACHE_BYTES) throw new FigmaError('cache_limit', '批次图片超过 100 MB，请减少节点或倍率后重试。', 413)
            const bounds = nodes[nodeId].document.absoluteRenderBounds ?? nodes[nodeId].document.absoluteBoundingBox
            const warnings = []
            if (Math.abs(image.width - Math.ceil(bounds.width * scale)) > 1 || Math.abs(image.height - Math.ceil(bounds.height * scale)) > 1) warnings.push('实际像素与节点预期倍率不一致（可能受裁剪、效果或 Figma 限制影响）；未放大补偿，请核对。')
            const id = randomUUID()
            staged.push({ id, filename: `figma-${nodeId.replace(':', '-') }@${scale}x.png`, width: image.width, height: image.height, warnings, bytes: image.bytes, expires: now() + DOWNLOAD_TTL_MS })
          }
        }
      } catch (error) {
        // Only explicit credential rejection from the API invalidates account health.
        // Signed image URL failures, file ACLs and render errors are NOT PAT expiry.
        if (error instanceof FigmaError && error.code === 'invalid_or_expired') { state = error.code; message = error.message }
        throw error
      }
      purge()
      active(signal)
      let total = [...artifacts.values()].reduce((n, f) => n + f.bytes.length, 0)
      while (total + size > MAX_CACHE_BYTES && artifacts.size) { const id = artifacts.keys().next().value; total -= artifacts.get(id).bytes.length; artifacts.delete(id) }
      for (const file of staged) artifacts.set(file.id, file)
      return { files: staged.map(({ bytes, expires, ...file }) => ({ ...file, downloadUrl: `/dsh-figma/download?id=${file.id}` })) }
    }),
    download(id) {
      purge()
      const file = artifacts.get(id)
      if (!file || stopped) throw new FigmaError('download_expired', '下载已过期或不存在，请重新导出（下载保留 10 分钟）。', 404)
      return file
    },
    dispose() { stopped = true; artifacts.clear(); api.dispose?.() },
  }
}
