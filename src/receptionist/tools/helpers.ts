// Small helpers shared by the tools: reply formatting, argument parsing, slot lookups, the booking lock.
import { DateTime } from 'luxon';
import { SERVICES, TZ, type ServiceId } from '../../shop.ts';
import {
	alternatives,
	at,
	label,
	parseDay,
	parseTime,
	pick,
	type Busy,
} from '../../scheduling/slots.ts';
import type { Calendar, LogEntry, Sheet } from '../ports.ts';
import type { Args } from './types.ts';

export const j = (o: object) => JSON.stringify(o);
export const bad = (error: string) => j({ error });
export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export const L = (ms: number) => label(DateTime.fromMillis(ms, { zone: TZ }));
export const service = (v: unknown) =>
	typeof v === 'string' && Object.hasOwn(SERVICES, v)
		? ([v as ServiceId, SERVICES[v as ServiceId]] as const)
		: null;

/** US/Canada numbers only; anything else is rejected so the agent asks again or hands off. */
export function normPhone(v: unknown): string | null {
	const d = String(v ?? '').replace(/\D/g, '');
	const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
	return /^[2-9]\d{9}$/.test(n) ? `+1${n}` : null;
}

/** The requested day and time as one DateTime, or a message saying what was wrong with the input. */
export function when(a: Args, t: DateTime): DateTime | string {
	const day = parseDay(str(a.date), t);
	const m = parseTime(str(a.time));
	if (!day)
		return 'date must be a weekday name, "today", "tomorrow" or YYYY-MM-DD';
	if (m === null) return 'time must look like 15:30 or 3:30 PM';
	return at(day, m);
}

// Everything that could matter for a start time and its alternatives: that day plus two weeks.
export const around = (cal: Calendar, w: DateTime) =>
	cal.between(
		w.startOf('day').toMillis(),
		w.startOf('day').plus({ days: 15 }).toMillis(),
	);
export const alts = (
	w: DateTime,
	minutes: number,
	busy: Busy[],
	t: DateTime,
	ignoreId?: string,
) =>
	alternatives(
		w.startOf('day'),
		w.hour * 60 + w.minute,
		minutes,
		busy,
		ignoreId,
		t,
	).map(pick);

// ponytail: in-process lock makes check+write atomic for one server; use calendar-side conflict handling if you run several instances.
let chain: Promise<unknown> = Promise.resolve();
export const locked = <T>(fn: () => Promise<T>): Promise<T> => {
	const p = chain.then(fn, fn);
	chain = p.catch(() => {});
	return p;
};

/** Logging is fire and forget: whatever the sheet does, it must never fail the booking that already happened. */
export const note = (sheet: Sheet, e: LogEntry) => {
	try {
		sheet.log(e);
	} catch (err) {
		console.error('sheet log failed:', e.line, err);
	}
};
