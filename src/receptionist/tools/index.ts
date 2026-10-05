// The agent's hands. Shared by the chat agent (channels/chat) and the Vapi webhook (channels/voice), so text and voice
// behave identically. Every tool returns one line of JSON; the model reads it, never computes availability itself.
import type { Ports } from '../ports.ts';
import { bookAppointment } from './book-appointment.ts';
import { cancelAppointment } from './cancel-appointment.ts';
import { checkAvailability } from './check-availability.ts';
import { findAppointments } from './find-appointments.ts';
import { bad } from './helpers.ts';
import { logCall } from './log-call.ts';
import { reportRunningLate } from './report-running-late.ts';
import { requestCallback } from './request-callback.ts';
import { rescheduleAppointment } from './reschedule-appointment.ts';
import type { Args, Ctx, Tool } from './types.ts';

export const TOOLS: Tool[] = [
	checkAvailability,
	bookAppointment,
	findAppointments,
	rescheduleAppointment,
	cancelAppointment,
	reportRunningLate,
	requestCallback,
	logCall,
];

export async function runTool(
	name: string,
	args: unknown,
	ctx: Ctx,
	ports: Ports,
): Promise<string> {
	const tool = TOOLS.find((t) => t.name === name);
	if (!tool) return bad(`unknown tool ${name}`);
	try {
		return await tool.run(
			(args && typeof args === 'object' ? args : {}) as Args,
			ctx,
			ports,
		);
	} catch (e) {
		console.error(`tool ${name} failed:`, e);
		return bad(
			'internal error; apologize briefly and offer a callback (request_callback)',
		);
	}
}
