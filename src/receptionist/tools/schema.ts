// JSON-schema building blocks for tool parameters. Flat objects only: the same schema goes to Gemini (chat) and Vapi (voice).
import { SERVICES } from '../../shop.ts';

type Prop = {
	type: 'string' | 'number';
	description?: string;
	enum?: string[];
};

export const phoneP: Prop = {
	type: 'string',
	description: 'Caller phone number, digits as spoken or typed',
};
export const dateP: Prop = {
	type: 'string',
	description:
		'A weekday name exactly as the caller said it ("thursday"), "today", "tomorrow", or YYYY-MM-DD. Do not convert weekday names yourself.',
};
export const timeP: Prop = {
	type: 'string',
	description: 'Start time, 24-hour HH:MM, e.g. 15:30',
};
export const serviceP: Prop = {
	type: 'string',
	enum: Object.keys(SERVICES),
	description: 'Service id',
};
export const idP: Prop = {
	type: 'string',
	description: 'Appointment id from find_appointments',
};

export const obj = (properties: Record<string, Prop>, required: string[]) => ({
	type: 'object' as const,
	properties,
	required,
});
export type ObjectSchema = ReturnType<typeof obj>;
