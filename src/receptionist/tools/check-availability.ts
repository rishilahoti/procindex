import { SERVICES } from '../../shop.ts';
import { label, now, slotProblem } from '../../scheduling/slots.ts';
import { alts, around, bad, j, service, when } from './helpers.ts';
import { dateP, obj, serviceP, timeP } from './schema.ts';
import type { Tool } from './types.ts';

export const checkAvailability: Tool = {
	name: 'check_availability',
	description:
		'Is a service open at a given day and time? Returns available true/false, and when it is not, the nearest open alternatives (each with date and time you can pass straight to book_appointment). ' +
		'Always call this before telling a caller a time is open or full.',
	parameters: obj({ service: serviceP, date: dateP, time: timeP }, [
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
};
