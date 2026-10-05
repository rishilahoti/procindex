// The chat agent: Gemini plus the shared tools in a plain function-calling loop. (On calls, Vapi runs the loop and calls the same tools.)
import {
	GoogleGenAI,
	type Content,
	type FunctionDeclaration,
	type Part,
} from '@google/genai';
import type { Ports } from '../../receptionist/ports.ts';
import { NOW_FMT, systemPrompt } from '../../receptionist/prompt.ts';
import { runTool, TOOLS } from '../../receptionist/tools/index.ts';
import { now } from '../../scheduling/slots.ts';

// `gemini-flash-latest` always points at Google's current Flash model, so chat keeps working as old versions are retired
// (gemini-2.5-flash is scheduled to shut down in October 2026). Set MODEL in .env to pin one.
// Free keys only get quota on some models; if you hit a 429, see docs/setup.md.
export const MODEL = process.env.MODEL ?? 'gemini-flash-latest';

const functionDeclarations: FunctionDeclaration[] = TOOLS.map(
	({ name, description, parameters }) => ({
		name,
		description,
		parametersJsonSchema: parameters,
	}),
);

export type Session = { id: string; messages: Content[] };

// The free AI Studio key, never Google Cloud credentials: without an explicit key (or with vertexai on) the SDK falls back to
// Application Default Credentials, and GOOGLE_APPLICATION_CREDENTIALS here is the Calendar/Sheets service account.
let shared: GoogleGenAI | undefined;
function defaultClient(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey)
		throw new Error(
			'GEMINI_API_KEY is not set: create a free key at https://aistudio.google.com/apikey and put it in .env',
		);
	return (shared ??= new GoogleGenAI({ apiKey, vertexai: false }));
}

const textOf = (parts: Part[]) =>
	parts.flatMap((p) => (p.text && !p.thought ? [p.text] : [])).join('');

export async function reply(
	s: Session,
	text: string,
	ports: Ports,
	client: GoogleGenAI = defaultClient(),
): Promise<string> {
	const base = s.messages.length;
	try {
		s.messages.push({ role: 'user', parts: [{ text }] });
		for (let i = 0; i < 8; i++) {
			// No maxOutputTokens: on Gemini's thinking models that cap also counts the hidden reasoning, and a small one can cut the reply to nothing.
			const res = await client.models.generateContent({
				model: MODEL,
				contents: s.messages,
				config: {
					systemInstruction: systemPrompt('chat', now().toFormat(NOW_FMT)),
					tools: [{ functionDeclarations }],
				},
			});
			const candidate = res.candidates?.[0];
			const parts = candidate?.content?.parts;
			if (!candidate?.content || !parts?.length)
				throw new Error(
					`Gemini returned no content (${candidate?.finishReason ?? res.promptFeedback?.blockReason ?? 'unknown reason'})`,
				);
			s.messages.push(candidate.content); // kept as returned: Gemini 3 models attach thought signatures that must be sent back
			const calls = parts.flatMap((p) => p.functionCall ?? []);
			if (!calls.length) return textOf(parts);
			const results: Part[] = await Promise.all(
				calls.map(async (c) => ({
					functionResponse: {
						id: c.id,
						name: c.name,
						// every tool answers with one line of JSON describing an object; Gemini wants that object
						response: JSON.parse(
							await runTool(
								c.name ?? '',
								c.args,
								{ callId: s.id },
								ports,
							),
						),
					},
				})),
			);
			s.messages.push({ role: 'user', parts: results });
		}
		throw new Error('tool loop did not finish');
	} catch (e) {
		s.messages.length = base; // a function call without its response in the history would make every later turn fail with a 400
		throw e;
	}
}
