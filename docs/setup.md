# Setup

## 1. Gemini key (free tier)

1. Create a key at https://aistudio.google.com/apikey. No credit card is needed for the free tier.
2. Put it in `.env`:
   ```
   GEMINI_API_KEY=your-key
   ```

That is all the chat agent needs. Combined with `FAKE=1` (below) you can try the whole agent with nothing else set up.

### Which model

Chat uses `gemini-flash-latest` by default, an alias that always points at Google's current Flash model. It is the default on purpose: Google retires versioned models on a schedule (`gemini-2.5-flash` is due to shut down in October 2026), and an alias keeps working through that. To pin a model, set `MODEL` in `.env`.

Free-tier quota differs per model and Google changes it. If chat replies fail with a `429` or a message about quota or `limit: 0`, your key has no free quota on that model. Open the rate-limit page in AI Studio, pick a model that shows free quota, and set `MODEL` to it. `gemini-3.1-flash-lite` (the lightweight Flash-Lite model, also what the phone assistant uses) is worth trying first.

### Free-tier limits and privacy

- **Rate limits are low** (requests per minute and per day, set per model). A chat turn can use several requests, because each tool call is another round trip to the model. Fine for trying it out; for a shop taking real traffic, enable billing on the key.
- **Data use:** Google's terms for the unpaid tier allow it to use prompts and responses to improve its products. This agent handles customer names and phone numbers, so check the current terms before pointing real customers at a free key.

## 2. Google Calendar and Sheets

The agent reads and writes one Google Calendar (appointments) and one Google Sheet (the Contacts tab). It authenticates as a service account. This is separate from the Gemini key.

1. In Google Cloud, create a project, enable the **Google Calendar API** and the **Google Sheets API**, create a **service account**, and download its JSON key.
2. Create a calendar and a blank sheet. Share the calendar with the service account's email ("Make changes to events") and the sheet ("Editor").
3. In `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
   GOOGLE_CALENDAR_ID=...
   GOOGLE_SHEET_ID=...
   ```
   On a host without files, paste the whole key JSON on one line into `GOOGLE_SERVICE_ACCOUNT_JSON` instead.
4. The calendar's timezone must match `TZ` in `src/shop.ts`.

`service-account*.json` is already in `.gitignore`. Never commit the key.

## 3. Demo data

```
npm run seed     # Contacts tab + a demo week on the calendar (safe to re-run)
npm start        # chat at http://localhost:3000
```

The coming Thursday 1:30-4:30 PM is a full detail, so *"Is the 3:30 interior detail open Thursday?"* gets "that one's full, 4:30 is open". Also seeded: a few bookings to reschedule (Alex Kim +1 415-555-0138 tomorrow 10:00; Dana Rivera, Priya Shah, Jamal Carter, Lena Park and Omar Haddad later in the week), an all-day "CLOSED" Monday, and a booking later today for Sam Ortiz (+1 415-555-0155) so you can try "I'm running late". Re-run `npm run seed` when the week goes stale.

## No Google account yet: `FAKE=1`

```
FAKE=1 npm start
```

Runs the whole agent against an in-memory calendar and sheet with the same demo week. Nothing is saved. Only `GEMINI_API_KEY` is needed.

## Environment variables

| Variable | For | Notes |
|---|---|---|
| `GEMINI_API_KEY` | chat | free key from AI Studio |
| `MODEL` | chat | default `gemini-flash-latest` |
| `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_JSON` | Calendar + Sheets | service account key |
| `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEET_ID` | Calendar + Sheets | |
| `VAPI_API_KEY`, `PUBLIC_URL`, `VAPI_WEBHOOK_SECRET`, `VAPI_ASSISTANT_ID` | phone | see [voice.md](voice.md) |
| `PORT` | server | default 3000 |
| `FAKE` | server | `1` for the in-memory calendar and sheet |
