(() => {
  'use strict'
  const byId = (id) => document.getElementById(id)
  const labels = {
    missing: '未配置', valid: '有效', expiring: '即将到期', expired: '已到期',
    invalid_or_expired: '无效或已到期', permission_denied: '权限不足',
    network_error: '网络异常', rate_limited: '请求受限', unknown: '状态未知',
  }
  let csrfToken = null
  let configured = false
  let statusKnown = false
  let tokenRequired = false
  let editorOpen = false
  let busy = false
  let refreshing = null
  let poll = null
  let pageActive = true

  // API fields are always plain text, bounded and stripped of control characters.
  const safeText = (value, fallback = '') => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 600).trim() || fallback
    : fallback

  function notify(message, tone = 'info') {
    const notice = byId('notice')
    notice.textContent = safeText(message, '请求未完成，请重试。')
    notice.dataset.tone = tone
    notice.hidden = false
  }

  function clearEditor() {
    byId('token').value = ''
    byId('expires-at').value = ''
  }

  function syncControls() {
    const expanded = statusKnown && (tokenRequired || editorOpen)
    byId('token-editor').hidden = !expanded
    byId('add-token-button').hidden = !statusKnown || tokenRequired || editorOpen
    byId('add-token-button').textContent = '增加令牌'
    byId('add-token-button').disabled = busy
    byId('add-token-button').setAttribute('aria-expanded', String(expanded))
    byId('cancel-token-button').hidden = tokenRequired
    byId('cancel-token-button').disabled = busy
    byId('save-button').disabled = busy
    byId('token').disabled = busy
    byId('expires-at').disabled = busy
    for (const id of ['check-button', 'remove-button', 'export-button', 'export-fields']) {
      byId(id).disabled = busy || !configured
    }
    byId('export-availability').hidden = configured
    byId('token-form').setAttribute('aria-busy', String(busy))
    byId('export-form').setAttribute('aria-busy', String(busy))
  }

  async function api(path, method = 'GET', body) {
    const options = { method, credentials: 'same-origin', cache: 'no-store' }
    if (method !== 'GET') {
      options.headers = { 'Content-Type': 'application/json', 'X-DSH-Figma': '1', ...(csrfToken ? { 'X-DSH-Figma-CSRF': csrfToken } : {}) }
      options.body = JSON.stringify(body ?? {})
    }
    let response
    try { response = await fetch(`/dsh-figma/${path}`, options) }
    catch { throw new Error('无法连接本地服务，请检查连接后重试。') }
    if (response.ok && response.status === 204) return null
    let data
    try { data = await response.json() }
    catch { throw new Error('服务返回了无法识别的响应，请重试。') }
    if (!response.ok) throw new Error(safeText(data?.error?.message, '请求失败，请稍后重试。'))
    if (path === 'status' && typeof data?.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.csrfToken)) csrfToken = data.csrfToken
    return data
  }

  function dateLabel(value) {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
  }

  function renderStatus(data) {
    if (!data || typeof data.configured !== 'boolean') throw new Error('连接状态响应无效，请重试。')
    configured = data.configured
    statusKnown = true
    const state = Object.hasOwn(labels, data.state) ? data.state : 'unknown'
    // Permission, network and quota errors do not prove a saved token expired.
    tokenRequired = !configured || state === 'expired' || state === 'invalid_or_expired'
    byId('status-label').textContent = labels[state]
    byId('status-label').dataset.state = state
    byId('status-message').textContent = safeText(data.message, configured ? '令牌已配置，等待检查。' : '请先配置 Figma 访问令牌。')
    byId('checked-at').textContent = dateLabel(data.checkedAt)
    byId('last-valid-at').textContent = dateLabel(data.lastValidAt)
    byId('expiry-value').textContent = data.expirySource === 'user' && data.expiresAt
      ? `${dateLabel(data.expiresAt)}（用户提供）` : '未知 · Figma 不提供精确到期时间'
    syncControls()
  }

  async function refreshStatus() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      try { renderStatus(await api('status')) }
      catch (error) {
        // A failed status read is not evidence that the stored credential vanished.
        // Preserve the last known configuration and the user's open-editor intent.
        byId('status-label').textContent = labels.unknown
        byId('status-label').dataset.state = 'unknown'
        byId('status-message').textContent = '暂时无法读取状态。配置与导出结果未被修改。'
        if (!busy) notify(error.message, 'error')
        syncControls()
      }
    })()
    try { await refreshing } finally { refreshing = null }
  }

  async function mutate(work, message) {
    if (busy) return
    busy = true
    syncControls()
    notify(message)
    try {
      // Finish any older status read before the mutation, preventing stale state.
      if (refreshing) await refreshing
      await work()
    } catch (error) { notify(error.message, 'error') }
    finally {
      byId('token').value = ''
      await refreshStatus()
      busy = false
      syncControls()
    }
  }

  byId('add-token-button').addEventListener('click', () => {
    if (busy || !statusKnown) return
    editorOpen = true
    syncControls()
    byId('token').focus()
  })

  byId('cancel-token-button').addEventListener('click', () => {
    if (busy) return
    clearEditor()
    editorOpen = false
    syncControls()
    if (!tokenRequired) byId('add-token-button').focus()
  })

  byId('token-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    try {
      if (!byId('token').value.trim()) throw new Error('请粘贴个人访问令牌。')
      const body = { token: byId('token').value.trim() }
      const expiry = byId('expires-at').value
      if (expiry) {
        const date = new Date(expiry)
        if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error('请选择未来的到期时间。')
        body.expiresAt = date.toISOString()
      }
      // Clear immediately, including while the network request is in flight.
      byId('token').value = ''
      await mutate(async () => {
        const saved = await api('token', 'PUT', body)
        // The committed save response is newer than the prior configuration;
        // retain it even if the subsequent status refresh cannot connect.
        if (typeof saved?.configured === 'boolean') renderStatus(saved)
        editorOpen = false
        clearEditor()
        notify('令牌验证通过，已保存。', 'success')
      }, '正在验证令牌，通过后才会保存…')
    } catch (error) { notify(error.message, 'error') }
    finally { byId('token').value = '' }
  })

  byId('check-button').addEventListener('click', async () => {
    if (!configured || busy) return
    await mutate(async () => {
      await api('check', 'POST', {})
      notify('检查完成，请查看上方连接状态。', 'success')
    }, '正在检查令牌…')
  })

  byId('remove-button').addEventListener('click', async () => {
    if (!configured || busy || !window.confirm('确认移除已保存的 Figma 令牌？移除后将无法导出资源。')) return
    await mutate(async () => {
      await api('token', 'DELETE', {})
      notify('已移除保存的令牌。', 'success')
    }, '正在移除令牌…')
  })

  function figmaNodeUrl(value) {
    let url
    try { url = new URL(value) } catch { throw new Error('请输入有效的 Figma 节点链接。') }
    if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)
      || url.username || url.password || url.port
      || !/^\/(?:file|design)\/[A-Za-z0-9]+(?:\/|$)/.test(url.pathname)
      || !/^\d+[:-]\d+$/.test(url.searchParams.get('node-id') || '')) {
      throw new Error('请使用包含 node-id 的 Figma 文件或分支链接。')
    }
    return url.href
  }

  function downloadHref(value) {
    if (typeof value !== 'string' || !value.startsWith('/dsh-figma/download?')) return null
    try {
      const url = new URL(value, window.location.origin)
      const id = url.searchParams.get('id')
      if (url.origin !== window.location.origin || url.pathname !== '/dsh-figma/download' || url.hash
        || !id || [...url.searchParams.keys()].length !== 1) return null
      return `/dsh-figma/download?id=${encodeURIComponent(id)}`
    } catch { return null }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = safeText(text)
    if (className) node.className = className
    return node
  }

  function renderFiles(files) {
    if (!Array.isArray(files)) throw new Error('导出结果响应无效，请重试。')
    const results = byId('export-results')
    results.replaceChildren()
    if (!files.length) results.append(element('p', '未返回导出文件，请检查节点与访问权限。', 'empty-state'))
    for (const file of files) {
      const row = element('article', undefined, 'result-file')
      const filename = safeText(file?.filename, '导出文件.png')
      const href = downloadHref(file?.downloadUrl)
      if (href) {
        const link = element('a', filename)
        link.href = href
        link.download = filename
        row.append(link)
      } else {
        row.append(element('p', filename), element('p', '下载地址无效，已阻止此链接。请重新导出。', 'result-warning'))
      }
      const dimensions = Number.isSafeInteger(file?.width) && file.width > 0 && Number.isSafeInteger(file?.height) && file.height > 0
        ? `${file.width} × ${file.height} px` : '像素尺寸未知'
      row.append(element('p', dimensions, 'result-dimensions'))
      if (Array.isArray(file?.warnings)) for (const warning of file.warnings) {
        if (typeof warning === 'string') row.append(element('p', warning, 'result-warning'))
      }
      results.append(row)
    }
  }

  byId('export-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || !configured) return
    try {
      const url = figmaNodeUrl(byId('figma-url').value.trim())
      const scales = [2, 3].filter((scale) => byId(`scale-${scale}`).checked)
      if (!scales.length) throw new Error('请至少选择一个导出倍率。')
      await mutate(async () => {
        const data = await api('export', 'POST', { url, scales })
        renderFiles(data?.files)
        notify(data.files.length ? `导出完成，共 ${data.files.length} 个文件。请核对实际像素尺寸与提示。` : '导出完成，但未返回文件。', data.files.length ? 'success' : 'info')
      }, '正在导出 PNG，请稍候…')
    } catch (error) { notify(error.message, 'error') }
  })

  function updatePolling() {
    if (poll !== null) { clearInterval(poll); poll = null }
    if (!pageActive || document.visibilityState !== 'visible') return
    if (!busy) void refreshStatus()
    poll = setInterval(() => {
      if (pageActive && document.visibilityState === 'visible' && !busy) void refreshStatus()
    }, 60_000)
  }
  document.addEventListener('visibilitychange', updatePolling)
  window.addEventListener('pagehide', () => {
    pageActive = false
    clearEditor()
    if (poll !== null) { clearInterval(poll); poll = null }
  })
  window.addEventListener('pageshow', () => { pageActive = true; updatePolling() })
  syncControls()
  updatePolling()
})()
