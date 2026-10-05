// Everything the agent knows about the shop. The prompt and the availability code both read this file,
// so this is the one place to edit. Every value is a PLACEHOLDER for the real shop: replace before going live.

export const SHOP = {
	name: 'Cedar Lane Auto Detailing',
	phone: '(415) 555-0100',
	address: '1840 Cedar Lane',
};
export const TZ = 'America/Los_Angeles'; // must match the Google Calendar's own timezone

export const SIZES = ['car', 'suv', 'xl'] as const;
export type Size = (typeof SIZES)[number];

// One bay: any overlap with another event is a conflict. Prices are by vehicle size.
export const SERVICES = {
	exterior_wash: {
		name: 'Exterior Hand Wash & Dry',
		minutes: 45,
		price: { car: 45, suv: 55, xl: 65 },
		includes: 'hand wash, wheels and tires, hand dry',
	},
	interior_wash: {
		name: 'Interior Detail & Wash',
		minutes: 90,
		price: { car: 140, suv: 165, xl: 190 },
		includes:
			'full interior vacuum and wipe-down, windows, plus exterior hand wash',
	},
	full_detail: {
		name: 'Full Detail',
		minutes: 180,
		price: { car: 260, suv: 300, xl: 340 },
		includes:
			'interior detail, exterior wash, clay bar and wax, wheels and tires',
	},
} satisfies Record<
	string,
	{
		name: string;
		minutes: number;
		price: Record<Size, number>;
		includes: string;
	}
>;
export type ServiceId = keyof typeof SERVICES;

// Luxon weekdays: 1 = Mon … 7 = Sun. [open, close] as 24h "HH:MM"; a missing day is closed.
export const HOURS: Record<number, [string, string]> = {
	1: ['08:00', '18:00'],
	2: ['08:00', '18:00'],
	3: ['08:00', '18:00'],
	4: ['08:00', '18:00'],
	5: ['08:00', '18:00'],
	6: ['09:00', '16:00'],
};

export const STEP_MIN = 30; // appointments start on the half hour
export const LEAD_MIN = 120; // minimum notice for a booking
export const HORIZON_DAYS = 60; // how far ahead callers can book
export const LATE_GRACE_MIN = 15; // how late a customer can be and still keep their slot
export const CALLBACK =
	'someone from the shop will call them back, usually by the next business day';

export const VEHICLES = {
	car: 'sedans, coupes, hatchbacks, small crossovers (EVs and hybrids included)',
	suv: 'SUVs, minivans, standard pickup trucks',
	xl: 'full-size or lifted trucks, 3-row SUVs like a Suburban or Expedition, full-size vans',
	ownerQuote:
		'exotic, classic/vintage, heavily modified or wrapped vehicles (the owner prices these by hand)',
	no: 'motorcycles, RVs/motorhomes, boats and jet skis, buses, semis and other commercial trucks',
};

export const QUOTE_ONLY =
	'ceramic coating, paint correction/polishing, engine bay cleaning, odor/ozone treatment, headlight restoration, fleet or business accounts';

export const PREP = [
	'Remove personal items, valuables and trash from the cabin and trunk. The shop is not responsible for items left in the vehicle.',
	'Remove child car seats; the shop does not reinstall them.',
	'No need to wash the vehicle beforehand.',
	'Bring every key and fob.',
	'Heavy pet hair, smoke or odor, mold or heavy spills: mention it when booking. A surcharge of $25-$75 may apply, set by the detailer once they see the vehicle. Biohazards (bodily fluids, mold) cannot be accepted.',
	'Mention wraps, matte or satin paint, or an existing ceramic coating so the detailer uses the right products.',
	`Arrive on time. Up to ${LATE_GRACE_MIN} minutes late is fine; later than that the appointment may need to be rescheduled if another car is booked after it.`,
];

export const POLICIES = [
	'Changing or cancelling an appointment is free; please give 24 hours notice when possible.',
	`Same-day bookings need at least ${LEAD_MIN / 60} hours notice; appointments can be booked up to ${HORIZON_DAYS} days ahead.`,
];
