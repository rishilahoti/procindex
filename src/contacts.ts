// The Contacts tab: one row per caller (keyed by phone), one appended line in Call Log per thing that came up.
// Pure so the Google writer and the test fake share exactly the same row logic.
import type { LogEntry } from './tools.ts';

export const STAMP = 'yyyy-LL-dd HH:mm';
export const HEADERS = [
	'Phone',
	'Name',
	'Vehicle',
	'Calls',
	'First Call',
	'Last Call',
	'Callback Needed',
	'Call Log',
	'Last Call ID',
];

/** Fold one log entry into a caller's existing row (or start a new one). `Calls` counts distinct calls, not log lines. */
export function mergeRow(
	prev: unknown[] | undefined,
	e: LogEntry,
	stamp: string,
): (string | number)[] {
	const p = (prev ?? []).map((x) => (x == null ? '' : String(x)));
	const calls = Number(p[3]) || 0;
	return [
		e.phone,
		e.name || p[1] || '',
		e.vehicle || p[2] || '',
		p[8] === e.callId ? calls : calls + 1,
		p[4] || stamp,
		stamp,
		e.callback ? `YES: ${e.callback}` : p[6] || '',
		[p[7], `${stamp} ${e.line}`].filter(Boolean).join('\n'),
		e.callId,
	];
}
