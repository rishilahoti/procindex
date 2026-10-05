// In-memory calendar + sheet. Used by the tests and by `FAKE=1 npm start` to try the agent with no Google account.
import type { DateTime } from 'luxon';
import type {
	Appt,
	Calendar,
	NewAppt,
	Ports,
} from '../../receptionist/ports.ts';
import { now } from '../../scheduling/slots.ts';
import { mergeRow, STAMP } from '../contacts.ts';
import { demoAppts } from './demo-week.ts';

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
