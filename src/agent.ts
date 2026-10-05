// The chat agent: Claude plus the shared tools in a plain tool-use loop. (On calls, Vapi runs the loop and calls the same tools.)
import Anthropic from '@anthropic-ai/sdk';
import { NOW_FMT, systemPrompt } from './prompt.ts';
import { now } from './slots.ts';
import { runTool, TOOLS, type Ports } from './tools.ts';

export const MODEL = process.env.MODEL ?? 'claude-sonnet-5-5';
const tools: Anthropic.Tool[] = TOOLS.map(
	({ name, description, input_schema }) => ({
		name,
		description,
		input_schema,
	}),
);

export type Session = { id: string; messages: Anthropic.MessageParam[] };

export async function reply(
	s: Session,
	text: string,
	ports: Ports,
	client: Anthropic = new Anthropic(),
): Promise<string> {
	const base = s.messages.length;
	try {
		s.messages.push({ role: 'user', content: text });
		for (let i = 0; i < 8; i++) {
			const res = await client.messages.create({
				model: MODEL,
				max_tokens: 1024,
				system: systemPrompt('chat', now().toFormat(NOW_FMT)),
				tools,
				messages: s.messages,
			});
			s.messages.push({ role: 'assistant', content: res.content });
			const uses = res.content.filter(
				(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
			);
			if (!uses.length)
				return res.content
					.flatMap((b) => (b.type === 'text' ? [b.text] : []))
					.join('');
			const content = await Promise.all(
				uses.map(async (u) => ({
					type: 'tool_result' as const,
					tool_use_id: u.id,
					content: await runTool(
						u.name,
						u.input,
						{ callId: s.id },
						ports,
					),
				})),
			);
			s.messages.push({ role: 'user', content });
		}
		throw new Error('tool loop did not finish');
	} catch (e) {
		s.messages.length = base; // a dangling tool_use in the history would make every later turn fail with a 400
		throw e;
	}
}
