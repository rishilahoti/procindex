import { SERVICES, SIZES } from '../../shop.ts';
import { label, now, slotProblem } from '../../scheduling/slots.ts';
import {
	alts,
	around,
	bad,
	j,
	locked,
	normPhone,
	note,
	service,
	str,
	when,
} from './helpers.ts';
import { dateP, obj, phoneP, serviceP, timeP } from './schema.ts';
import type { Tool } from './types.ts';

export const bookAppointment: Tool = {
	name: 'book_appointment',
	description:
		'Book an appointment. Only after the caller has confirmed service, vehicle, day/time, name and phone. Re-checks availability itself; if the slot was just taken it returns alternatives instead of booking. ' +
		'Call it once per booking.',
	parameters: obj(
		{
			service: serviceP,
			size: {
				type: 'string',
				enum: [...SIZES],
				description: 'Vehicle size class from the facts: car, suv or xl',
			},
			vehicle: {
				type: 'string',
				description: 'Year/make/model or type, e.g. "2019 Honda Civic"',
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
};
