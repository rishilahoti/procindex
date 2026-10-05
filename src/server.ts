// Entry point: one small HTTP server. Routes only: the chat UI (localhost only) and the Vapi tool webhook (shared-secret protected).
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { pathToFileURL } from 'node:url';
import { reply, type Session } from './channels/chat/reply.ts';
import { SECRET_HEADER, vapiTools } from './channels/voice/webhook.ts';
import { fakePorts } from './integrations/fake/ports.ts';
import { google } from './integrations/google/client.ts';
import { googlePorts } from './integrations/google/ports.ts';
import type { Ports } from './receptionist/ports.ts';

const page = readFileSync(
	new URL('../public/index.html', import.meta.url),
	'utf8',
);

async function json(req: IncomingMessage): Promise<any> {
	let raw = '';
	for await (const chunk of req)
		if ((raw += chunk).length > 1e6) throw new Error('body too large');
	return raw ? JSON.parse(raw) : {};
}
const send = (
	res: ServerResponse,
	code: number,
	body: unknown,
	type = 'application/json',
) => {
	res.writeHead(code, { 'content-type': type });
	res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const same = (a: string | undefined, b: string | undefined) =>
	!!a &&
	!!b &&
	a.length === b.length &&
	timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ponytail: chat sessions live in memory and never expire; fine for dev and a demo, add a TTL before exposing it.
export function createApp(ports: Ports) {
	const sessions = new Map<string, Session>();
	return createServer(async (req, res) => {
		try {
			if (req.method === 'POST' && req.url === '/vapi/tools') {
				if (
					!same(
						req.headers[SECRET_HEADER] as string | undefined,
						process.env.VAPI_WEBHOOK_SECRET,
					)
				)
					return send(res, 401, { error: 'unauthorized' });
				return send(res, 200, await vapiTools(await json(req), ports));
			}
			if (req.headers['x-forwarded-for'])
				return send(res, 404, { error: 'not found' }); // came through a tunnel or proxy: chat is for localhost only
			if (req.method === 'GET' && req.url === '/')
				return send(res, 200, page, 'text/html; charset=utf-8');
			if (req.method === 'POST' && req.url === '/chat') {
				const { sessionId, message } = await json(req);
				if (
					typeof sessionId !== 'string' ||
					typeof message !== 'string' ||
					!message.trim()
				)
					return send(res, 400, {
						error: 'sessionId and message are required',
					});
				const s = sessions.get(sessionId) ?? {
					id: sessionId,
					messages: [],
				};
				sessions.set(sessionId, s);
				try {
					return send(res, 200, {
						reply: await reply(s, message, ports),
					});
				} catch (e) {
					console.error('chat turn failed:', e);
					return send(res, 200, {
						reply: "Sorry, I'm having trouble on my end. Please try again, or call the shop directly.",
					});
				}
			}
			send(res, 404, { error: 'not found' });
		} catch (e) {
			console.error(e);
			send(res, 500, { error: 'server error' });
		}
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const port = Number(process.env.PORT ?? 3000);
	if (process.env.FAKE)
		console.warn('FAKE=1: in-memory calendar and sheet. Nothing is saved.');
	else google(); // fail fast on missing GOOGLE_* settings
	if (!process.env.GEMINI_API_KEY)
		console.warn('GEMINI_API_KEY is not set: chat replies will fail.');
	if (!process.env.VAPI_WEBHOOK_SECRET)
		console.warn(
			'VAPI_WEBHOOK_SECRET is not set: /vapi/tools will reject every call.',
		);
	createApp(process.env.FAKE ? fakePorts() : googlePorts()).listen(port, () =>
		console.log(
			`Chat: http://localhost:${port}  Vapi webhook: POST /vapi/tools`,
		),
	);
}
