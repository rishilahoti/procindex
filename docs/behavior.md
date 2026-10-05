# Behavior

## What it handles and what it hands off

| Caller wants | Agent |
|---|---|
| book / change / cancel | does it. Availability comes from the calendar and `src/scheduling/slots.ts`; a booking re-checks under a lock, so two callers can't take the same slot. Callers only reach appointments under the phone number they give. |
| pricing, hours, prep, "do you do my vehicle?" | answers from `src/shop.ts` only. Motorcycles/RVs/boats: says no. |
| running late | notes it on the calendar event. Up to 15 min and not into the next car: slot kept. Otherwise offers to reschedule. |
| complaint about a charge, refund, damage, quality | **hands off**: takes name, number and a one-line reason, no promises. |
| ceramic coating etc., exotic/classic vehicles, anything not in `shop.ts`, "let me talk to someone" | **hands off** the same way. |

A handoff is a callback request: the caller's row in the **Contacts** sheet gets `Callback Needed = YES: <reason>` and a `HANDOFF` line in `Call Log`. There is no live transfer: add Vapi's `transferCall` when the shop has a staffed line.

## The tools

Each is one file in `src/receptionist/tools/`, shared by chat and phone:

| Tool | Does |
|---|---|
| `check_availability` | is a service open at a day and time; if not, the nearest alternatives |
| `book_appointment` | books it, re-checking availability under a lock |
| `find_appointments` | a caller's upcoming bookings, by phone number |
| `reschedule_appointment` | moves one, ignoring its own current slot |
| `cancel_appointment` | cancels one |
| `report_running_late` | notes it on the event and says whether the slot can be kept |
| `request_callback` | the handoff above |
| `log_call` | records anything else that came up on the call |

## The Contacts tab

One row per caller, keyed by phone: Name, Vehicle, Calls, First/Last Call, Callback Needed, Call Log (one timestamped line per thing that came up), Last Call ID. Bookings, changes, late notices and callbacks log themselves; `log_call` records everything else (questions answered, outcome). Logging is fire-and-forget: a Sheets failure never fails a booking.

## Assumptions: placeholders in `src/shop.ts`, replace with the real shop's

Services and prices (3 services by vehicle size), job lengths, hours (Mon-Fri 8-6, Sat 9-4, Sun closed), one bay, 2-hour notice, 60-day horizon, the 15-minute lateness grace, the $25-$75 heavy-soil surcharge line, address and phone, and the "callback by the next business day" promise. The agent will state whatever is in that file as fact.
