// Real Google Calendar + Sheets as the receptionist's ports.
import type { Ports } from '../../receptionist/ports.ts';
import { googleCalendar } from './calendar.ts';
import { googleSheet } from './sheets.ts';

export const googlePorts = (): Ports => ({
	cal: googleCalendar,
	sheet: googleSheet,
});
