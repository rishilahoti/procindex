// What the receptionist needs from the outside world: a calendar and a contact sheet.
// integrations/google/ implements these for real, integrations/fake/ in memory (tests, FAKE=1).
import type { Busy } from '../scheduling/slots.ts';

export type Appt = Busy & {
	id: string;
	title: string;
	phone?: string;
	name?: string;
	service?: string;
	vehicle?: string;
};
export type NewAppt = Omit<Appt, 'id'> & {
	desc?: string;
	size?: string;
	seed?: boolean;
	allDay?: boolean;
};
export interface Calendar {
	/** Every event that blocks time in [from, to): bookings, closures, hand-made events. */
	between(from: number, to: number): Promise<Appt[]>;
	/** This caller's bookings that haven't ended by `from`, soonest first. */
	upcoming(phone: string, from: number): Promise<Appt[]>;
	add(a: NewAppt): Promise<Appt>;
	patch(
		id: string,
		p: { start?: number; end?: number; note?: string },
	): Promise<void>;
	remove(id: string): Promise<void>;
}
export type LogEntry = {
	phone: string;
	callId: string;
	line: string;
	name?: string;
	vehicle?: string;
	callback?: string;
};
export interface Sheet {
	log(e: LogEntry): void;
}
export type Ports = { cal: Calendar; sheet: Sheet };
