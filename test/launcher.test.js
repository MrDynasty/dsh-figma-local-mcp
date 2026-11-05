import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply } from '../lib/index.js'

test('host uses the native client extension and injects no modal launcher', () => {
  let scripts = 0
  apply({
    on() { scripts++ }, inject() {}, effect() {},
  })
  assert.equal(scripts, 0)
})

test('published package declares the left-sidebar client entry and its layout provider', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-layout'])
})
