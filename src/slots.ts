// Pure scheduling logic: no I/O, no LLM. The model never decides whether a slot is free, this file does.
import { DateTime, Settings } from 'luxon';
import { HORIZON_DAYS, HOURS, LEAD_MIN, STEP_MIN, TZ } from './shop.ts';

Settings.defaultLocale = 'en-US';

export const now = () => DateTime.now().setZone(TZ);
export type Busy = { id?: string; start: number; end: number }; // epoch ms

const DAYS = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
];
const mins = (hhmm: string) =>
	Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
// set() keeps wall-clock time correct across DST; adding minutes to midnight would not
export const at = (day: DateTime, m: number) =>
	day.set({
		hour: Math.floor(m / 60),
		minute: m % 60,
		second: 0,
		millisecond: 0,
	});
export const label = (t: DateTime) => t.toFormat("cccc, LLLL d 'at' h:mm a");
export const pick = (t: DateTime) => ({
	date: t.toISODate() as string,
	time: t.toFormat('HH:mm'),
	label: label(t),
});

/** "thursday" | "thu" | "today" | "tomorrow" | "2026-10-08" -> local midnight, or null. A weekday means its next occurrence (today counts). */
export function parseDay(s: string, t: DateTime = now()): DateTime | null {
	const w = s.trim().toLowerCase();
	const today = t.startOf('day');
	if (w === 'today') return today;
	if (w === 'tomorrow') return today.plus({ days: 1 });
	const i = /^[a-z]{3,}$/.test(w)
		? DAYS.findIndex((d) => d.startsWith(w.slice(0, 3)))
		: -1;
	if (i >= 0) return today.plus({ days: (i + 1 - today.weekday + 7) % 7 });
	const d = DateTime.fromISO(w, { zone: TZ });
	return d.isValid ? d.startOf('day') : null;
}

/** "15:30" | "3:30pm" | "3 pm" | "1530" -> minutes since midnight, or null. */
export function parseTime(s: string): number | null {
	const m = s
		.trim()
		.toLowerCase()
		.match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?$/);
	if (!m) return null;
	let h = Number(m[1]);
	const min = Number(m[2] ?? 0);
	if (m[3]) {
		if (h < 1 || h > 12) return null;
		h = (h % 12) + (m[3] === 'p' ? 12 : 0);
	}
	return h > 23 || min > 59 ? null : h * 60 + min;
}

export const hoursLabel = (weekday: number) => {
	const h = HOURS[weekday];
	const f = (s: string) => DateTime.fromFormat(s, 'HH:mm').toFormat('h:mm a');
	return h ? `${f(h[0])}-${f(h[1])}` : 'closed';
};

/** Why `start` can't hold a job of `minutes`, or null if it can. `ignoreId` is the appointment being moved. */
export function slotProblem(
	start: DateTime,
	minutes: number,
	busy: Busy[],
	ignoreId?: string,
	t: DateTime = now(),
): string | null {
	const h = HOURS[start.weekday];
	if (!h) return `the shop is closed on ${start.toFormat('cccc')}s`;
	const sm = start.hour * 60 + start.minute;
	if (sm < mins(h[0]) || sm + minutes > mins(h[1]))
		return `a ${minutes}-minute job doesn't fit that day's hours (${hoursLabel(start.weekday)})`;
	if (start.minute % STEP_MIN)
		return `appointments start on the hour or half hour`;
	if (start < t.plus({ minutes: LEAD_MIN }))
		return `too soon; bookings need ${LEAD_MIN / 60} hours notice`;
	if (start > t.plus({ days: HORIZON_DAYS }))
		return `too far ahead; bookings go up to ${HORIZON_DAYS} days out`;
	const [a, b] = [start.toMillis(), start.plus({ minutes }).toMillis()];
	return busy.some(
		(x) => !(ignoreId && x.id === ignoreId) && x.start < b && x.end > a,
	)
		? 'that time is already taken'
		: null;
}

/** Nearest open starts: up to 2 on the requested day (closest to `want` minutes), then 1 on each later open day, max 4. */
export function alternatives(
	day: DateTime,
	want: number,
	minutes: number,
	busy: Busy[],
	ignoreId?: string,
	t: DateTime = now(),
): DateTime[] {
	const out: DateTime[] = [];
	for (let i = 0; i < 14 && out.length < 4; i++) {
		const d = day.plus({ days: i });
		const h = HOURS[d.weekday];
		if (!h) continue;
		const open: DateTime[] = [];
		for (let m = mins(h[0]); m + minutes <= mins(h[1]); m += STEP_MIN) {
			const s = at(d, m);
			if (!slotProblem(s, minutes, busy, ignoreId, t)) open.push(s);
		}
		const dist = (s: DateTime) => Math.abs(s.hour * 60 + s.minute - want);
		open.sort((x, y) => dist(x) - dist(y) || x.toMillis() - y.toMillis());
		out.push(...open.slice(0, i === 0 ? 2 : 1));
	}
	return out;
}
