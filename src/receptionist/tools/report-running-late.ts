import { LATE_GRACE_MIN } from '../../shop.ts';
import { now } from '../../scheduling/slots.ts';
import { bad, j, L, normPhone, note } from './helpers.ts';
import { obj, phoneP } from './schema.ts';
import type { Tool } from './types.ts';

export const reportRunningLate: Tool = {
	name: 'report_running_late',
	description:
		"The caller is running late for their appointment. Notes it on the calendar for the shop and says whether the appointment can be kept. If it can't, offer to reschedule (reschedule_appointment) or a callback.",
	parameters: obj(
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
};
