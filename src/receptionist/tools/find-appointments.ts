import { now } from '../../scheduling/slots.ts';
import { bad, j, L, normPhone } from './helpers.ts';
import { obj, phoneP } from './schema.ts';
import type { Tool } from './types.ts';

export const findAppointments: Tool = {
	name: 'find_appointments',
	description:
		"List a caller's upcoming appointments by phone number. Use it before rescheduling, cancelling or reporting lateness, and whenever they ask about their booking. Only ever discuss what this returns.",
	parameters: obj({ phone: phoneP }, ['phone']),
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
};
