// Creates (or updates) the phone assistant on Vapi. The config itself lives in src/channels/voice/config.ts.
//   npm run vapi                     create the assistant, or update it if VAPI_ASSISTANT_ID is set
//   npm run vapi -- latency <callId> per-turn latency report for a finished call
import { VapiClient } from '@vapi-ai/server-sdk';
import { assistantConfig } from '../src/channels/voice/config.ts';

const env = (k: string) => {
	const v = process.env[k];
	if (!v) throw new Error(`${k} is not set (see docs/voice.md)`);
	return v;
};
const vapi = new VapiClient({ token: env('VAPI_API_KEY') });
const BUDGET_MS = 1200; // "more than about 1.2 seconds and it sounds like a bot"

if (process.argv[2] === 'latency') {
	const call = await vapi.calls.get({
		id: process.argv[3] ?? env('CALL_ID'),
	});
	const turns = call.artifact?.performanceMetrics?.turnLatencies ?? [];
	if (!turns.length)
		throw new Error(
			'no turn latencies on that call yet (they appear after the call ends)',
		);
	const total = turns.map((t) => t.turnLatency ?? 0).sort((a, b) => a - b);
	const pct = (p: number) =>
		total[Math.min(total.length - 1, Math.floor((p / 100) * total.length))];
	console.log('turn  endpoint  stt   model  voice  TOTAL   (ms)');
	turns.forEach((t, i) => {
		const cells = [
			t.endpointingLatency,
			t.transcriberLatency,
			t.modelLatency,
			t.voiceLatency,
			t.turnLatency,
		];
		console.log(
			`${String(i + 1).padStart(3)}  ${cells.map((x) => String(Math.round(x ?? 0)).padStart(7)).join(' ')}${(t.turnLatency ?? 0) > BUDGET_MS ? '  <-- over budget' : ''}`,
		);
	});
	console.log(
		`\nturns ${turns.length}  p50 ${pct(50)}  p90 ${pct(90)}  max ${total.at(-1)}  over ${BUDGET_MS}ms: ${total.filter((x) => x > BUDGET_MS).length}`,
	);
	process.exit(0);
}

const assistant = assistantConfig(
	env('PUBLIC_URL'),
	env('VAPI_WEBHOOK_SECRET'),
);
const id = process.env.VAPI_ASSISTANT_ID;
const saved = id
	? await vapi.assistants.update({ id, ...assistant })
	: await vapi.assistants.create(assistant);
console.log(`${id ? 'Updated' : 'Created'} assistant ${saved.id}`);
if (!id)
	console.log(
		`Add VAPI_ASSISTANT_ID=${saved.id} to .env, then attach a phone number to it in the Vapi dashboard.`,
	);
