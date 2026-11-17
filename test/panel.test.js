import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const load = (name) => readFile(new URL(name, root), 'utf8')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const status = (configured = true, state = 'valid') => ({ configured, state, checkedAt: '2026-11-01T00:00:00Z', lastValidAt: null, expiresAt: null, expirySource: 'unknown', message: '连接正常', checkIntervalMinutes: 360 })

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.value = ''; this.textContent = ''; this.disabled = false
    this.checked = true; this.hidden = false; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}
  }
  addEventListener(name, fn) { this.listeners[name] = fn }
  setAttribute(name, value) { this.attributes[name] = value }
  removeAttribute(name) { delete this.attributes[name] }
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this.children = nodes }
  focus() { this.focused = true }
  async fire(name) { return this.listeners[name]?.({ preventDefault() {} }) }
}

async function boot(responder = () => ({ body: status() })) {
  const source = await load('lib/panel.js')
  const nodes = new Map()
  const doc = new Element(); doc.visibilityState = 'visible'; doc.hidden = false
  doc.getElementById = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id) }
  doc.createElement = (tag) => new Element(tag)
  const win = new Element(); win.location = { origin: 'http://localhost:61058' }; win.confirm = () => true
  const calls = []; const intervals = new Map(); let nextId = 0
  const context = {
    document: doc, window: win, location: win.location, URL, Date, console,
    setInterval(fn, delay) { const id = ++nextId; intervals.set(id, { fn, delay }); return id },
    clearInterval(id) { intervals.delete(id) },
    async fetch(url, options = {}) {
      calls.push({ url, ...options })
      const result = await responder(url, options)
      return { ok: result.ok ?? true, status: result.status ?? 200, json: async () => {
        if (result.status === 204) throw new SyntaxError('Unexpected end of JSON input')
        return result.body
      } }
    },
  }
  vm.runInNewContext(source, context, { filename: 'panel.js' })
  for (const id of ['scale-1', 'scale-4']) doc.getElementById(id).checked = false
  await tick()
  return { nodes, node: doc.getElementById, doc, win, calls, intervals }
}

function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]) }

test('markup provides local deferred assets, accessible forms, safe token input, and scope guidance', async () => {
  const html = await load('lib/panel.html')
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /href="\/dsh-figma\/panel.css"/)
  assert.match(html, /src="\/dsh-figma\/panel.js"[^>]*defer|defer[^>]*src="\/dsh-figma\/panel.js"/)
  assert.match(html, /type="password"[^>]*autocomplete="off"/)
  assert.match(html, /type="datetime-local"/)
  assert.match(html, /current_user:read/); assert.match(html, /file_content:read/)
  assert.match(html, /https:\/\/www.figma.com\/settings/)
  assert.match(html, /aria-live="polite"/)
  for (const button of html.matchAll(/<button\b([^>]*)>/g)) assert.match(button[1], /type="(?:button|submit)"/)
  assert.doesNotMatch(html, /<style\b|<script(?![^>]*src=)/)
  const script = await load('lib/panel.js')
  for (const [, id] of script.matchAll(/byId\('([^']+)'\)/g)) assert.ok(html.includes(`id="${id}"`), `missing actual DOM element: ${id}`)
  for (const scale of [2, 3]) assert.match(html, new RegExp(`id="scale-${scale}"[^>]*checked`))
})

test('styles contain narrow viewport and keyboard focus treatment without remote assets', async () => {
  const css = await load('lib/panel.css')
  assert.match(css, /@media/); assert.match(css, /:focus-visible/)
  assert.doesNotMatch(css, /@import|https?:\/\//)
})

test('loads credentialed status, renders known labels, and disables configured-only actions when missing', async () => {
  const app = await boot(() => ({ body: status(false, 'missing') }))
  assert.equal(app.calls[0].url, '/dsh-figma/status')
  assert.equal(app.calls[0].credentials, 'same-origin')
  assert.equal(app.node('check-button').disabled, true)
  assert.equal(app.node('export-button').disabled, true)
  assert.equal(app.node('remove-button').disabled, true)
  assert.match(app.node('status-label').textContent, /未配置/)
})

test('token editor starts hidden without flashing before the initial status response', async () => {
  let release
  const app = await boot(() => new Promise((resolve) => { release = resolve }))
  const html = await load('lib/panel.html')
  assert.match(html, /id="token-editor"[^>]*hidden/)
  assert.match(html, /id="add-token-button"[^>]*aria-expanded="false"[^>]*aria-controls="token-editor"/)
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('add-token-button').hidden, true)
  release({ body: status(false, 'missing') }); await tick()
  assert.equal(app.node('token-editor').hidden, false)
})

