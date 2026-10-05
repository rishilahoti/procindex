// The loop's message plumbing, against a stubbed Gemini client. (Gemini 400s on a function call without a paired
// function response, which is the bug class this guards. Model behaviour itself can only be checked with a real key: see docs/setup.md.)
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { GoogleGenAI, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from '@google/genai'
import { reply, type Session } from '../../src/channels/chat/reply.ts'
import { fakePorts } from '../../src/integrations/fake/ports.ts'
import { TOOLS } from '../../src/receptionist/tools/index.ts'

const answer = (parts: Part[], finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] }) as unknown as GenerateContentResponse
const text = (t: string): Part => ({ text: t })
const call = (id: string, name: string, args: Record<string, unknown>, extra: Part = {}): Part => ({ functionCall: { id, name, args }, ...extra })
const responses = (c: Content | undefined) => (c?.parts ?? []).flatMap((p) => p.functionResponse ?? [])

function stub(script: (GenerateContentResponse | Error)[]) {
  const seen: GenerateContentParameters[] = []
  const client = {
    models: {
      generateContent: async (p: GenerateContentParameters) => {
        seen.push({ ...p, contents: structuredClone(p.contents) }) // snapshot: the loop keeps mutating the array
        const next = script.shift()!
        if (next instanceof Error) throw next
        return next
      },
    },
  } as unknown as GoogleGenAI
  return { client, seen }
}

test('a function call is executed and answered with a paired function response, then the final text comes back', async () => {
  const s: Session = { id: 's1', messages: [] }
  const { client, seen } = stub([
    answer([text('Let me check.'), call('tu_1', 'check_availability', { service: 'interior_wash', date: 'thursday', time: '15:30' })]),
    answer([text("That one's full.")]),
  ])
  assert.equal(await reply(s, 'Is Thursday 3:30 open?', fakePorts(), client), "That one's full.")

  const second = seen[1].contents as Content[]
  assert.deepEqual(second.map((m) => m.role), ['user', 'model', 'user'])
  const [result] = responses(second[2])
  assert.equal(result.id, 'tu_1')
  assert.equal(result.name, 'check_availability')
  assert.equal(typeof (result.response as { available: unknown }).available, 'boolean', 'the tool JSON reaches the model as an object')
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'model', 'user', 'model'])
  assert.match(String(seen[0].config?.systemInstruction), /Cedar Lane Auto Detailing/)
  assert.match(String(seen[0].config?.systemInstruction), /NOW: \w+day, \w+ \d+, \d{4}/)
})

test('every shared tool is declared to the model with its JSON schema', async () => {
  const { client, seen } = stub([answer([text('hi')])])
  await reply({ id: 's0', messages: [] }, 'hi', fakePorts(), client)
  const declared = seen[0].config?.tools?.[0] as { functionDeclarations: { name: string; parametersJsonSchema: { type: string } }[] }
  assert.deepEqual(declared.functionDeclarations.map((d) => d.name), TOOLS.map((t) => t.name))
  for (const d of declared.functionDeclarations) assert.equal(d.parametersJsonSchema.type, 'object')
})

test('parallel function calls all get their response, in one user message and in order', async () => {
  const s: Session = { id: 's2', messages: [] }
  const { client, seen } = stub([
    answer([call('a', 'find_appointments', { phone: '415-555-0138' }), call('b', 'check_availability', { service: 'full_detail', date: 'friday', time: '10:00' })]),
    answer([text('done')]),
  ])
  await reply(s, 'hi', fakePorts(), client)
  assert.deepEqual(responses((seen[1].contents as Content[])[2]).map((r) => r.id), ['a', 'b'])
})

test("the model's own turn goes back untouched, so Gemini 3 thought signatures survive between steps", async () => {
  const s: Session = { id: 's5', messages: [] }
  const { client, seen } = stub([
    answer([call('x', 'find_appointments', { phone: '415-555-0138' }, { thoughtSignature: 'sig-abc' })]),
    answer([text('done')]),
  ])
  await reply(s, 'hi', fakePorts(), client)
  assert.equal(((seen[1].contents as Content[])[1].parts as Part[])[0].thoughtSignature, 'sig-abc')
})

