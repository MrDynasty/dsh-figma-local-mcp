import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

function style() {
  const values = new Map()
  return { values, setProperty(k, v) { values.set(k, v) }, removeProperty(k) { values.delete(k) }, getPropertyValue(k) { return values.get(k) || '' } }
}

async function mount() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const effects = [], observers = [], callbacks = new Set(), jobs = new Map()
  const host = new Map([
    ['--dsw-alias-bg-base', '#101216'], ['--dsw-alias-label-primary', '#efefef'],
    ['--dsw-alias-brand-primary', '#7bbaff'], ['--dsw-radius-md', '10px'],
  ])
  let computed = { colorScheme: 'dark', fontFamily: 'Local Skin Font', fontSize: '14px' }, seq = 0
  const root = { style: style() }, events = new Map()
  const frame = { contentDocument: { documentElement: root }, addEventListener: (k, fn) => events.set(k, fn), removeEventListener: (k) => events.delete(k) }
  const document = { documentElement: {}, body: {}, head: {}, createElement() { throw new Error('floating UI forbidden') } }
  let plugin, panel
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), useRef: () => ({ current: frame }), useEffect(fn) { effects.push(fn) } }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (r) => { plugin = r.factory(() => React) } } }, document,
    getComputedStyle: () => Object.assign([...host.keys()], computed, { getPropertyValue: (k) => host.get(k) || '' }),
    MutationObserver: class { constructor(fn) { this.callback = fn; observers.push(this) } observe() {} disconnect() { this.disconnected = true } },
    requestAnimationFrame: (fn) => { jobs.set(++seq, fn); return seq }, cancelAnimationFrame: (id) => jobs.delete(id),
  })
  const ctx = {
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    slots: {
      inject(name, fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
      register(options, component) { if (options.name === 'main') panel = component; return () => {} },
    },
    on(name, fn) { assert.equal(name, 'theme/change'); callbacks.add(fn); return () => callbacks.delete(fn) },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  panel({ ctx })
  const cleanup = effects.map(fn => fn()).filter(Boolean)
  const flush = () => { for (const [id, fn] of [...jobs]) { jobs.delete(id); fn() } }
  return { root, frame, events, host, observers, callbacks, jobs, flush,
    setComputed(value) { computed = value },
    dispose() { for (const fn of cleanup) fn() },
  }
}

test('iframe inherits actual host skin tokens and typography, including load and live skin changes', async () => {
  const app = await mount()
  assert.equal(app.root.style.getPropertyValue('--dsw-alias-bg-base'), '#101216')
  assert.equal(app.root.style.getPropertyValue('--dsw-radius-md'), '10px')
  assert.equal(app.root.style.fontFamily, 'Local Skin Font')
  assert.equal(app.root.style.colorScheme, 'dark')
  app.host.set('--dsw-alias-bg-base', '#f5f8ff')
  app.host.delete('--dsw-alias-brand-primary')
  app.setComputed({ colorScheme: 'light', fontFamily: 'Updated Skin Font', fontSize: '15px' })
  for (const fn of app.callbacks) fn()
  app.flush()
  assert.equal(app.root.style.getPropertyValue('--dsw-alias-bg-base'), '#f5f8ff')
  assert.equal(app.root.style.getPropertyValue('--dsw-alias-brand-primary'), '', 'removed skin overrides must not become stale')
  assert.equal(app.root.style.colorScheme, 'light')
  app.root.style.removeProperty('--dsw-alias-bg-base')
  app.events.get('load')?.()
  app.flush()
  assert.equal(app.root.style.getPropertyValue('--dsw-alias-bg-base'), '#f5f8ff')
  app.dispose()
  assert.equal(app.callbacks.size, 0)
  assert.equal(app.events.size, 0)
  assert.ok(app.observers.every(o => o.disconnected))
})

test('skin style mutations are batched, and unmount cancels pending synchronization', async () => {
  const app = await mount()
  assert.ok(app.observers.length, 'observe parent skin styles as well as the theme event')
  for (const observer of app.observers) {
    observer.callback([{ type: 'attributes', target: {} }])
    observer.callback([{ type: 'childList', target: {} }])
  }
  assert.equal(app.jobs.size, 1)
  app.dispose()
  assert.equal(app.jobs.size, 0)
})

test('native controls follow the host background when its color-scheme is normal', async () => {
  const app = await mount()
  app.setComputed({ colorScheme: 'normal', fontFamily: 'Skin Font', fontSize: '14px' })
  for (const bg of ['#101216', '#123', 'rgb(20, 22, 28)']) {
    app.host.set('--dsw-alias-bg-base', bg)
    for (const fn of app.callbacks) fn()
    app.flush()
    assert.equal(app.root.style.colorScheme, 'dark')
  }
  app.host.set('--dsw-alias-bg-base', '#fafafa')
  for (const fn of app.callbacks) fn()
  app.flush()
  assert.equal(app.root.style.colorScheme, 'light')
  app.dispose()
})

test('panel CSS uses DSH skin aliases instead of a fixed light-only brand', async () => {
  const css = await readFile(new URL('../lib/panel.css', import.meta.url), 'utf8')
  for (const token of ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-brand-primary', '--dsw-alias-border-l1', '--dsw-radius-md']) assert.ok(css.includes(token), token)
  assert.ok(css.includes('prefers-color-scheme: dark'), 'standalone fallback supports dark mode')
  assert.ok(!css.includes('color-scheme: light;'))
})