test('configured credentials hide the entire editor except on explicit expiry or invalidity', async () => {
  for (const state of ['valid', 'expiring', 'permission_denied', 'network_error', 'rate_limited', 'unknown', 'future_state']) {
    const app = await boot(() => ({ body: status(true, state) }))
    assert.equal(app.node('token-editor').hidden, true, state)
    assert.equal(app.node('add-token-button').hidden, false, state)
    assert.equal(app.node('add-token-button').textContent, '增加令牌')
    assert.equal(app.node('add-token-button').attributes['aria-expanded'], 'false')
    assert.equal(app.node('remove-button').disabled, false)
  }
  for (const state of ['expired', 'invalid_or_expired']) {
    const app = await boot(() => ({ body: status(true, state) }))
    assert.equal(app.node('token-editor').hidden, false, state)
  }
  const html = await load('lib/panel.html')
  assert.match(html, /<div id="token-editor"[^>]*>[\s\S]*<form id="token-form"[\s\S]*<details class="setup-guide"[\s\S]*<\/details>\s*<\/div>/)
  assert.doesNotMatch(html.match(/<div id="token-editor"[^>]*>[\s\S]*?<\/details>\s*<\/div>/)?.[0] ?? '', /id="remove-button"/)
})

test('add token explicitly opens the editor and cancel clears both fields without a request', async () => {
  const app = await boot()
  await app.node('add-token-button').fire('click')
  assert.equal(app.node('token-editor').hidden, false)
  assert.equal(app.node('add-token-button').attributes['aria-expanded'], 'true')
  assert.equal(app.node('token').focused, true)
  app.node('token').value = 'unsaved'; app.node('expires-at').value = '2099-12-10T10:00'
  const before = app.calls.length
  await app.node('cancel-token-button').fire('click')
  assert.equal(app.node('token').value, '')
  assert.equal(app.node('expires-at').value, '')
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('add-token-button').attributes['aria-expanded'], 'false')
  assert.equal(app.node('add-token-button').focused, true)
  assert.equal(app.calls.length, before)
})

test('successful candidate save collapses the editor after status confirms a working credential', async () => {
  const app = await boot()
  await app.node('add-token-button').fire('click')
  app.node('token').value = 'replacement'; app.node('expires-at').value = '2099-12-10T10:00'
  await app.node('token-form').fire('submit')
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('expires-at').value, '')
  assert.equal(app.node('remove-button').disabled, false)
})

test('failed candidate keeps the editor open and leaves the saved credential usable', async () => {
  const app = await boot((url, options) => options.method === 'PUT' ? { ok: false, body: { error: { message: '令牌验证失败' } } } : { body: status() })
  await app.node('add-token-button').fire('click')
  app.node('token').value = 'bad-candidate'
  await app.node('token-form').fire('submit')
  assert.equal(app.node('token-editor').hidden, false)
  assert.equal(app.node('token').value, '')
  assert.equal(app.node('export-button').disabled, false)
  assert.equal(app.node('remove-button').disabled, false)
})

test('polling never closes a user-open editor or treats status transport failure as credential expiry', async () => {
  let current = status()
  let fail = false
  const app = await boot(() => fail ? Promise.reject(new Error('offline')) : { body: current })
  await app.node('add-token-button').fire('click')
  app.node('expires-at').value = '2099-12-10T10:00'
  for (const state of ['valid', 'expired', 'valid', 'permission_denied', 'unknown']) {
    current = status(true, state)
    app.intervals.values().next().value.fn(); await tick()
    assert.equal(app.node('token-editor').hidden, false, state)
    assert.equal(app.node('expires-at').value, '2099-12-10T10:00')
  }
  await app.node('cancel-token-button').fire('click')
  fail = true
  app.intervals.values().next().value.fn(); await tick()
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('remove-button').disabled, false)
})

test('confirmed save response still collapses an initially required editor if the follow-up status read fails', async () => {
  let saved = false
  const app = await boot((url, options) => {
    if (options.method === 'PUT') { saved = true; return { body: status() } }
    if (saved) throw new Error('offline after save')
    return { body: status(false, 'missing') }
  })
  app.node('token').value = 'first-credential'
  await app.node('token-form').fire('submit')
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('remove-button').disabled, false)
})

test('initial failed status remains loading-safe instead of showing a credential form', async () => {
  const app = await boot(() => { throw new Error('offline') })
  assert.equal(app.node('token-editor').hidden, true)
  assert.equal(app.node('add-token-button').hidden, true)
  assert.equal(app.node('remove-button').disabled, true)
})

