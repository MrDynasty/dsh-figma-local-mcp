import test from 'node:test'
import assert from 'node:assert/strict'
import { installExport } from '../lib/plugin.js'

test('host wiring registers safe routes, tools and lifecycle without exposing token setters to agents', async () => {
  const effects = [], routes = [], tools = []
  const ctx = {
    webServer: { protocol: 'http:', getOrigin: () => 'http://127.0.0.1:61058', register: (r) => { routes.push(r); return () => {} } },
    credentials: { readRecord: async () => undefined, modifyRecord: async () => {}, deleteRecord: async () => {} },
    connection: { requestRejection: () => undefined }, tools: { register: (t) => { tools.push(t); return () => {} } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose) },
  }
  installExport(ctx)
  try {
    assert.ok(routes.some((r) => r.path === '/dsh-figma/status'))
    assert.deepEqual(tools.map((t) => t.name), ['figma_token_status', 'figma_export_images'])
    assert.ok(tools.every((t) => !Object.keys(t.parameters.properties).includes('token')))
    const status = await tools[0].execute({})
    assert.equal(status.state, 'missing'); assert.equal(status.panelUrl, 'http://127.0.0.1:61058/dsh-figma')
  } finally { for (const dispose of effects.reverse()) dispose() }
})
