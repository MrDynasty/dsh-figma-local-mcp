import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function boot() {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const slots = new Map(), disposers = [], nodes = [], injected = []
  const listeners = new Set()
  let activePanelId = null
  const panelInfo = {
    getSnapshot: () => ({ activePanelId }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
  const layout = {
    panelInfo,
    selectPanel(id) {
      if (id !== null && !slots.has(`main:${id}`)) throw new Error(`layout.selectPanel: main panel "${id}" is not registered`)
      activePanelId = id
      for (const fn of listeners) fn()
    },
  }
  const document = {
    body: { appendChild: (el) => nodes.push(el) },
    createElement: (tag) => ({
      tag, style: {}, attributes: {}, textContent: '',
      setAttribute(k, v) { this.attributes[k] = v },
      addEventListener(k, v) { this[k] = v },
      remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1) },
    }),
  }
  const React = {
    useRef() { return { current: null } },
    useEffect(fn) { fn() },
    createElement: (type, props, ...children) => ({ type, props, children }),
  }
  let plugin
  vm.runInNewContext(code, {
    document,
    window: { __ModuleLoader__: { load(row) { assert.equal(row.id, 'dsh-figma-local-mcp'); plugin = row.factory((name) => { assert.equal(name, 'react'); return React }) } } },
  })
  const ctx = {
    layout,
    slots: {
      inject(name, fn) { injected.push(name); const d = fn(); if (d) disposers.push(d); return d },
      register(options, component) {
        const key = options.name === 'main' ? `main:${options.key}` : `${options.name}:${options.id}`
        slots.set(key, { options, component })
        return () => slots.delete(key)
      },
    },
    effect(fn) { const d = fn(); if (d) disposers.push(d) },
  }
  plugin.apply(ctx)
  return {
    plugin, slots, nodes, injected, layout,
    get active() { return activePanelId },
    dispose() { for (const fn of disposers.reverse()) fn() },
  }
}

test('Figma registers a left-sidebar panel row and a keyed main panel without opening itself', async () => {
  const app = await boot()
  const row = app.slots.get('sidebar.panellist:dsh-figma')
  const panel = app.slots.get('main:dsh-figma')
  assert.ok(row, 'left sidebar row must be registered in sidebar.panellist')
  assert.ok(panel, 'panel body must be registered in the keyed main slot')
  assert.equal(row.options.id, 'dsh-figma')
  assert.equal(row.options.label(), 'Figma')
  assert.equal(typeof row.options.order, 'number')
  assert.equal(app.active, null)
  const glyph = row.component({ size: 18, active: false })
  assert.equal(glyph.type, 'svg')
  assert.equal(glyph.props['aria-hidden'], 'true')
  const body = panel.component({})
  assert.equal(body.type, 'div')
  assert.equal(body.props.style.width, '100%')
  assert.equal(body.props.style.flex, '1 1 auto')
  const frame = body.children[0]
  assert.equal(frame.type, 'iframe')
  assert.equal(frame.props.src, '/dsh-figma')
  assert.equal(frame.props.style.height, '100%')
})

test('left sidebar is the only entry, with no fixed launcher injected into the host', async () => {
  const app = await boot()
  assert.equal(app.nodes.length, 0, 'no floating button or panel may be appended')
  app.layout.selectPanel('dsh-figma')
  assert.equal(app.active, 'dsh-figma')
  app.layout.selectPanel(null)
  assert.equal(app.active, null)
})

test('unloading the plugin closes its panel and removes the left-sidebar row', async () => {
  const app = await boot()
  app.layout.selectPanel('dsh-figma')
  app.dispose()
  assert.equal(app.active, null)
  assert.equal(app.slots.size, 0)
  assert.equal(app.nodes.length, 0)
})
