# Phone assistant (Vapi)

The same prompt and the same tools as the chat, behind a Vapi phone assistant. Vapi runs the conversation (speech to text, the model, text to speech); this server only runs the tools, over a webhook.

## Setup

```
ngrok http 3000                    # only /vapi/tools is reachable through a tunnel; chat refuses proxied requests
# .env: VAPI_API_KEY, PUBLIC_URL (the https URL above), VAPI_WEBHOOK_SECRET (any long random string)
npm run vapi                       # creates the assistant; put the printed id in VAPI_ASSISTANT_ID
                                   # then attach a phone number to it in the Vapi dashboard, or use "Talk" there
npm run vapi -- latency <callId>   # after a call: per-turn stage breakdown vs the 1.2s budget
```

**Your Gemini key for calls:** Vapi, not this server, talks to Gemini during a call. In the Vapi dashboard, add your Google AI Studio key under Provider Keys (Google). If you don't, check Vapi's current docs for how Google model usage is billed. The key in `.env` (`GEMINI_API_KEY`) is only used by the chat page.

**Free-tier caution:** a live call makes a model request on every turn, plus one per tool call, and free-tier limits are low per minute. One call may be fine for trying it; several at once will hit the limit. For real call volume, enable billing on the key.

## Latency settings

All in `src/channels/voice/config.ts`. Budget for the gap before the agent speaks: turn detection ~0.3s + first LLM token ~0.5s + first audio ~0.2s + hops, about 1.2s.

| Knob | Value | Why |
|---|---|---|
| Transcriber | Deepgram Flux, `eotThreshold` 0.7, `eotTimeoutMs` 2500, `numerals` | End of turn is decided inside the transcriber (no extra model, no punctuation wait). Digits arrive as digits. Cut-offs: raise `eotThreshold`. Sluggish: lower it. |
| Model | Gemini `gemini-3.1-flash-lite` (via Vapi's Google provider), temperature 0.3, 1024 max tokens | The smallest current Gemini for a fast first token; low temperature for scheduling accuracy. The token cap is generous on purpose: on Gemini it also counts hidden reasoning tokens, and a tight one can leave nothing to speak. Replies stay short because the prompt asks for it. |
| Voice | ElevenLabs `eleven_flash_v2_5`, first chunk 12 chars | Fastest first audio; a short lead-in is spoken at once. |
| `waitSeconds` | 0.1 (default 0.4) | A floor on every reply; the default alone is a third of the budget. |
| Endpointing rule | wait 0.8s only if the caller stops on a half-finished digit string | Protects phone-number capture without taxing every turn. Complete numbers get the fast path. |
| Interruptions | `numWords` 2, `backoffSeconds` 0.6 | "mm-hmm" and coughs don't stop it mid-sentence; quick recovery after a real interruption. |
| Tool fillers | none configured; the prompt has the model say "Let me check." first | First audio at first-token time rather than after the tool call is generated. A `request-complete` message would replace the model's answer. |
| Booking path | sheet logging not awaited | The caller never waits on Sheets. |
| Webhook | tool calls only, secret header, 10s timeout, no retries | Bookings must not be replayed. |

To try a different Gemini model, change `model` in `config.ts` (Vapi only accepts the IDs in its SDK's `GoogleModelModel` list) and run `npm run vapi` again.

**Latency numbers are estimates.** They were set against the budget above, not measured with Gemini. Make a test call, then run `npm run vapi -- latency <callId>` and tune from there. Phone latency depends on region, voice and model load.
