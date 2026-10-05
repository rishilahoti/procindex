import { CALLBACK } from '../../shop.ts';
import { bad, j, normPhone, note, str } from './helpers.ts';
import { obj, phoneP } from './schema.ts';
import type { Tool } from './types.ts';

export const requestCallback: Tool = {
	name: 'request_callback',
	description:
		'Hand the caller to a human. Use for charge/billing/refund/damage complaints, quotes for services not on the menu, anything the facts do not cover, or a caller who wants a person. ' +
		'Needs their name, a number to reach them, and one sentence on what it is about.',
	parameters: obj(
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
};
