// The Vapi phone assistant, with every latency knob set in code. Built here (not in the script) so tests can check it.
// README has the reasoning behind each value. Type-only import: the server never loads the Vapi SDK.
import type { Vapi } from '@vapi-ai/server-sdk';
import { systemPrompt, VAPI_NOW } from './prompt.ts';
import { SHOP } from './shop.ts';
import { TOOLS } from './tools.ts';

// Fires only when the caller stops on a half-finished digit string (1-9 digits at the end); a complete 10-digit number,
// or anything else, gets the normal fast turn. A blanket wait after "what's your number?" would put the whole 1.2s
// budget on the name-and-number turn.
export const PARTIAL_NUMBER = '^(?!.*(?:\\d[\\s\\-.,]*){10}$).*\\d[\\s\\-.,]*$';

export function assistantConfig(
	publicUrl: string,
	webhookSecret: string,
): Vapi.CreateAssistantDto {
	return {
		name: `${SHOP.name} receptionist`,
		firstMessage: `Thanks for calling ${SHOP.name}, how can I help?`,
		maxDurationSeconds: 600,

		// Budget for the 1.2s gap: turn detection ~0.3s + first LLM token ~0.5s + first TTS audio ~0.2s + hops.
		// 1. Hearing. Flux decides end-of-turn inside the transcriber: no extra endpointing model, no punctuation wait.
		transcriber: {
			provider: 'deepgram',
			model: 'flux-general-en',
			language: 'en',
			eotThreshold: 0.7, // 0.5-0.6 replies sooner but cuts people off; 0.8+ is polite but slow
			eotTimeoutMs: 2500, // longest silence before the turn is forced to end (default 5000)
			numerals: true, // "four one five" arrives as digits, so phone numbers and years reach the model intact
			keyterm: [
				SHOP.name,
				'Cedar Lane',
				'interior detail',
				'full detail',
				'ceramic coating',
			],
		},

		// 2. Thinking. Smallest fast model, low temperature for scheduling accuracy, short replies.
		model: {
			provider: 'anthropic',
			model: 'claude-haiku-4-5-20251001',
			temperature: 0.3,
			maxTokens: 300,
			messages: [
				{ role: 'system', content: systemPrompt('voice', VAPI_NOW) },
			],
			tools: [
				...TOOLS.map(
					({
						name,
						description,
						input_schema,
					}): Vapi.AnthropicModelToolsItem => ({
						type: 'function',
						function: {
							name,
							description,
							parameters: input_schema,
						},
						// No request-start/complete messages: the model says its own lead-in ("Let me check.") as its first tokens, which
						// is faster than waiting for the whole tool call to be generated. A request-complete message would also replace
						// the model's answer. This only fills a genuinely slow tool call.
						messages: [
							{
								type: 'request-response-delayed',
								content: 'Sorry, one more second.',
								timingMilliseconds: 2500,
							},
						],
					}),
				),
				{ type: 'endCall' },
			],
		},

		// 3. Speaking. Flash model for the fastest first audio; a short first chunk so a 12-character lead-in is spoken at once.
		voice: {
			provider: '11labs',
			voiceId: 'sarah',
			model: 'eleven_flash_v2_5',
			chunkPlan: { minCharacters: 12 },
		},

		startSpeakingPlan: {
			waitSeconds: 0.1, // a floor on the pause before replying (default 0.4): the default alone eats a third of the budget
			customEndpointingRules: [
				{
					type: 'customer',
					regex: PARTIAL_NUMBER,
					timeoutSeconds: 0.8,
				},
			],
		},
		// Two words (not raw voice detection) so "mm-hmm" and coughs don't make it stop mid-sentence; quick recovery after a real interruption.
		stopSpeakingPlan: { numWords: 2, backoffSeconds: 0.6 },

		// Only tool calls come to us. src/server.ts checks the secret header. No retries: bookings must not be replayed.
		server: {
			url: `${publicUrl.replace(/\/$/, '')}/vapi/tools`,
			headers: { 'x-cedar-secret': webhookSecret },
			timeoutSeconds: 10,
		},
		serverMessages: ['tool-calls'],
	};
}
