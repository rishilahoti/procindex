// The Calendar port, backed by Google Calendar. Each booking carries its phone/name/service as private extended properties.
import { type calendar_v3 } from '@googleapis/calendar';
import { DateTime } from 'luxon';
import type { Appt, Calendar, NewAppt } from '../../receptionist/ports.ts';
import { TZ } from '../../shop.ts';
import { google } from './client.ts';

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

export const googleCalendar: Calendar = {
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
