// The agent's hands. Shared by the chat agent (agent.ts) and the Vapi webhook (server.ts), so text and voice
// behave identically. Every tool returns one line of JSON; the model reads it, never computes availability itself.
import { DateTime } from 'luxon';
import {
	CALLBACK,
	LATE_GRACE_MIN,
	SERVICES,
	SIZES,
	TZ,
	type ServiceId,
	type Size,
} from './shop.ts';
import {
	alternatives,
	at,
	label,
	now,
	parseDay,
	parseTime,
	pick,
	slotProblem,
	type Busy,
} from './slots.ts';

export type Appt = Busy & {
	id: string;
	title: string;
	phone?: string;
	name?: string;
	service?: string;
	vehicle?: string;
};
export type NewAppt = Omit<Appt, 'id'> & {
	desc?: string;
	size?: string;
	seed?: boolean;
	allDay?: boolean;
};
export interface Calendar {
	/** Every event that blocks time in [from, to): bookings, closures, hand-made events. */
	between(from: number, to: number): Promise<Appt[]>;
	/** This caller's bookings that haven't ended by `from`, soonest first. */
	upcoming(phone: string, from: number): Promise<Appt[]>;
	add(a: NewAppt): Promise<Appt>;
	patch(
		id: string,
		p: { start?: number; end?: number; note?: string },
	): Promise<void>;
	remove(id: string): Promise<void>;
}
export type LogEntry = {
	phone: string;
	callId: string;
	line: string;
	name?: string;
	vehicle?: string;
	callback?: string;
};
export interface Sheet {
	log(e: LogEntry): void;
}
/** Logging is fire and forget: whatever the sheet does, it must never fail the booking that already happened. */
const note = (sheet: Sheet, e: LogEntry) => {
	try {
		sheet.log(e);
	} catch (err) {
		console.error('sheet log failed:', e.line, err);
	}
};
export type Ports = { cal: Calendar; sheet: Sheet };
export type Ctx = { callId: string; callerNumber?: string; now?: DateTime };

type Args = Record<string, unknown>;
const j = (o: object) => JSON.stringify(o);
const bad = (error: string) => j({ error });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const L = (ms: number) => label(DateTime.fromMillis(ms, { zone: TZ }));
const service = (v: unknown) =>
	typeof v === 'string' && Object.hasOwn(SERVICES, v)
		? ([v as ServiceId, SERVICES[v as ServiceId]] as const)
		: null;

/** US/Canada numbers only; anything else is rejected so the agent asks again or hands off. */
export function normPhone(v: unknown): string | null {
	const d = String(v ?? '').replace(/\D/g, '');
	const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
	return /^[2-9]\d{9}$/.test(n) ? `+1${n}` : null;
}

function when(a: Args, t: DateTime): DateTime | string {
	const day = parseDay(str(a.date), t);
	const m = parseTime(str(a.time));
	if (!day)
		return 'date must be a weekday name, "today", "tomorrow" or YYYY-MM-DD';
	if (m === null) return 'time must look like 15:30 or 3:30 PM';
	return at(day, m);
}

// Everything that could matter for a start time and its alternatives: that day plus two weeks.
const around = (cal: Calendar, w: DateTime) =>
	cal.between(
		w.startOf('day').toMillis(),
		w.startOf('day').plus({ days: 15 }).toMillis(),
	);
const alts = (
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
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
	const p = chain.then(fn, fn);
	chain = p.catch(() => {});
	return p;
};

type Prop = {
	type: 'string' | 'number';
	description?: string;
	enum?: string[];
};
const phoneP: Prop = {
	type: 'string',
	description: 'Caller phone number, digits as spoken or typed',
};
const dateP: Prop = {
	type: 'string',
	description:
		'A weekday name exactly as the caller said it ("thursday"), "today", "tomorrow", or YYYY-MM-DD. Do not convert weekday names yourself.',
};
const timeP: Prop = {
	type: 'string',
	description: 'Start time, 24-hour HH:MM, e.g. 15:30',
};
const serviceP: Prop = {
	type: 'string',
	enum: Object.keys(SERVICES),
	description: 'Service id',
};
const idP: Prop = {
	type: 'string',
	description: 'Appointment id from find_appointments',
};
const obj = (properties: Record<string, Prop>, required: string[]) => ({
	type: 'object' as const,
	properties,
	required,
});

