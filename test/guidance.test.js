import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

test('global prompt and skill require in-task 2x/3x workspace delivery, not user follow-up downloads', () => {
  const prompts = [], skills = [], dependencies = []
  apply({
    on() {}, inject: (services) => dependencies.push(...services),
    effect: (fn) => fn(),
    systemPrompt: { section: (p) => { prompts.push(p) } },
    skills: { register: (s) => { skills.push(s) } },
  })
  const prompt = prompts.map((p) => p.text).join('\n')
  assert.match(prompt, /automatically.*figma_export_images/i)
  assert.match(prompt, /same task/i)
  assert.match(prompt, /workspace/i)
  assert.match(skills[0].content, /Do not.*manual.*download/i)
  assert.match(skills[0].content, /outputDir/)
  for (const name of ['workingDirectory', 'sandboxPolicy', 'shell']) assert.ok(dependencies.includes(name))
})
