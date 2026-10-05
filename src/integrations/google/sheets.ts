// The Sheet port, backed by the "Contacts" tab of a Google Sheet. Row-merging logic lives in ../contacts.ts.
import type { LogEntry, Sheet } from '../../receptionist/ports.ts';
import { now } from '../../scheduling/slots.ts';
import { mergeRow, STAMP } from '../contacts.ts';
import { google } from './client.ts';

// Sheet writes are queued and awaited by nobody: the caller never waits on logging, and a logging failure never fails a booking.
let queue: Promise<void> = Promise.resolve();
export const flushSheet = () => queue;

async function write(e: LogEntry) {
	const { sh, sheetId } = google();
	// ponytail: reads the whole tab per write; fine for thousands of callers, switch to a lookup column or a DB beyond ~10k rows.
	const rows =
		(
			await sh.spreadsheets.values.get({
				spreadsheetId: sheetId,
				range: 'Contacts!A:I',
			})
		).data.values ?? [];
	const i = rows.findIndex((r, k) => k > 0 && r[0] === e.phone); // row 0 is the header
	const row = mergeRow(i > 0 ? rows[i] : undefined, e, now().toFormat(STAMP));
	const base = {
		spreadsheetId: sheetId,
		valueInputOption: 'RAW',
		requestBody: { values: [row] },
	}; // RAW keeps "+1415..." as text
	if (i > 0)
		await sh.spreadsheets.values.update({
			...base,
			range: `Contacts!A${i + 1}:I${i + 1}`,
		});
	else
		await sh.spreadsheets.values.append({
			...base,
			range: 'Contacts!A:I',
			insertDataOption: 'INSERT_ROWS',
		});
}

export const googleSheet: Sheet = {
	log: (e) =>
		void (queue = queue
			.then(() => write(e))
			.catch((err) => console.error('sheet log failed:', e.line, err))),
};
