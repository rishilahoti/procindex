# Cedar Lane Auto Detailing: AI receptionist

Phase 1 is a text chat agent (Claude + Google Calendar + Google Sheets). Phase 2 puts the same prompt and the same tools behind a Vapi phone assistant, so text and voice behave identically.

```
src/shop.ts         hours, services, prices, vehicles, prep, policies. One file to edit; the prompt and the scheduling code both read it.
src/slots.ts        scheduling logic: open/full, closed days, notice, nearest alternatives. Pure code: the model never decides if a slot is free.
src/tools.ts        the 8 tools (check, book, find, reschedule, cancel, running late, callback, log). Shared by chat and Vapi.
src/prompt.ts       the receptionist's instructions, generated from shop.ts
src/agent.ts        chat loop (Claude + tools)          src/server.ts   chat UI + Vapi webhook
src/google.ts       Calendar + Sheets                   src/fake.ts     in-memory stand-ins + demo week (tests, FAKE=1)
src/vapi-config.ts  the phone assistant and its latency settings
```

## Run it

```
npm install
cp .env.example .env        # fill in the values below
npm run seed                # Contacts tab + a demo week on the calendar (safe to re-run)
npm start                   # chat at http://localhost:3000
```

No Google account yet? `FAKE=1 npm start` runs the whole agent against an in-memory calendar and sheet with the same demo week. Only `ANTHROPIC_API_KEY` is needed.

**Google, one time:** create a service account (enable the Calendar and Sheets APIs), download its JSON key, set `GOOGLE_APPLICATION_CREDENTIALS` to it. Create a calendar and a blank sheet and share both with the service account's email (calendar: "Make changes to events", sheet: Editor). Set `GOOGLE_CALENDAR_ID` and `GOOGLE_SHEET_ID`. The calendar's timezone must match `TZ` in `src/shop.ts`.

**Demo week** (`npm run seed`): the coming Thursday 1:30-4:30 PM is a full detail, so *"Is the 3:30 interior detail open Thursday?"* gets "that one's full, 4:30 is open". Also: a few bookings to reschedule (Alex Kim +1 415-555-0138 tomorrow 10:00; Dana Rivera, Priya Shah, Jamal Carter, Lena Park, Omar Haddad later in the week), an all-day "CLOSED" Monday, and a booking later today for Sam Ortiz (+1 415-555-0155) to try "I'm running late". Re-run `npm run seed` when the week goes stale.

## What it handles and what it hands off

| Caller wants | Agent |
|---|---|
| book / change / cancel | does it. Availability comes from the calendar and `slots.ts`; a booking re-checks under a lock, so two callers can't take the same slot. Callers only reach appointments under the phone number they give. |
| pricing, hours, prep, "do you do my vehicle?" | answers from `shop.ts` only. Motorcycles/RVs/boats: says no. |
| running late | notes it on the calendar event. Up to 15 min and not into the next car: slot kept. Otherwise offers to reschedule. |
| complaint about a charge, refund, damage, quality | **hands off**: takes name, number and a one-line reason, no promises. |
| ceramic coating etc., exotic/classic vehicles, anything not in `shop.ts`, "let me talk to someone" | **hands off** the same way. |

A handoff is a callback request: the caller's row in the **Contacts** sheet gets `Callback Needed = YES: <reason>` and a `HANDOFF` line in `Call Log`. No live transfer: add Vapi's `transferCall` when the shop has a staffed line.

**Contacts tab:** one row per caller (keyed by phone): Name, Vehicle, Calls, First/Last Call, Callback Needed, Call Log (one timestamped line per thing that came up), Last Call ID. Bookings, changes, late notices and callbacks log themselves; `log_call` records everything else (questions answered, outcome). Logging is fire-and-forget: a Sheets failure never fails a booking.

## Phase 2: Vapi

```
ngrok http 3000                    # only /vapi/tools is reachable through a tunnel; chat refuses proxied requests
# .env: VAPI_API_KEY, PUBLIC_URL (the https URL above), VAPI_WEBHOOK_SECRET (any long random string)
npm run vapi                       # creates the assistant; put the printed id in VAPI_ASSISTANT_ID
                                   # then attach a phone number to it in the Vapi dashboard, or use "Talk" there
npm run vapi -- latency <callId>   # after a call: per-turn stage breakdown vs the 1.2s budget
```

**Latency settings** (`src/vapi-config.ts`). Budget for the gap: turn detection ~0.3s + first LLM token ~0.5s + first audio ~0.2s + hops.

| Knob | Value | Why |
|---|---|---|
| Transcriber | Deepgram Flux, `eotThreshold` 0.7, `eotTimeoutMs` 2500, `numerals` | End of turn is decided inside the transcriber (no extra model, no punctuation wait). Digits arrive as digits. Cut-offs: raise `eotThreshold`. Sluggish: lower it. |
| Model | `claude-haiku-4-5`, temperature 0.3, 300 max tokens | First token ~0.5s; low temperature for scheduling accuracy. |
| Voice | ElevenLabs `eleven_flash_v2_5`, first chunk 12 chars | Fastest first audio; a short lead-in is spoken at once. |
| `waitSeconds` | 0.1 (default 0.4) | A floor on every reply; the default alone is a third of the budget. |
| Endpointing rule | wait 0.8s only if the caller stops on a half-finished digit string | Protects phone-number capture without taxing every turn. Complete numbers get the fast path. |
| Interruptions | `numWords` 2, `backoffSeconds` 0.6 | "mm-hmm" and coughs don't stop it mid-sentence; quick recovery after a real interruption. |
| Tool fillers | none configured; the prompt has the model say "Let me check." first | First audio at first-token time rather than after the tool call is generated. A `request-complete` message would replace the model's answer. |
| Booking path | sheet logging not awaited | The caller never waits on Sheets. |
| Webhook | tool calls only, secret header, 10s timeout, no retries | Bookings must not be replayed. |

## Tests

`npm test` (no network, no keys): scheduling logic with a fuzz check that every suggested alternative is bookable; every tool incl. double-booking race, identity checks, handoff, late rules; the chat loop's message plumbing; the Vapi webhook contract over real HTTP; invariants of the phone config.

## Assumptions: placeholders in `src/shop.ts`, replace with the real shop's

Services and prices (3 services by vehicle size), job lengths, hours (Mon-Fri 8-6, Sat 9-4, Sun closed), one bay, 2-hour notice, 60-day horizon, the 15-minute lateness grace, the $25-$75 heavy-soil surcharge line, address and phone, and the "callback by the next business day" promise. The agent will state whatever is in that file as fact.

## Not verified live

Built without a Google account, Anthropic key or Vapi account, so these were checked against typed SDKs, docs and fakes, not live services: real Calendar/Sheets calls, the model's behaviour in a real chat, and the latency numbers (the budget above is an estimate; measure with `npm run vapi -- latency`). Phone-call latency in particular depends on region, voice and model load.
