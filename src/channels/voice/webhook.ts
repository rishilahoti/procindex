// Vapi's "tool-calls" webhook: Vapi runs the conversation, we only run the tools. src/server.ts checks the secret header first.
import type { Ports } from '../../receptionist/ports.ts';
import { runTool } from '../../receptionist/tools/index.ts';

/** Sent by Vapi on every webhook call (set in config.ts), checked by server.ts. */
export const SECRET_HEADER = 'x-cedar-secret';

/** Always answers 200: a non-200 makes Vapi say "no result" instead of using our error text. */
export async function vapiTools(body: any, ports: Ports) {
	const m = body?.message;
	if (m?.type !== 'tool-calls') return {};
	const ctx = {
		callId: m.call?.id ?? 'vapi',
		callerNumber: m.call?.customer?.number,
	};
	const results = await Promise.all(
		(m.toolCallList ?? []).map(async (tc: any) => {
			const fn = tc.function ?? tc; // Vapi sends {id, function: {name, arguments}} with arguments as a JSON string
			try {
				const args =
					typeof fn.arguments === 'string'
						? JSON.parse(fn.arguments || '{}')
						: fn.arguments;
				return {
					name: fn.name,
					toolCallId: tc.id,
					result: await runTool(fn.name, args, ctx, ports),
				};
			} catch {
				return {
					name: fn.name,
					toolCallId: tc.id,
					error: 'could not read the tool arguments',
				};
			}
		}),
	);
	return { results };
}