export const TOOLS: {
	name: string;
	description: string;
	input_schema: ReturnType<typeof obj>;
	run: (a: Args, c: Ctx, p: Ports) => Promise<string>;
}[] = [
	{
		name: 'check_availability',
		description:
			'Is a service open at a given day and time? Returns available true/false, and when it is not, the nearest open alternatives (each with date and time you can pass straight to book_appointment). ' +
			'Always call this before telling a caller a time is open or full.',
		input_schema: obj({ service: serviceP, date: dateP, time: timeP }, [
			'service',
			'date',
			'time',
		]),
		run: async (a, c, { cal }) => {
			const t = c.now ?? now();
			const svc = service(a.service);
			if (!svc)
				return bad(
					`service must be one of: ${Object.keys(SERVICES).join(', ')}`,
				);
			const w = when(a, t);
			if (typeof w === 'string') return bad(w);
			const busy = await around(cal, w);
			const why = slotProblem(w, svc[1].minutes, busy, undefined, t);
			return j({
				service: svc[1].name,
				requested: label(w),
				available: !why,
				...(why && {
					why,
					alternatives: alts(w, svc[1].minutes, busy, t),
				}),
			});
		},
	},
	{
		name: 'book_appointment',
		description:
			'Book an appointment. Only after the caller has confirmed service, vehicle, day/time, name and phone. Re-checks availability itself; if the slot was just taken it returns alternatives instead of booking. ' +
			'Call it once per booking.',
		input_schema: obj(
			{
				service: serviceP,
				size: {
					type: 'string',
					enum: [...SIZES],
					description:
						'Vehicle size class from the facts: car, suv or xl',
				},
				vehicle: {
					type: 'string',
					description:
						'Year/make/model or type, e.g. "2019 Honda Civic"',
				},
				date: dateP,
				time: timeP,
				name: { type: 'string', description: 'Caller name' },
				phone: phoneP,
			},
			['service', 'size', 'vehicle', 'date', 'time', 'name', 'phone'],
		),
		run: async (a, c, { cal, sheet }) => {
			const t = c.now ?? now();
			const svc = service(a.service);
			const size = SIZES.find((s) => s === a.size);
			const [name, vehicle, phone] = [
				str(a.name),
				str(a.vehicle),
				normPhone(a.phone),
			];
			if (!svc)
				return bad(
					`service must be one of: ${Object.keys(SERVICES).join(', ')}`,
				);
			if (!size) return bad('size must be car, suv or xl');
			if (!name) return bad('need the caller name');
			if (!phone)
				return bad(
					'need a valid 10-digit US phone number; ask the caller to repeat it',
				);
			const w = when(a, t);
			if (typeof w === 'string') return bad(w);
			const [id, s] = svc;
			return locked(async () => {
				const busy = await around(cal, w);
				const price = `$${s.price[size]}`;
				const dup = busy.find(
					(b) =>
						b.phone === phone &&
						b.service === id &&
						b.start === w.toMillis(),
				);
				if (dup)
					return j({
						booked: true,
						alreadyBooked: true,
						service: s.name,
						when: label(w),
						price,
					});
				const why = slotProblem(w, s.minutes, busy, undefined, t);
				if (why)
					return j({
						booked: false,
						why,
						alternatives: alts(w, s.minutes, busy, t),
					});
				await cal.add({
					title: `${s.name} - ${name}`,
					desc: `${name} ${phone}\n${vehicle} (${size})\nQuoted ${price}\nBooked by the AI receptionist`,
					start: w.toMillis(),
					end: w.plus({ minutes: s.minutes }).toMillis(),
					phone,
					name,
					service: id,
					vehicle,
					size,
				});
				note(sheet, {
					phone,
					callId: c.callId,
					name,
					vehicle,
					line: `Booked ${s.name}, ${label(w)} (${vehicle}, ${price})`,
				});
				return j({
					booked: true,
					service: s.name,
					when: label(w),
					ends: w.plus({ minutes: s.minutes }).toFormat('h:mm a'),
					price,
					name,
				});
			});
		},
	},
	{
		name: 'find_appointments',
		description:
			"List a caller's upcoming appointments by phone number. Use it before rescheduling, cancelling or reporting lateness, and whenever they ask about their booking. Only ever discuss what this returns.",
		input_schema: obj({ phone: phoneP }, ['phone']),
		run: async (a, c, { cal }) => {
			const phone = normPhone(a.phone);
			if (!phone) return bad('need a valid 10-digit US phone number');
			const list = await cal.upcoming(phone, (c.now ?? now()).toMillis());
			return j({
				appointments: list.map((x) => ({
					id: x.id,
					what: x.title,
					when: L(x.start),
					vehicle: x.vehicle,
				})),
			});
		},
	},
	{
		name: 'reschedule_appointment',
		description:
			"Move an existing appointment to a new day/time. Checks availability itself (ignoring the appointment's own current time); if the new time isn't open it returns alternatives and changes nothing.",
		input_schema: obj(
			{ phone: phoneP, event_id: idP, date: dateP, time: timeP },
			['phone', 'event_id', 'date', 'time'],
		),
		run: async (a, c, { cal, sheet }) => {
			const t = c.now ?? now();
			const phone = normPhone(a.phone);
			const w = when(a, t);
			if (!phone) return bad('need a valid 10-digit US phone number');
			if (typeof w === 'string') return bad(w);
			return locked(async () => {
				const mine = (await cal.upcoming(phone, t.toMillis())).find(
					(x) => x.id === a.event_id,
				);
				if (!mine)
					return bad(
						'no upcoming appointment with that id for that phone number',
					);
				const minutes = (mine.end - mine.start) / 60000;
				const busy = await around(cal, w);
				const why = slotProblem(w, minutes, busy, mine.id, t);
				if (why)
					return j({
						rescheduled: false,
						why,
						alternatives: alts(w, minutes, busy, t, mine.id),
					});
				await cal.patch(mine.id, {
					start: w.toMillis(),
					end: w.plus({ minutes }).toMillis(),
					note: `Moved from ${L(mine.start)} at the caller's request (${t.toFormat('MMM d, h:mm a')})`,
				});
				note(sheet, {
					phone,
					callId: c.callId,
					line: `Moved ${mine.title} from ${L(mine.start)} to ${label(w)}`,
				});
				return j({
					rescheduled: true,
					from: L(mine.start),
					to: label(w),
				});
			});
		},
	},
	{
		name: 'cancel_appointment',
		description:
			'Cancel an existing appointment. Confirm with the caller first.',
		input_schema: obj({ phone: phoneP, event_id: idP }, [
			'phone',
			'event_id',
		]),
		run: async (a, c, { cal, sheet }) => {
			const phone = normPhone(a.phone);
			if (!phone) return bad('need a valid 10-digit US phone number');
			return locked(async () => {
				const mine = (
					await cal.upcoming(phone, (c.now ?? now()).toMillis())
				).find((x) => x.id === a.event_id);
				if (!mine)
					return bad(
						'no upcoming appointment with that id for that phone number',
					);
				await cal.remove(mine.id);
				note(sheet, {
					phone,
					callId: c.callId,
					line: `Cancelled ${mine.title}, ${L(mine.start)}`,
				});
				return j({
					cancelled: true,
					was: `${mine.title}, ${L(mine.start)}`,
				});
			});
		},
	},
	{
		name: 'report_running_late',
		description:
			"The caller is running late for their appointment. Notes it on the calendar for the shop and says whether the appointment can be kept. If it can't, offer to reschedule (reschedule_appointment) or a callback.",
		input_schema: obj(
			{
				phone: phoneP,
				minutes: {
					type: 'number',
					description: 'About how many minutes late',
				},
			},
			['phone', 'minutes'],
		),
		run: async (a, c, { cal, sheet }) => {
			const t = c.now ?? now();
			const phone = normPhone(a.phone);
			const late = Number(a.minutes);
			if (!phone) return bad('need a valid 10-digit US phone number');
			if (!(late > 0 && late < 600))
				return bad('minutes must be a positive number');
			const mine = (
				await cal.upcoming(phone, t.minus({ minutes: 30 }).toMillis())
			)[0];
			if (!mine || mine.start > t.plus({ hours: 24 }).toMillis())
				return bad(
					`no appointment in the next 24 hours for that number${mine ? `; their next is ${L(mine.start)}` : ''}`,
				);
			const next = (await cal.between(mine.end, mine.end + 12 * 3600e3))
				.filter((x) => x.id !== mine.id && x.start >= mine.end)
				.sort((x, y) => x.start - y.start)[0];
			const slack = next ? (next.start - mine.end) / 60000 : Infinity;
			const keep = late <= LATE_GRACE_MIN && late <= slack;
			await cal.patch(mine.id, {
				note: `Caller says about ${late} min late (${t.toFormat('h:mm a')})${keep ? '' : '. May need to reschedule.'}`,
			});
			note(sheet, {
				phone,
				callId: c.callId,
				line: `Running ~${late} min late for ${L(mine.start)} (${keep ? 'kept' : 'needs reschedule'})`,
			});
			const why =
				late > LATE_GRACE_MIN
					? `more than ${LATE_GRACE_MIN} minutes late`
					: 'would run into the next booking';
			return j({
				appointment: L(mine.start),
				id: mine.id,
				keepAppointment: keep,
				...(!keep && { why }),
			});
		},
	},
	{
		name: 'request_callback',
		description:
			'Hand the caller to a human. Use for charge/billing/refund/damage complaints, quotes for services not on the menu, anything the facts do not cover, or a caller who wants a person. ' +
			'Needs their name, a number to reach them, and one sentence on what it is about.',
		input_schema: obj(
			{
				name: { type: 'string' },
				phone: phoneP,
				reason: {
					type: 'string',
					description:
						'One sentence the shop can act on without calling to ask what this is about',
				},
			},
			['name', 'phone', 'reason'],
		),
		run: async (a, c, { sheet }) => {
			const [name, phone, reason] = [
				str(a.name),
				normPhone(a.phone),
				str(a.reason),
			];
			if (!name || !phone || !reason)
				return bad(
					'need the caller name, a valid 10-digit US phone number, and a reason',
				);
			note(sheet, {
				phone,
				callId: c.callId,
				name,
				line: `HANDOFF, callback requested: ${reason}`,
				callback: reason,
			});
			return j({ ok: true, tellTheCaller: CALLBACK });
		},
	},
	{
		name: 'log_call',
		description:
			"Record what came up on this call in the shop's contact sheet: questions answered (pricing, hours, prep, vehicles), outcome, anything the shop should know. " +
			'Call it once near the end of the conversation, or as soon as you have a phone number if the call may end abruptly. Bookings, changes, late notices and callbacks are already logged by their own tools.',
		input_schema: obj(
			{
				note: {
					type: 'string',
					description: 'Short summary of what came up',
				},
				phone: { type: 'string', description: 'Caller phone if known' },
				name: { type: 'string' },
			},
			['note'],
		),
		run: async (a, c, { sheet }) => {
			const phone = normPhone(a.phone) ?? normPhone(c.callerNumber);
			if (!phone)
				return j({
					logged: false,
					why: 'no phone number for this caller, nothing to file it under',
				});
			note(sheet, {
				phone,
				callId: c.callId,
				name: str(a.name) || undefined,
				line: str(a.note),
			});
			return j({ logged: true });
		},
	},
];

export async function runTool(
	name: string,
	args: unknown,
	ctx: Ctx,
	ports: Ports,
): Promise<string> {
	const tool = TOOLS.find((t) => t.name === name);
	if (!tool) return bad(`unknown tool ${name}`);
	try {
		return await tool.run(
			(args && typeof args === 'object' ? args : {}) as Args,
			ctx,
			ports,
		);
	} catch (e) {
		console.error(`tool ${name} failed:`, e);
		return bad(
			'internal error; apologize briefly and offer a callback (request_callback)',
		);
	}
}
