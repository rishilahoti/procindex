// Invariants of the phone assistant that would silently wreck the call if someone "tuned" them wrong.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { systemPrompt } from '../src/prompt.ts'
import { TOOLS } from '../src/tools.ts'
import { assistantConfig, PARTIAL_NUMBER } from '../src/vapi-config.ts'

const cfg = assistantConfig('https://example.ngrok.app/', 's3cret')

test('latency settings stay inside the 1.2s budget', () => {
  assert.ok(cfg.startSpeakingPlan!.waitSeconds! <= 0.2, 'waitSeconds is a floor on every reply; the 0.4 default is a third of the budget')
  assert.match((cfg.model as { model: string }).model, /haiku/, 'a small model: first token has to arrive in ~0.5s')
  assert.ok((cfg.transcriber as { eotTimeoutMs: number }).eotTimeoutMs <= 3000)
  assert.equal(cfg.startSpeakingPlan!.smartEndpointingPlan, undefined, 'an endpointing plan would override the transcriber end-of-turn detection')
  assert.ok(cfg.voice && 'chunkPlan' in cfg.voice && cfg.voice.chunkPlan!.minCharacters! <= 15, 'short first chunk so the lead-in is spoken at once')
})

test('partial-number rule waits only on a half-finished digit string', () => {
  const re = new RegExp(PARTIAL_NUMBER)
  const waits: [string, boolean][] = [
    ['4 1 5 5 5 5', true], ['Sara, 415 555', true], ['it is a 2019', true],
    ['4 1 5 5 5 5 0 1 9 0', false], ['my number is 415-555-0190.', false], ['4155550190', false], ['14155550190', false], ['Sara, 4 1 5 5 5 5 0 1 9 0', false],
    ['Sara', false], ['I would like Thursday', false], ['yes', false],
  ]
  for (const [said, wait] of waits) assert.equal(re.test(said), wait, said)
  const rule = cfg.startSpeakingPlan!.customEndpointingRules![0] as { regex: string; timeoutSeconds: number }
  assert.equal(rule.regex, PARTIAL_NUMBER)
  assert.ok(rule.timeoutSeconds < 1, 'a longer wait than this makes the number turn blow the budget by itself')
})

test('tools: same set as the chat agent, flat object schemas, and no message that would replace the model answer', () => {
  const tools = (cfg.model as { tools: any[] }).tools
  const fns = tools.filter((t) => t.type === 'function')
  assert.deepEqual(fns.map((t) => t.function.name), TOOLS.map((t) => t.name))
  assert.ok(tools.some((t) => t.type === 'endCall'))
  for (const t of fns) {
    assert.equal(t.function.parameters.type, 'object')
    assert.ok(t.function.description.length > 40)
    for (const m of t.messages ?? []) assert.equal(m.type, 'request-response-delayed', 'request-complete/failed text is spoken instead of the model answer')
  }
})

test('webhook: tool calls only, authenticated, never retried, URL normalised', () => {
  assert.deepEqual(cfg.serverMessages, ['tool-calls'])
  assert.equal(cfg.server!.url, 'https://example.ngrok.app/vapi/tools')
  assert.deepEqual(cfg.server!.headers, { 'x-cedar-secret': 's3cret' })
  assert.equal(cfg.server!.backoffPlan, undefined)
})

test('the voice prompt is rendered by Vapi at call time with the current shop-local time and the caller ID', () => {
  const content = (cfg.model as { messages: { content: string }[] }).messages[0].content
  assert.match(content, /NOW: \{\{"now" \| date: "[^"]+", "America\/Los_Angeles"\}\}/)
  assert.match(content, /\{\{customer\.number\}\}/)
  assert.match(content, /endCall/)
  assert.doesNotMatch(systemPrompt('chat', 'x'), /customer\.number|endCall/, 'chat prompt has no voice-only instructions')
})
