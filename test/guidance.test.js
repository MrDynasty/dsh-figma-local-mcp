import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { apply } from '../lib/index.js'

const root = new URL('../', import.meta.url)

function boot() {
  const prompts = [], skills = [], dependencies = []
  apply({
    on() {}, inject: (services) => dependencies.push(...services),
    effect: (fn) => fn(),
    systemPrompt: { section: (p) => { prompts.push(p) } },
    skills: { register: (s) => { skills.push(s) } },
  })
  return { prompt: prompts.map((p) => p.text).join('\n'), skills, dependencies }
}

test('global prompt requires in-task export through workspace delivery, never follow-up downloads', () => {
  const { prompt, dependencies } = boot()
  assert.match(prompt, /automatically.*figma_export_images/i)
  assert.match(prompt, /same task/i)
  assert.match(prompt, /workspace/i)
  assert.match(prompt, /left sidebar/i)
  for (const name of ['workingDirectory', 'sandboxPolicy', 'shell']) assert.ok(dependencies.includes(name))
})

test('skill body is thin, points at real references, and keeps the hard rules', async () => {
  const { skills } = boot()
  assert.equal(skills.length, 1)
  const skill = skills[0]
  assert.equal(skill.name, 'figma-design-to-code')
  assert.match(skill.content, /references\/tools\.md/)
  assert.match(skill.content, /references\/targets\.md/)
  assert.match(skill.content, /references\/auth-state\.md/)
  assert.match(skill.content, /figma_export_images/)
  assert.match(skill.content, /outputDir|asset directory/i)
  assert.match(skill.content, /Never ask for, echo, or paste a Figma token/i)
  assert.match(skill.content, /Never upscale a screenshot/i)
  assert.ok(skill.content.split('\n').length < 80, 'skill body must stay short')

  assert.equal(skill.resourceBase.kind, 'directory')
  assert.deepEqual(skill.resourceBase.path, new URL('references', root).pathname)
  for (const name of ['tools.md', 'targets.md', 'auth-state.md']) {
    const body = await readFile(new URL(`references/${name}`, root), 'utf8')
    assert.ok(body.length > 400, `${name} is too thin`)
    assert.ok(!/figd_[A-Za-z0-9]/.test(body), `${name} must not contain a real token`)
  }
  await access(new URL('references/tools.md', root))
})

test('references document the parameter surface the tools actually expose', async () => {
  const [tools, targets, auth] = await Promise.all(
    ['tools.md', 'targets.md', 'auth-state.md'].map((name) => readFile(new URL(`references/${name}`, root), 'utf8')),
  )
  for (const token of ['png', 'svg', 'pdf', 'outputDir', 'scales']) assert.ok(tools.includes(token), `tools.md misses ${token}`)
  assert.match(tools, /32 MP/)
  assert.match(targets, /node-id/)
  assert.match(targets, /branch/i)
  for (const state of ['missing', 'valid', 'expiring', 'expired', 'invalid_or_expired', 'permission_denied', 'rate_limited', 'network_error', 'credential_error']) {
    assert.ok(auth.includes(`\`${state}\``), `auth-state.md misses ${state}`)
  }
  assert.match(auth, /audit\.jsonl/)
})
