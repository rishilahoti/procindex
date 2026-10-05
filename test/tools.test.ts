import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { fakePorts } from '../src/fake.ts'
import { TZ } from '../src/shop.ts'
import { normPhone, runTool, type NewAppt } from '../src/tools.ts'

const T = DateTime.fromISO('2026-10-05T10:00', { zone: TZ }) // Monday; the demo week is built around this
const ms = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toMillis()
const world = () => fakePorts(T)
const call = async (p: ReturnType<typeof world>, name: string, args: unknown, callId = 'call-1') => JSON.parse(await runTool(name, args, { callId, now: T }, p))
const sara = { name: 'Sara', phone: '415-555-0190', vehicle: '2019 Honda Civic', size: 'car' }
const civic = (date: string, time: string, service = 'interior_wash') => ({ service, date, time, ...sara })

test('normPhone', () => {
  const ok: [string, string][] = [['415-555-0190', '+14155550190'], ['(415) 555 0190', '+14155550190'], ['+1 415 555 0190', '+14155550190'], ['1-415-555-0190', '+14155550190'], ['4155550190', '+14155550190']]
  for (const [s, want] of ok) assert.equal(normPhone(s), want, s)
  for (const bad of ['', '12345', '055-555-0190', '+44 20 7946 0958', '415555019', undefined, null]) assert.equal(normPhone(bad), null, String(bad))
  assert.equal(normPhone(4155550190), '+14155550190')
})

test('spec example: Thursday 3:30 is full, 4:30 is offered and books, then it is full too', async () => {
  const p = world()
  const r = await call(p, 'check_availability', { service: 'interior_wash', date: 'thursday', time: '15:30' })
  assert.equal(r.available, false)
  assert.match(r.why, /taken/)
  assert.equal(r.alternatives[0].label, 'Thursday, October 8 at 4:30 PM')

  const b = await call(p, 'book_appointment', { ...civic(r.alternatives[0].date, r.alternatives[0].time) })
  assert.equal(b.booked, true)
  assert.equal(b.price, '$140')
  assert.equal(b.ends, '6:00 PM')
  const ev = p.events.find((e) => e.phone === '+14155550190')!
  assert.equal(ev.start, ms('2026-10-08T16:30'))
  assert.equal(ev.end, ms('2026-10-08T18:00'))
  assert.equal(ev.service, 'interior_wash')

  const row = p.rows.get('+14155550190')!
  assert.equal(row[1], 'Sara')
  assert.equal(row[2], '2019 Honda Civic')
  assert.equal(row[3], 1)
  assert.match(String(row[7]), /Booked Interior Detail & Wash, Thursday, October 8 at 4:30 PM/)

  assert.equal((await call(p, 'check_availability', { service: 'interior_wash', date: 'thursday', time: '16:30' })).available, false)
})

test('booking the same slot twice does not double-book or double-log the person', async () => {
  const p = world()
  await call(p, 'book_appointment', civic('thursday', '16:30'))
  const again = await call(p, 'book_appointment', civic('thursday', '16:30'))
  assert.equal(again.booked, true)
  assert.equal(again.alreadyBooked, true)
  assert.equal(p.events.filter((e) => e.phone === '+14155550190').length, 1)
})

test('booking a taken slot books nothing and offers alternatives', async () => {
  const p = world()
  const before = p.events.length
  const r = await call(p, 'book_appointment', civic('thursday', '15:30'))
  assert.equal(r.booked, false)
  assert.ok(r.alternatives.length >= 1)
  assert.equal(p.events.length, before)
  assert.equal(p.rows.size, 0, 'nothing booked, nothing logged')
})

test('two callers racing for the last slot: exactly one wins', async () => {
  const p = world()
  const a = { ...civic('friday', '12:00'), phone: '415-555-0001', name: 'A' }
  const b = { ...civic('friday', '12:00'), phone: '415-555-0002', name: 'B' }
  const res = await Promise.all([call(p, 'book_appointment', a), call(p, 'book_appointment', b)])
  assert.equal(res.filter((r) => r.booked).length, 1)
  assert.equal(p.events.filter((e) => e.start === ms('2026-10-09T12:00')).length, 1)
})