test('editor controls cannot cancel or reopen during an active save', async () => {
  let release
  const app = await boot(async (url, options) => {
    if (options.method === 'PUT') await new Promise((resolve) => { release = resolve })
    return { body: status() }
  })
  await app.node('add-token-button').fire('click')
  app.node('token').value = 'replacement'; app.node('expires-at').value = '2099-12-10T10:00'
  const pending = app.node('token-form').fire('submit'); await tick()
  assert.equal(app.node('cancel-token-button').disabled, true)
  assert.equal(app.node('add-token-button').disabled, true)
  await app.node('cancel-token-button').fire('click')
  assert.equal(app.node('expires-at').value, '2099-12-10T10:00')
  assert.equal(app.node('token-editor').hidden, false)
  release(); await pending
})

test('removing a configured credential reveals the required editor again', async () => {
  let configured = true
  const app = await boot((url, options) => {
    if (options.method === 'DELETE') configured = false
    return { body: status(configured, configured ? 'valid' : 'missing') }
  })
  assert.equal(app.node('token-editor').hidden, true)
  await app.node('remove-button').fire('click')
  assert.equal(app.node('token-editor').hidden, false)
  assert.equal(app.node('remove-button').disabled, true)
})

test('save sends JSON security headers and local expiry as ISO, clears secret, then refreshes status', async () => {
  const app = await boot()
  app.node('token').value = 'figd_secret'; app.node('expires-at').value = '2099-12-10T10:00'
  await app.node('token-form').fire('submit')
  const call = app.calls.find((item) => item.method === 'PUT')
  assert.equal(call.url, '/dsh-figma/token'); assert.equal(call.credentials, 'same-origin')
  assert.equal(call.headers['Content-Type'], 'application/json'); assert.equal(call.headers['X-DSH-Figma'], '1')
  const body = JSON.parse(call.body)
  assert.equal(body.token, 'figd_secret'); assert.equal(body.expiresAt, new Date('2099-12-10T10:00').toISOString())
  assert.equal(app.node('token').value, '')
  assert.equal(app.calls.at(-1).url, '/dsh-figma/status')
})

test('forwards the authenticated status CSRF challenge for Desktop-originless mutations', async () => {
  const csrf = 'X'.repeat(43)
  const app = await boot(() => ({ body: { ...status(), csrfToken: csrf } }))
  app.node('token').value = 'candidate'
  await app.node('token-form').fire('submit')
  assert.equal(app.calls.find((call) => call.method === 'PUT').headers['X-DSH-Figma-CSRF'], csrf)
})

test('failed candidate clears secret without claiming it replaced the saved token', async () => {
  const app = await boot((url, options) => options.method === 'PUT' ? { ok: false, body: { error: { code: 'invalid_token', message: '令牌验证失败' } } } : { body: status() })
  app.node('token').value = 'candidate'
  await app.node('token-form').fire('submit')
  assert.equal(app.node('token').value, '')
  assert.match(app.node('notice').textContent, /令牌验证失败/)
  assert.doesNotMatch(app.node('notice').textContent, /保存成功/)
  assert.equal(app.node('check-button').disabled, false)
})

test('unstructured failures never display raw server text and status failure disables actions', async () => {
  const app = await boot(() => ({ ok: false, body: '<html>RAW_SECRET</html>' }))
  assert.doesNotMatch(app.node('notice').textContent, /RAW_SECRET|html/)
  assert.equal(app.node('export-button').disabled, true)
})

test('remove requires confirmation and all mutations carry security headers', async () => {
  const app = await boot()
  app.win.confirm = () => false
  await app.node('remove-button').fire('click')
  assert.equal(app.calls.filter((call) => call.method === 'DELETE').length, 0)
  app.win.confirm = () => true
  await app.node('remove-button').fire('click')
  await app.node('check-button').fire('click')
  for (const call of app.calls.filter((call) => ['POST', 'DELETE'].includes(call.method))) {
    assert.equal(call.headers['X-DSH-Figma'], '1'); assert.equal(call.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(call.body), {})
  }
})

test('export validates Figma node links and scale selection before requesting', async () => {
  const app = await boot()
  for (const link of ['https://evil.test/design/a?node-id=1-2', 'https://www.figma.com/design/a/Name', 'javascript:alert(1)']) {
    app.node('figma-url').value = link
    await app.node('export-form').fire('submit')
  }
  app.node('figma-url').value = 'https://www.figma.com/design/abc/Name?node-id=1-2'
  app.node('scale-2').checked = false; app.node('scale-3').checked = false
  await app.node('export-form').fire('submit')
  assert.equal(app.calls.filter((call) => call.url.endsWith('/export')).length, 0)
})

