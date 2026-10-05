import { label, now, slotProblem } from '../../scheduling/slots.ts';
import {
	alts,
	around,
	bad,
	j,
	L,
	locked,
	normPhone,
	note,
	when,
} from './helpers.ts';
import { dateP, idP, obj, phoneP, timeP } from './schema.ts';
import type { Tool } from './types.ts';

export const rescheduleAppointment: Tool = {
	name: 'reschedule_appointment',
	description:
		"Move an existing appointment to a new day/time. Checks availability itself (ignoring the appointment's own current time); if the new time isn't open it returns alternatives and changes nothing.",
	parameters: obj(
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
};