test('the notice window, closed days, closures and hours are enforced for booking', async () => {
  const p = world()
  const why = async (date: string, time: string, service = 'interior_wash') => (await call(p, 'book_appointment', civic(date, time, service))).why as string
  assert.match(await why('today', '11:00'), /too soon/)
  assert.match(await why('sunday', '10:00'), /closed on Sundays/)
  assert.match(await why('2026-10-19', '10:00'), /taken/, 'all-day closure event')
  assert.match(await why('thursday', '17:00'), /fit/)
  assert.match(await why('thursday', '15:00', 'full_detail'), /fit|taken/)
  assert.equal(p.events.length, world().events.length, 'none of those booked anything')
})

test('input validation: bad service, size, phone, name, date, time, args never throw', async () => {
  const p = world()
  const err = async (name: string, args: unknown) => (await call(p, name, args)).error as string
  assert.match(await err('check_availability', { service: 'toString', date: 'thursday', time: '15:30' }), /service/)
  assert.match(await err('check_availability', { service: 'full_detail', date: 'blah', time: '15:30' }), /date/)
  assert.match(await err('check_availability', { service: 'full_detail', date: 'thursday', time: '25:61' }), /time/)
  assert.match(await err('book_appointment', { ...civic('thursday', '16:30'), size: 'huge' }), /size/)
  assert.match(await err('book_appointment', { ...civic('thursday', '16:30'), phone: '12345' }), /phone/)
  assert.match(await err('book_appointment', { ...civic('thursday', '16:30'), name: '  ' }), /name/)
  assert.match(await err('book_appointment', null), /service/)
  assert.match(await err('nope', {}), /unknown tool/)
  assert.equal(p.events.length, world().events.length)
})

test('weekday words and ISO dates resolve the same way', async () => {
  const p = world()
  const a = await call(p, 'check_availability', { service: 'exterior_wash', date: 'thursday', time: '9am' })
  const b = await call(p, 'check_availability', { service: 'exterior_wash', date: '2026-10-08', time: '09:00' })
  assert.deepEqual(a, b)
})

test('reschedule: a move may overlap its own old slot; a taken target changes nothing', async () => {
  const p = world()
  const alex = (await call(p, 'find_appointments', { phone: '415-555-0138' })).appointments[0]
  assert.match(alex.when, /Tuesday, October 6 at 10:00 AM/)

  const clash = await call(p, 'reschedule_appointment', { phone: '415-555-0138', event_id: alex.id, date: 'thursday', time: '15:30' })
  assert.equal(clash.rescheduled, false)
  assert.ok(clash.alternatives.length >= 1)
  assert.equal(p.events.find((e) => e.id === alex.id)!.start, ms('2026-10-06T10:00'), 'unchanged')

  const shift = await call(p, 'reschedule_appointment', { phone: '415-555-0138', event_id: alex.id, date: 'tomorrow', time: '10:30' })
  assert.equal(shift.rescheduled, true)
  const ev = p.events.find((e) => e.id === alex.id)!
  assert.deepEqual([ev.start, ev.end], [ms('2026-10-06T10:30'), ms('2026-10-06T12:00')], 'same 90-minute length')
  assert.match((ev as NewAppt).desc ?? '', /Moved from Tuesday, October 6 at 10:00 AM/)
  assert.match(String(p.rows.get('+14155550138')![7]), /Moved .* to Tuesday, October 6 at 10:30 AM/)
})

test("callers can only touch their own appointments, even with a valid event id", async () => {
  const p = world()
  const dana = (await call(p, 'find_appointments', { phone: '415-555-0111' })).appointments[0]
  const stranger = '415-555-0999'
  assert.deepEqual((await call(p, 'find_appointments', { phone: stranger })).appointments, [])
  assert.match((await call(p, 'cancel_appointment', { phone: stranger, event_id: dana.id })).error, /no upcoming appointment/)
  assert.match((await call(p, 'reschedule_appointment', { phone: stranger, event_id: dana.id, date: 'friday', time: '12:00' })).error, /no upcoming appointment/)
  assert.ok(p.events.some((e) => e.id === dana.id))
  assert.equal(p.events.find((e) => e.id === dana.id)!.start, ms('2026-10-08T08:30'))
})

