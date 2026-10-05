// The demo schedule. Used by the in-memory backend (tests, `FAKE=1 npm start`) and by `npm run seed`,
// which writes the same appointments to the real Google Calendar, so both start from the same week.
import type { DateTime } from 'luxon';
import type { NewAppt } from '../../receptionist/ports.ts';
import { at, now, slotProblem } from '../../scheduling/slots.ts';
import {
	LEAD_MIN,
	SERVICES,
	STEP_MIN,
	type ServiceId,
	type Size,
} from '../../shop.ts';

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
