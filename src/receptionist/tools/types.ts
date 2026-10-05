import type { DateTime } from 'luxon';
import type { Ports } from '../ports.ts';
import type { ObjectSchema } from './schema.ts';

export type Ctx = { callId: string; callerNumber?: string; now?: DateTime };
export type Args = Record<string, unknown>;

/** One thing the receptionist can do. `run` returns one line of JSON for the model to read. */
export type Tool = {
	name: string;
	description: string;
	parameters: ObjectSchema;
	run: (a: Args, c: Ctx, p: Ports) => Promise<string>;
};
