// The Vapi tool-call webhook contract and the chat route guards, over real HTTP against the in-memory backend.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import { fakePorts } from '../src/fake.ts'

process.env.VAPI_WEBHOOK_SECRET = 'test-secret'
const { createApp } = await import('../src/server.ts')
const ports = fakePorts()
const app = createApp(ports).listen(0)
await once(app, 'listening')
const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
after(() => app.close())

const tool = (id: string, name: string, args: object | string) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })
const webhook = (toolCallList: unknown[], type = 'tool-calls') => ({ message: { type, call: { id: 'call_123', customer: { number: '+14155550166' } }, toolCallList } })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const authed = { 'x-cedar-secret': 'test-secret' }

test('webhook rejects a missing or wrong secret', async () => {
  assert.equal((await post('/vapi/tools', webhook([]))).status, 401)
  assert.equal((await post('/vapi/tools', webhook([]), { 'x-cedar-secret': 'nope' })).status, 401)
  assert.equal((await post('/vapi/tools', webhook([]), authed)).status, 200)
})

test('tool-calls: one result per call, matched by toolCallId, each a flat single-line string', async () => {
  const body = webhook([
    tool('tc1', 'check_availability', { service: 'interior_wash', date: 'thursday', time: '15:30' }),
    tool('tc2', 'find_appointments', { phone: '415-555-0138' }), // Alex Kim's demo booking
  ])
  const res = await post('/vapi/tools', body, authed)
  assert.equal(res.status, 200)
  const { results } = (await res.json()) as { results: { name: string; toolCallId: string; result: string }[] }
  assert.deepEqual(results.map((r) => [r.toolCallId, r.name]), [['tc1', 'check_availability'], ['tc2', 'find_appointments']])
  for (const r of results) {
    assert.equal(typeof r.result, 'string')
    assert.ok(!r.result.includes('\n'))
    JSON.parse(r.result)
  }
  assert.equal(JSON.parse(results[1].result).appointments.length, 1)
})

test('arguments may arrive as an object instead of a JSON string', async () => {
  const call = { id: 'tc3', type: 'function', function: { name: 'find_appointments', arguments: { phone: '415-555-0138' } } }
  const { results } = (await (await post('/vapi/tools', webhook([call]), authed)).json()) as { results: { result: string }[] }
  assert.equal(JSON.parse(results[0].result).appointments.length, 1)
})

test('bad arguments or an unknown tool still answer 200 with an error for that call only', async () => {
  const res = await post('/vapi/tools', webhook([tool('bad', 'find_appointments', '{not json'), tool('unk', 'nope', {}), tool('ok', 'find_appointments', { phone: '415-555-0138' })]), authed)
  assert.equal(res.status, 200)
  const { results } = (await res.json()) as { results: { toolCallId: string; result?: string; error?: string }[] }
  const by = Object.fromEntries(results.map((r) => [r.toolCallId, r]))
  assert.match(by.bad.error!, /arguments/)
  assert.match(JSON.parse(by.unk.result!).error, /unknown tool/)
  assert.ok(JSON.parse(by.ok.result!).appointments)
})

test('other Vapi event types are acknowledged and ignored', async () => {
  const res = await post('/vapi/tools', webhook([], 'status-update'), authed)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {})
})

test('caller ID from the call object is the fallback phone for log_call', async () => {
  await post('/vapi/tools', webhook([tool('l1', 'log_call', { note: 'asked about prep requirements' })]), authed)
  const row = ports.rows.get('+14155550166')!
  assert.match(String(row[7]), /asked about prep requirements/)
  assert.equal(row[8], 'call_123', 'the Vapi call id keys the call')
})

test('chat is localhost-only and validates input; the page is served', async () => {
  assert.equal((await post('/chat', { sessionId: 'a' })).status, 400)
  assert.equal((await post('/chat', { sessionId: 'a', message: 'hi' }, { 'x-forwarded-for': '1.2.3.4' })).status, 404)
  assert.equal((await fetch(base + '/', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 404)
  const page = await fetch(base + '/')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Cedar Lane/)
})

test('the webhook is still reachable through a tunnel (it has its own secret)', async () => {
  const res = await post('/vapi/tools', webhook([]), { ...authed, 'x-forwarded-for': '1.2.3.4' })
  assert.equal(res.status, 200)
})
