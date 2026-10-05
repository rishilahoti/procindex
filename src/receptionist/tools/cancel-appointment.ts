import { now } from '../../scheduling/slots.ts';
import { bad, j, L, locked, normPhone, note } from './helpers.ts';
import { idP, obj, phoneP } from './schema.ts';
import type { Tool } from './types.ts';

export const cancelAppointment: Tool = {
	name: 'cancel_appointment',
	description:
		'Cancel an existing appointment. Confirm with the caller first.',
	parameters: obj({ phone: phoneP, event_id: idP }, ['phone', 'event_id']),
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
};
