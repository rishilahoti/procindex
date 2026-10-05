import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { SERVICES, TZ } from '../../src/shop.ts'
import { alternatives, parseDay, parseTime, slotProblem, type Busy } from '../../src/scheduling/slots.ts'

const T = DateTime.fromISO('2026-10-05T10:00', { zone: TZ }) // a Monday
const t = (iso: string) => DateTime.fromISO(iso, { zone: TZ })
const busy = (from: string, to: string, id = 'x'): Busy => ({ id, start: t(from).toMillis(), end: t(to).toMillis() })

test('parseTime', () => {
  const cases: [string, number | null][] = [['15:30', 930], ['3:30pm', 930], ['3 PM', 900], ['12am', 0], ['12pm', 720], ['1530', 930], ['930', 570], ['9', 540], ['25:00', null], ['13pm', null], ['noon', null], ['', null]]
  for (const [s, want] of cases) assert.equal(parseTime(s), want, s)
})

test('parseDay', () => {
  assert.equal(parseDay('thursday', T)?.toISODate(), '2026-10-08')
  assert.equal(parseDay('Thu', T)?.toISODate(), '2026-10-08')
  assert.equal(parseDay('monday', T)?.toISODate(), '2026-10-05') // today counts
  assert.equal(parseDay('tomorrow', T)?.toISODate(), '2026-10-06')
  assert.equal(parseDay('today', T)?.toISODate(), '2026-10-05')
  assert.equal(parseDay('2026-10-08', T)?.toISODate(), '2026-10-08')
  assert.equal(parseDay('2026-10-08T15:30', T)?.toISODate(), '2026-10-08')
  for (const bad of ['', 'garbage', 'oct', 'someday', '2026-13-45']) assert.equal(parseDay(bad, T), null, bad)
})

test('slotProblem: hours, closed days, grid, notice, horizon', () => {
  const ok = (iso: string, min = 90, b: Busy[] = []) => slotProblem(t(iso), min, b, undefined, T)
  assert.equal(ok('2026-10-08T15:30'), null)
  assert.equal(ok('2026-10-08T16:30'), null, 'ends exactly at close')
  assert.match(ok('2026-10-08T16:45')!, /half hour|fit/) // off-grid or runs past close
  assert.match(ok('2026-10-08T17:00')!, /fit/) // would end 6:30 PM
  assert.match(ok('2026-10-08T07:30')!, /fit/) // before opening
  assert.match(ok('2026-10-11T10:00')!, /closed on Sundays/)
  assert.equal(ok('2026-10-10T09:00'), null, 'Saturday opens at 9')
  assert.match(ok('2026-10-10T08:30')!, /fit/)
  assert.equal(ok('2026-10-10T14:30'), null, 'a 90-minute job may end exactly at the 4pm Saturday close')
  assert.match(ok('2026-10-10T15:00')!, /fit/, 'Saturday closes at 4')
  assert.match(ok('2026-10-08T15:15')!, /half hour/)
  assert.match(slotProblem(t('2026-10-05T11:30'), 45, [], undefined, T)!, /too soon/) // 90 min notice < 2h
  assert.equal(slotProblem(t('2026-10-05T12:00'), 45, [], undefined, T), null) // exactly 2h
  assert.match(ok('2027-01-12T10:00')!, /too far/)
})

test('slotProblem: overlap rules', () => {
  const b = [busy('2026-10-08T13:30', '2026-10-08T16:30')]
  const ok = (iso: string, min = 90, ignore?: string) => slotProblem(t(iso), min, b, ignore, T)
  assert.match(ok('2026-10-08T15:30')!, /taken/) // starts inside
  assert.match(ok('2026-10-08T12:30')!, /taken/) // ends inside
  assert.match(ok('2026-10-08T12:00', 180)!, /taken/) // engulfs
  assert.equal(ok('2026-10-08T16:30'), null, 'back to back is fine')
  assert.equal(ok('2026-10-08T12:00'), null, 'ends exactly when the next starts')
  assert.equal(ok('2026-10-08T15:30', 90, 'x'), null, 'a moved appointment ignores itself')
})

test('all-day closure blocks the whole day', () => {
  const b = [{ start: t('2026-10-13T00:00').toMillis(), end: t('2026-10-14T00:00').toMillis() }]
  assert.match(slotProblem(t('2026-10-13T10:00'), 45, b, undefined, T)!, /taken/)
  assert.equal(slotProblem(t('2026-10-14T10:00'), 45, b, undefined, T), null)
})

test('alternatives: nearest same-day first, then later days; skips closed days', () => {
  const b = [busy('2026-10-08T13:30', '2026-10-08T16:30')]
  const a = alternatives(t('2026-10-08T00:00'), 15 * 60 + 30, 90, b, undefined, T).map((x) => x.toFormat('ccc HH:mm'))
  assert.deepEqual(a.slice(0, 2), ['Thu 16:30', 'Thu 12:00']) // closest to 3:30 first
  assert.ok(a.length >= 3 && a.length <= 4)
  const sat = alternatives(t('2026-10-10T00:00'), 15 * 60, 180, [], undefined, T) // Saturday 3pm can't fit 3h; Sunday closed
  assert.ok(sat.every((x) => x.weekday !== 7))
})

test('fuzz: every offered alternative is really bookable', () => {
  const b = [busy('2026-10-08T13:30', '2026-10-08T16:30', 'a'), busy('2026-10-09T09:00', '2026-10-09T10:30', 'b'), busy('2026-10-10T09:00', '2026-10-10T12:00', 'c')]
  let offered = 0
  for (const svc of Object.values(SERVICES))
    for (let d = 0; d < 10; d++)
      for (let m = 6 * 60; m <= 20 * 60; m += 90) {
        const alts = alternatives(T.startOf('day').plus({ days: d }), m, svc.minutes, b, undefined, T)
        for (const alt of alts) assert.equal(slotProblem(alt, svc.minutes, b, undefined, T), null, `${svc.name} ${alt.toISO()}`)
        offered += alts.length
      }
  assert.ok(offered > 300, 'the fuzz actually exercised alternatives')
})
