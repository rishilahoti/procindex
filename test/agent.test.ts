// The loop's message plumbing, against a stubbed client. (The Messages API 400s on a tool_use without a paired tool_result,
// which is the bug class this guards. Model behaviour itself can only be checked with a real key: see README.)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { reply, type Session } from '../src/agent.ts'
import { fakePorts } from '../src/fake.ts'

const msg = (content: unknown[], stop_reason = 'end_turn') => ({ stop_reason, content }) as unknown as Anthropic.Message
const text = (t: string) => ({ type: 'text', text: t })
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input })

function stub(script: (Anthropic.Message | Error)[]) {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client = {
    messages: {
      create: async (p: Anthropic.MessageCreateParamsNonStreaming) => {
        seen.push({ ...p, messages: structuredClone(p.messages) }) // snapshot: the loop keeps mutating the array
        const next = script.shift()!
        if (next instanceof Error) throw next
        return next
      },
    },
  } as unknown as Anthropic
  return { client, seen }
}

test('tool_use is executed and answered with a paired tool_result, then the final text comes back', async () => {
  const s: Session = { id: 's1', messages: [] }
  const { client, seen } = stub([
    msg([text('Let me check.'), use('tu_1', 'check_availability', { service: 'interior_wash', date: 'thursday', time: '15:30' })], 'tool_use'),
    msg([text("That one's full.")]),
  ])
  assert.equal(await reply(s, 'Is Thursday 3:30 open?', fakePorts(), client), "That one's full.")

  const second = seen[1].messages
  assert.deepEqual(second.map((m) => m.role), ['user', 'assistant', 'user'])
  const result = (second[2].content as Anthropic.ToolResultBlockParam[])[0]
  assert.equal(result.type, 'tool_result')
  assert.equal(result.tool_use_id, 'tu_1')
  assert.equal(typeof JSON.parse(result.content as string).available, 'boolean')
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.match(String(seen[0].system), /Cedar Lane Auto Detailing/)
  assert.match(String(seen[0].system), /NOW: \w+day, \w+ \d+, \d{4}/)
})

test('parallel tool_use blocks all get their result, in one user message', async () => {
  const s: Session = { id: 's2', messages: [] }
  const { client, seen } = stub([
    msg([use('a', 'find_appointments', { phone: '415-555-0138' }), use('b', 'check_availability', { service: 'full_detail', date: 'friday', time: '10:00' })], 'tool_use'),
    msg([text('done')]),
  ])
  await reply(s, 'hi', fakePorts(), client)
  const results = seen[1].messages[2].content as Anthropic.ToolResultBlockParam[]
  assert.deepEqual(results.map((r) => r.tool_use_id), ['a', 'b'])
})

test('a failed turn rolls the history back so the next turn is not poisoned', async () => {
  const s: Session = { id: 's3', messages: [] }
  const { client } = stub([
    msg([use('x', 'find_appointments', { phone: '415-555-0138' })], 'tool_use'),
    new Error('API down'),
    msg([text('back again')]),
  ])
  await assert.rejects(reply(s, 'first', fakePorts(), client), /API down/)
  assert.equal(s.messages.length, 0)
  assert.equal(await reply(s, 'second', fakePorts(), client), 'back again')
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant'])
})

test('a model that never stops calling tools is cut off', async () => {
  const s: Session = { id: 's4', messages: [] }
  const { client } = stub(Array.from({ length: 20 }, () => msg([use('t', 'find_appointments', { phone: '415-555-0138' })], 'tool_use')))
  await assert.rejects(reply(s, 'loop', fakePorts(), client), /did not finish/)
  assert.equal(s.messages.length, 0)
})