test('export shows actual dimensions and warnings as text; accepts only fixed same-origin downloads', async () => {
  const files = [
    { filename: '<unsafe>.png', width: 640, height: 480, downloadUrl: '/dsh-figma/download?id=abc', warnings: ['<b>云端版本</b>'] },
    { filename: 'evil.png', width: 1, height: 1, downloadUrl: 'https://evil.test/dsh-figma/download?id=x', warnings: [] },
    { filename: 'extra.png', width: 1, height: 1, downloadUrl: '/dsh-figma/download?id=x&redirect=https://evil.test', warnings: [] },
  ]
  const app = await boot((url) => ({ body: url.endsWith('/export') ? { files } : status() }))
  app.node('figma-url').value = 'https://www.figma.com/design/abc/branch/def/Name?node-id=1%3A2'
  await app.node('export-form').fire('submit')
  const call = app.calls.find((item) => item.url.endsWith('/export'))
  assert.deepEqual(JSON.parse(call.body).scales, [2, 3])
  const all = descendants(app.node('export-results'))
  const links = all.filter((node) => node.tagName === 'a')
  assert.equal(links.length, 1); assert.equal(links[0].href, '/dsh-figma/download?id=abc')
  assert.equal(links[0].download, '<unsafe>.png')
  assert.ok(all.some((node) => node.textContent.includes('640 × 480')))
  assert.ok(all.some((node) => node.textContent === '<b>云端版本</b>'))
})

test('prevents concurrent mutations, including programmatic duplicate submits', async () => {
  let release
  const app = await boot(async (url, options) => {
    if (options.method === 'PUT') await new Promise((resolve) => { release = resolve })
    return { body: status() }
  })
  app.node('token').value = 'secret'
  const pending = app.node('token-form').fire('submit')
  await tick()
  assert.equal(app.node('save-button').disabled, true)
  await app.node('token-form').fire('submit')
  await app.node('check-button').fire('click')
  assert.equal(app.calls.filter((call) => call.method === 'PUT').length, 1)
  assert.equal(app.calls.filter((call) => call.url.endsWith('/check')).length, 0)
  release(); await pending
})

test('polls status only while visible and clears token on pagehide', async () => {
  const app = await boot()
  assert.equal([...app.intervals.values()][0].delay, 60_000)
  app.doc.visibilityState = 'hidden'; app.doc.hidden = true
  await app.doc.fire('visibilitychange')
  assert.equal(app.intervals.size, 0)
  app.doc.visibilityState = 'visible'; app.doc.hidden = false
  await app.doc.fire('visibilitychange'); await tick()
  assert.equal(app.intervals.size, 1)
  app.node('token').value = 'secret'
  await app.win.fire('pagehide')
  assert.equal(app.node('token').value, '')
  assert.equal(app.intervals.size, 0)
})

test('visibility changes cannot start stale status reads during an active mutation', async () => {
  let release
  const app = await boot(async (url, options) => {
    if (options.method === 'PUT') await new Promise((resolve) => { release = resolve })
    return { body: status() }
  })
  app.node('token').value = 'candidate'
  const pending = app.node('token-form').fire('submit')
  await tick()
  const before = app.calls.length
  app.doc.visibilityState = 'hidden'; await app.doc.fire('visibilitychange')
  app.doc.visibilityState = 'visible'; await app.doc.fire('visibilitychange')
  await tick()
  assert.equal(app.calls.length, before)
  release(); await pending
})

test('accepts successful no-content mutation responses', async () => {
  const app = await boot((url, options) => options.method === 'DELETE' ? { status: 204 } : { body: status() })
  await app.node('remove-button').fire('click')
  assert.match(app.node('notice').textContent, /已移除/)
})

test('clears an invalid candidate without making a request', async () => {
  const app = await boot()
  app.node('token').value = 'candidate'; app.node('expires-at').value = '2000-01-01T00:00'
  await app.node('token-form').fire('submit')
  assert.equal(app.node('token').value, '')
  assert.equal(app.calls.filter((call) => call.method === 'PUT').length, 0)
  assert.match(app.node('notice').textContent, /未来/)
})

test('renders every documented status without inserting markup or persisting secrets', async () => {
  for (const state of ['missing', 'valid', 'expiring', 'expired', 'invalid_or_expired', 'permission_denied', 'network_error', 'rate_limited', 'unknown']) {
    const app = await boot(() => ({ body: status(state !== 'missing', state) }))
    assert.ok(app.node('status-label').textContent.length > 0)
  }
  const js = await load('lib/panel.js')
  assert.doesNotMatch(js, /innerHTML|outerHTML|localStorage|sessionStorage|document\.cookie|\.text\(/)
})
