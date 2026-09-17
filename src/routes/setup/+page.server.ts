import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { issueTicket, TICKET_COOKIE, TICKET_MS, ticketCookieOptions } from '$lib/server/scan-token';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * The guest this link belongs to. Admins included: they are on the guest list
 * too, and a ticket only checks them in — it doesn't sign anyone in.
 */
async function guestFromLink(event: RequestEvent) {
	// Lower-cased to match the seeded rows; the unique index on email is case-sensitive.
	const email = event.url.searchParams.get('email')?.trim().toLowerCase();
	if (!email) return null;

	const [guest] = await db
		.select({ id: user.id, email: user.email, firstName: user.firstName })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return guest ?? null;
}

export const load: PageServerLoad = async (event) => {
	const guest = await guestFromLink(event);
	if (!guest) error(404, 'Not found');

	// Nothing is issued on GET: link previews and prefetching would otherwise
	// mint tickets nobody asked for.
	return { email: guest.email, firstName: guest.firstName };
};

export const actions: Actions = {
	/** Thirty seconds to go and scan the code at the door, no credential asked. */
	ticket: async (event) => {
		const guest = await guestFromLink(event);
		if (!guest) error(404, 'Not found');

		event.cookies.set(TICKET_COOKIE, issueTicket(guest.id), ticketCookieOptions);
		return { ticketSeconds: TICKET_MS / 1000 };
	}
};