test('thinking parts are never read out as the answer', async () => {
  const s: Session = { id: 's6', messages: [] }
  const { client } = stub([answer([{ text: 'planning the reply', thought: true }, text('Hello '), text('there')])])
  assert.equal(await reply(s, 'hi', fakePorts(), client), 'Hello there')
})

test('a failed turn rolls the history back so the next turn is not poisoned', async () => {
  const s: Session = { id: 's3', messages: [] }
  const { client } = stub([
    answer([call('x', 'find_appointments', { phone: '415-555-0138' })]),
    new Error('API down'),
    answer([text('back again')]),
  ])
  await assert.rejects(reply(s, 'first', fakePorts(), client), /API down/)
  assert.equal(s.messages.length, 0)
  assert.equal(await reply(s, 'second', fakePorts(), client), 'back again')
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'model'])
})

test('a blocked or empty response is an error naming the reason, and the history is rolled back', async () => {
  const s: Session = { id: 's7', messages: [] }
  const { client } = stub([{ candidates: [{ finishReason: 'SAFETY' }] } as unknown as GenerateContentResponse])
  await assert.rejects(reply(s, 'hi', fakePorts(), client), /no content \(SAFETY\)/)
  assert.equal(s.messages.length, 0)
})

test('a model that never stops calling tools is cut off', async () => {
  const s: Session = { id: 's4', messages: [] }
  const { client } = stub(Array.from({ length: 20 }, () => answer([call('t', 'find_appointments', { phone: '415-555-0138' })])))
  await assert.rejects(reply(s, 'loop', fakePorts(), client), /did not finish/)
  assert.equal(s.messages.length, 0)
})

test('over the real SDK (local mock server): tools, system prompt, function response and thought signature are what Gemini expects on the wire', async () => {
  const wire: { url: string; key: unknown; body: any }[] = []
  const script = [
    { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'find_appointments', args: { phone: '415-555-0138' } }, thoughtSignature: 'sig-wire' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'You have one booking.' }] } }] },
  ]
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    wire.push({ url: req.url!, key: req.headers['x-goog-api-key'], body: JSON.parse(raw) })
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(script.shift()))
  }).listen(0)
  await once(server, 'listening')
  try {
    const client = new GoogleGenAI({ apiKey: 'test-key', httpOptions: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } })
    const s: Session = { id: 'w1', messages: [] }
    assert.equal(await reply(s, 'what do I have booked? 415-555-0138', fakePorts(), client), 'You have one booking.')

    const [first, second] = wire
    assert.match(first.url, /\/models\/[\w.-]+:generateContent$/)
    assert.equal(first.key, 'test-key', 'the AI Studio key is sent as x-goog-api-key')
    assert.match(first.body.systemInstruction.parts[0].text, /Cedar Lane Auto Detailing/)
    const declared = first.body.tools[0].functionDeclarations
    assert.deepEqual(declared.map((d: { name: string }) => d.name), TOOLS.map((t) => t.name))
    assert.equal(declared[0].parametersJsonSchema.type, 'object')
    assert.deepEqual(first.body.contents, [{ role: 'user', parts: [{ text: 'what do I have booked? 415-555-0138' }] }])

    assert.deepEqual(second.body.contents.map((c: { role: string }) => c.role), ['user', 'model', 'user'])
    assert.equal(second.body.contents[1].parts[0].thoughtSignature, 'sig-wire')
    const fr = second.body.contents[2].parts[0].functionResponse
    assert.equal(fr.name, 'find_appointments')
    assert.equal(fr.response.appointments.length, 1, "Alex Kim's demo booking, as an object rather than a JSON string")
  } finally {
    server.close()
  }
})

test('without GEMINI_API_KEY the failure says so, instead of falling back to Google Cloud credentials', async () => {
  const saved = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  try {
    const s: Session = { id: 's8', messages: [] }
    await assert.rejects(reply(s, 'hi', fakePorts()), /GEMINI_API_KEY is not set/)
    assert.equal(s.messages.length, 0)
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved
  }
})
