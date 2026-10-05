import { j, normPhone, note, str } from './helpers.ts';
import { obj, phoneP } from './schema.ts';
import type { Tool } from './types.ts';

export const logCall: Tool = {
	name: 'log_call',
	description:
		"Record what came up on this call in the shop's contact sheet: questions answered (pricing, hours, prep, vehicles), outcome, anything the shop should know. " +
		'Call it once near the end of the conversation, or as soon as you have a phone number if the call may end abruptly. Bookings, changes, late notices and callbacks are already logged by their own tools.',
	parameters: obj(
		{
			note: {
				type: 'string',
				description: 'Short summary of what came up',
			},
			phone: { ...phoneP, description: 'Caller phone if known' },
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
};
