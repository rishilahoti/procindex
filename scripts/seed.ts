// One-time setup + demo data (safe to re-run):
//   1. makes sure the sheet has a "Contacts" tab with the header row
//   2. replaces any earlier demo events on the calendar with a fresh week built around today
// Run it again whenever the demo week has gone stale.
import { HEADERS } from '../src/integrations/contacts.ts'
import { demoAppts } from '../src/integrations/fake/demo-week.ts'
import { google } from '../src/integrations/google/client.ts'
import { googlePorts } from '../src/integrations/google/ports.ts'
import { TZ } from '../src/shop.ts'
import { now } from '../src/scheduling/slots.ts'

const { cal, sh, calendarId, sheetId } = google()

const tabs = (await sh.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(sheetId,title)' })).data.sheets ?? []
const contacts = tabs.find((t) => t.properties?.title === 'Contacts')
const blank = tabs.find((t) => t.properties?.title === 'Sheet1') // a fresh Google Sheet starts with this
const requests = contacts
  ? []
  : [blank ? { updateSheetProperties: { properties: { sheetId: blank.properties!.sheetId, title: 'Contacts', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } } : { addSheet: { properties: { title: 'Contacts', gridProperties: { frozenRowCount: 1 } } } }]
if (requests.length) await sh.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } })
await sh.spreadsheets.values.update({ spreadsheetId: sheetId, range: 'Contacts!A1:I1', valueInputOption: 'RAW', requestBody: { values: [HEADERS] } })
console.log(`Contacts tab ready (${contacts ? 'existing' : blank ? 'renamed Sheet1' : 'created'})`)

const old = await cal.events.list({ calendarId, privateExtendedProperty: ['seed=1'], timeMin: now().minus({ days: 30 }).toISO()!, singleEvents: true, maxResults: 2500 })
for (const e of old.data.items ?? []) await cal.events.delete({ calendarId, eventId: e.id! })
const { cal: calendar } = googlePorts()
const appts = demoAppts()
for (const a of appts) await calendar.add(a)
console.log(`Calendar: removed ${old.data.items?.length ?? 0} old demo events, added ${appts.length}:`)
for (const a of appts) console.log(`  ${new Date(a.start).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}  ${a.title}`)
