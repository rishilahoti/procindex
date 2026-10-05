// In-memory calendar + sheet. Used by the tests and by `FAKE=1 npm start` to try the agent with no Google account.
// demoAppts() is also what `npm run seed` writes to the real calendar, so both start from the same schedule.
import type { DateTime } from 'luxon';
import { mergeRow, STAMP } from './contacts.ts';
import {
	LEAD_MIN,
	SERVICES,
	STEP_MIN,
	type ServiceId,
	type Size,
} from './shop.ts';
import { at, now, slotProblem } from './slots.ts';
import type { Appt, Calendar, NewAppt, Ports } from './tools.ts';

/** A believable week built around "now": a full Thursday afternoon, a few reschedule candidates, a closure, maybe one today. */
export function demoAppts(t: DateTime = now()): NewAppt[] {
	const today = t.startOf('day');
	const ev = (
		day: DateTime,
		id: ServiceId,
		hhmm: string,
		name: string,
		phone: string,
		vehicle: string,
		size: Size,
	): NewAppt => {
		const s = SERVICES[id];
		const start = at(
			day,
			Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)),
		);
		return {
			title: `${s.name} - ${name}`,
			desc: `${name} +1${phone}\n${vehicle} (${size})\nQuoted $${s.price[size]}\nDemo booking`,
			start: start.toMillis(),
			end: start.plus({ minutes: s.minutes }).toMillis(),
			phone: `+1${phone}`,
			name,
			service: id,
			vehicle,
			size,
			seed: true,
		};
	};
	const thu = today.plus({ days: (4 - today.weekday + 7) % 7 || 7 }); // the coming Thursday, never today
	const mon = today.plus({
		days: 8 + ((1 - today.plus({ days: 8 }).weekday + 7) % 7),
	}); // a Monday 8-14 days out
	const out = [
		ev(
			today.plus({ days: 1 }),
			'interior_wash',
			'10:00',
			'Alex Kim',
			'4155550138',
			'2020 Mazda CX-5',
			'suv',
		),
		ev(
			thu,
			'interior_wash',
			'08:30',
			'Dana Rivera',
			'4155550111',
			'2021 Subaru Outback',
			'suv',
		),
		ev(
			thu,
			'exterior_wash',
			'10:30',
			'Priya Shah',
			'4155550163',
			'Tesla Model 3',
			'car',
		),
		ev(
			thu,
			'full_detail',
			'13:30',
			'Mike Torres',
			'4155550142',
			'2019 Ford F-150',
			'suv',
		), // 1:30-4:30: Thursday 3:30 is full, 4:30 is open
		ev(
			thu.plus({ days: 1 }),
			'interior_wash',
			'09:00',
			'Jamal Carter',
			'4155550177',
			'2018 Honda Accord',
			'car',
		),
		ev(
			thu.plus({ days: 1 }),
			'exterior_wash',
			'14:00',
			'Lena Park',
			'4155550129',
			'2022 BMW X3',
			'suv',
		),
		ev(
			thu.plus({ days: 2 }),
			'full_detail',
			'09:00',
			'Omar Haddad',
			'4155550184',
			'2017 Chevrolet Suburban',
			'xl',
		),
		{
			title: 'CLOSED - inventory day',
			start: mon.toMillis(),
			end: mon.plus({ days: 1 }).toMillis(),
			allDay: true,
			seed: true,
		},
	];
	// One booking in the next 24 hours (the first open slot after the notice window) so "I'm running late" can be tried right after seeding.
	const wash = SERVICES.exterior_wash.minutes;
	let s = t
		.plus({ minutes: LEAD_MIN + 30 })
		.set({ second: 0, millisecond: 0 });
	s = s.plus({ minutes: (STEP_MIN - (s.minute % STEP_MIN)) % STEP_MIN });
	for (; s < t.plus({ hours: 23 }); s = s.plus({ minutes: STEP_MIN })) {
		if (slotProblem(s, wash, out, undefined, t)) continue;
		out.push(
			ev(
				s.startOf('day'),
				'exterior_wash',
				s.toFormat('HH:mm'),
				'Sam Ortiz',
				'4155550155',
				'2017 Toyota Camry',
				'car',
			),
		);
		break;
	}
	return out;
}

export function fakePorts(
	t?: DateTime,
): Ports & { events: Appt[]; rows: Map<string, (string | number)[]> } {
	let n = 0;
	const events: Appt[] = demoAppts(t).map((a) => ({ ...a, id: `evt${++n}` }));
	const rows = new Map<string, (string | number)[]>();
	const cal: Calendar = {
		between: async (from, to) =>
			events
				.filter((e) => e.start < to && e.end > from)
				.sort((a, b) => a.start - b.start),
		upcoming: async (phone, from) =>
			events
				.filter((e) => e.phone === phone && e.end > from)
				.sort((a, b) => a.start - b.start),
		add: async (a) => {
			const e: Appt = { ...a, id: `evt${++n}` };
			events.push(e);
			return e;
		},
		patch: async (id, p) => {
			const e = events.find((x) => x.id === id);
			if (!e) throw new Error(`no event ${id}`);
			if (p.start !== undefined)
				Object.assign(e, { start: p.start, end: p.end });
			if (p.note)
				Object.assign(e, {
					desc: [(e as NewAppt).desc, p.note]
						.filter(Boolean)
						.join('\n'),
				});
		},
		remove: async (id) => {
			events.splice(
				events.findIndex((x) => x.id === id),
				1,
			);
		},
	};
	return {
		cal,
		events,
		rows,
		sheet: {
			log: (e) =>
				void rows.set(
					e.phone,
					mergeRow(
						rows.get(e.phone),
						e,
						(t ?? now()).toFormat(STAMP),
					),
				),
		},
	};
}