test('cancel frees the slot and is logged', async () => {
  const p = world()
  assert.equal((await call(p, 'check_availability', { service: 'exterior_wash', date: 'thursday', time: '10:30' })).available, false)
  const priya = (await call(p, 'find_appointments', { phone: '415-555-0163' })).appointments[0]
  assert.equal((await call(p, 'cancel_appointment', { phone: '415-555-0163', event_id: priya.id })).cancelled, true)
  assert.equal((await call(p, 'check_availability', { service: 'exterior_wash', date: 'thursday', time: '10:30' })).available, true)
  assert.match(String(p.rows.get('+14155550163')![7]), /Cancelled Exterior Hand Wash & Dry - Priya Shah/)
})

test('running late: within grace keeps the slot, beyond it or into the next booking does not; the shop is told', async () => {
  const p = world()
  const sam = '415-555-0155' // demo booking today 12:30-1:15 PM
  const ok = await call(p, 'report_running_late', { phone: sam, minutes: 10 })
  assert.equal(ok.keepAppointment, true)
  assert.match((p.events.find((e) => e.id === ok.id) as NewAppt).desc ?? '', /about 10 min late/)
  assert.match(String(p.rows.get('+14155550155')![7]), /Running ~10 min late.*kept/)

  const long = await call(p, 'report_running_late', { phone: sam, minutes: 20 })
  assert.equal(long.keepAppointment, false)
  assert.match(long.why, /more than 15/)

  await p.cal.add({ title: 'next car', start: ms('2026-10-05T13:15'), end: ms('2026-10-05T14:00') })
  const tight = await call(p, 'report_running_late', { phone: sam, minutes: 5 })
  assert.equal(tight.keepAppointment, false)
  assert.match(tight.why, /next booking/)

  assert.match((await call(p, 'report_running_late', { phone: '415-555-0142', minutes: 10 })).error, /next 24 hours.*Thursday, October 8/)
  assert.match((await call(p, 'report_running_late', { phone: sam, minutes: 0 })).error, /minutes/)
})

test('handoff: a charge complaint becomes a flagged callback row, and bad input is refused', async () => {
  const p = world()
  const r = await call(p, 'request_callback', { name: 'Pat', phone: '415 555 0123', reason: 'Charged $75 surcharge on the Oct 1 interior detail, wants it explained' })
  assert.equal(r.ok, true)
  assert.match(r.tellTheCaller, /call them back/)
  const row = p.rows.get('+14155550123')!
  assert.match(String(row[6]), /^YES: Charged \$75/)
  assert.match(String(row[7]), /HANDOFF/)
  assert.match((await call(p, 'request_callback', { name: 'Pat', phone: '123', reason: 'x' })).error, /phone/)
  assert.match((await call(p, 'request_callback', { name: 'Pat', phone: '415 555 0123', reason: '' })).error, /reason/)
  assert.equal(p.rows.size, 1)
})

test('contact row: one row per caller, Calls counts calls not log lines, name and callback flag survive later calls', async () => {
  const p = world()
  await call(p, 'request_callback', { name: 'Pat', phone: '415 555 0123', reason: 'billing question' }, 'call-A')
  await call(p, 'log_call', { note: 'asked about hours', phone: '415 555 0123' }, 'call-A')
  assert.equal(p.rows.get('+14155550123')![3], 1)
  await call(p, 'log_call', { note: 'asked about prep', phone: '415 555 0123' }, 'call-B')
  const row = p.rows.get('+14155550123')!
  assert.equal(row[3], 2)
  assert.equal(row[1], 'Pat', 'a later call that gives no name keeps the old one')
  assert.match(String(row[6]), /^YES: billing question/, 'callback flag is not cleared by the agent')
  assert.equal(String(row[7]).split('\n').length, 3)
  assert.equal(p.rows.size, 1)
})

test('log_call falls back to caller ID, and says so when there is nobody to file it under', async () => {
  const p = world()
  assert.equal(JSON.parse(await runTool('log_call', { note: 'asked about SUV pricing' }, { callId: 'v1', callerNumber: '+14155550166', now: T }, p)).logged, true)
  assert.match(String(p.rows.get('+14155550166')![7]), /asked about SUV pricing/)
  assert.equal((await call(p, 'log_call', { note: 'anonymous chat' })).logged, false)
})

test('a failing sheet never fails a booking that already happened', async () => {
  const p = world()
  p.sheet.log = () => {
    throw new Error('sheets down')
  }
  const r = await call(p, 'book_appointment', civic('thursday', '16:30'))
  assert.equal(r.booked, true)
  assert.ok(p.events.some((e) => e.phone === '+14155550190'))
})
