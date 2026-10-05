# Cedar Lane Auto Detailing: AI receptionist

An AI receptionist for a small auto detailing shop. It books, moves and cancels appointments on a Google Calendar, answers questions about prices, hours and prep, and hands anything it shouldn't decide (complaints, refunds, special quotes) to a human as a callback request. It runs on Google Gemini, so the **free Google AI Studio key** is enough.

- **Chat** (works today): Gemini + Google Calendar + Google Sheets, in a browser page.
- **Phone** (optional): the same prompt and the same tools behind a [Vapi](https://vapi.ai) assistant, so text and voice behave identically.

## Quick start

Needs Node 22.9 or newer.

```
npm install
cp .env.example .env     # paste your free Gemini key: https://aistudio.google.com/apikey
FAKE=1 npm start         # chat at http://localhost:3000, no Google account needed
```

`FAKE=1` runs against an in-memory calendar and sheet with a demo week, so a Gemini key is the only thing you need to try it. To use a real Google Calendar and Sheet, see [docs/setup.md](docs/setup.md).

## Where things are

```
src/
├── server.ts                  HTTP entry point, routes only: chat page, /chat, /vapi/tools
├── shop.ts                    ★ the one file to edit: hours, services, prices, policies
├── scheduling/
│   └── slots.ts               is a slot free? nearest alternatives. Pure code: no I/O, no model
├── receptionist/              the shared brain, identical for chat and phone
│   ├── prompt.ts              the instructions, generated from shop.ts
│   ├── ports.ts               what it needs from outside: a Calendar and a Sheet
│   └── tools/                 the 8 things it can do, one file each, plus helpers.ts, schema.ts, index.ts
├── channels/                  how customers reach it
│   ├── chat/reply.ts          text chat: the Gemini + tools loop
│   └── voice/                 config.ts: the Vapi assistant and its latency settings
│                              webhook.ts: Vapi's tool-call requests
└── integrations/              where the data lives
    ├── google/                real Calendar + Sheets (client, calendar, sheets, ports)
    ├── fake/                  in-memory stand-ins + the demo week (tests, FAKE=1)
    └── contacts.ts            Contacts-tab row logic, shared by google/ and fake/
public/index.html              the chat page
scripts/                       seed.ts: demo data on the real calendar. vapi.ts: create the phone assistant
test/                          mirrors src/
docs/                          setup.md, behavior.md, voice.md
```

**The one rule that shapes the code:** the model never decides whether a slot is free. `scheduling/slots.ts` does, and the tools return its answer. `shop.ts` feeds both the prompt and the scheduling code, so they cannot disagree.

## Docs

| | |
|---|---|
| [docs/setup.md](docs/setup.md) | Gemini key (free tier), Google Calendar + Sheets, the demo week |
| [docs/behavior.md](docs/behavior.md) | What it does itself, what it hands off, the Contacts sheet, the placeholder assumptions |
| [docs/voice.md](docs/voice.md) | The Vapi phone assistant and every latency setting |

## Commands

| | |
|---|---|
| `npm start` | chat at http://localhost:3000 and the Vapi webhook |
| `npm run seed` | Contacts tab + a demo week on the real calendar (safe to re-run) |
| `npm run vapi` | create or update the phone assistant |
| `npm test` | all tests: no network, no keys |
| `npm run typecheck` | `tsc --noEmit` |

## Tests

`npm test` needs no network and no keys. It covers scheduling logic (with a fuzz check that every suggested alternative is bookable); every tool, including the double-booking race, identity checks, handoffs and the lateness rules; the chat loop against a stubbed Gemini client and against the real Gemini SDK pointed at a local mock server (to check the request format); the Vapi webhook over real HTTP; and invariants of the phone config.

## Not verified live

This was built and tested without a live Gemini key, Google Calendar/Sheets account or Vapi account. What was checked: the request format the Gemini SDK sends (against a local mock), the Vapi config against the Vapi SDK's types, and everything else against in-memory fakes. What was not: real Gemini replies and how well the model follows the prompt, real Calendar/Sheets calls, free-tier quota on the default model, and phone latency. Try each once before relying on it.
