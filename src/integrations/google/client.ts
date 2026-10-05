// Authenticated Google Calendar + Sheets clients, via a service account. Share the calendar ("Make changes to events")
// and the sheet (Editor) with the service account's email. See docs/setup.md.
import { auth, calendar as gcal } from '@googleapis/calendar';
import { sheets as gsheets } from '@googleapis/sheets';

function need(k: string): string {
	const v = process.env[k];
	if (!v) throw new Error(`${k} is not set (see docs/setup.md)`);
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
