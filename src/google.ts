// Real Google Calendar + Sheets, via a service account. Share the calendar ("Make changes to events") and the
// sheet (Editor) with the service account's email. See README.
import { auth, calendar as gcal, type calendar_v3 } from '@googleapis/calendar';
import { sheets as gsheets } from '@googleapis/sheets';
import { DateTime } from 'luxon';
import { mergeRow, STAMP } from './contacts.ts';
import { TZ } from './shop.ts';
import { now } from './slots.ts';
import type { Appt, Calendar, LogEntry, NewAppt, Ports } from './tools.ts';

function need(k: string): string {
	const v = process.env[k];
	if (!v) throw new Error(`${k} is not set (see README)`);
	return v;
}

let clients: ReturnType<typeof make> | undefined;
function make() {
	const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; // inline JSON for hosts without files; otherwise GOOGLE_APPLICATION_CREDENTIALS is picked up
	const a = new auth.GoogleAuth({
		scopes: [
			'https://www.googleapis.com/auth/calendar',
			'https://www.googleapis.com/auth/spreadsheets',
		],
		...(json && { credentials: JSON.parse(json) }),
	});
	return {
		cal: gcal({ version: 'v3', auth: a }),
		sh: gsheets({ version: 'v4', auth: a }),
		calendarId: need('GOOGLE_CALENDAR_ID'),
		sheetId: need('GOOGLE_SHEET_ID'),
	};
}
export const google = () => (clients ??= make());

const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) =>
	DateTime.fromMillis(ms, { zone: TZ }).toISODate() as string;

/** Calendar event -> something that blocks time, or null if it doesn't (cancelled, or marked "free"). */
function toAppt(ev: calendar_v3.Schema$Event): Appt | null {
	if (
		!ev.id ||
		ev.status === 'cancelled' ||
		ev.transparency === 'transparent'
	)
		return null;
	const p = ev.extendedProperties?.private ?? {};
	const ms = (x?: calendar_v3.Schema$EventDateTime) =>
		x?.date
			? DateTime.fromISO(x.date, { zone: TZ }).toMillis()
			: Date.parse(x?.dateTime ?? '');
	const [start, end] = [ms(ev.start ?? undefined), ms(ev.end ?? undefined)]; // all-day events cover the whole local day
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return {
		id: ev.id,
		start,
		end,
		title: ev.summary ?? '',
		phone: p.phone,
		name: p.name,
		service: p.service,
		vehicle: p.vehicle,
	};
}

const cal: Calendar = {
	async between(from, to) {
		const { cal, calendarId } = google();
		const r = await cal.events.list({
			calendarId,
			timeMin: iso(from),
			timeMax: iso(to),
			singleEvents: true,
			orderBy: 'startTime',
			maxResults: 2500,
		});
		return (r.data.items ?? []).flatMap((e) => toAppt(e) ?? []);
	},
	async upcoming(phone, from) {
		const { cal, calendarId } = google();
		const r = await cal.events.list({
			calendarId,
			timeMin: iso(from),
			privateExtendedProperty: [`phone=${phone}`],
			singleEvents: true,
			orderBy: 'startTime',
			maxResults: 50,
		});
		return (r.data.items ?? []).flatMap((e) => toAppt(e) ?? []);
	},
	async add(a: NewAppt) {
		const { cal, calendarId } = google();
		const when = (ms: number) =>
			a.allDay ? { date: day(ms) } : { dateTime: iso(ms), timeZone: TZ };
		const priv = Object.entries({
			phone: a.phone,
			name: a.name,
			service: a.service,
			vehicle: a.vehicle,
			size: a.size,
			seed: a.seed ? '1' : undefined,
		});
		const r = await cal.events.insert({
			calendarId,
			requestBody: {
				summary: a.title,
				description: a.desc,
				start: when(a.start),
				end: when(a.end),
				extendedProperties: {
					private: Object.fromEntries(
						priv.filter(([, v]) => v),
					) as Record<string, string>,
				},
			},
		});
		return toAppt(r.data) as Appt;
	},
	async patch(id, p) {
		const { cal, calendarId } = google();
		const when = (ms: number) => ({ dateTime: iso(ms), timeZone: TZ });
		const cur = p.note
			? (await cal.events.get({ calendarId, eventId: id })).data
					.description
			: undefined;
		await cal.events.patch({
			calendarId,
			eventId: id,
			requestBody: {
				...(p.start !== undefined &&
					p.end !== undefined && {
						start: when(p.start),
						end: when(p.end),
					}),
				...(p.note && {
					description: [cur, p.note].filter(Boolean).join('\n'),
				}),
			},
		});
	},
	async remove(id) {
		const { cal, calendarId } = google();
		await cal.events.delete({ calendarId, eventId: id });
	},
};

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

export const googlePorts = (): Ports => ({
	cal,
	sheet: {
		log: (e) =>
			void (queue = queue
				.then(() => write(e))
				.catch((err) =>
					console.error('sheet log failed:', e.line, err),
				)),
	},
});
