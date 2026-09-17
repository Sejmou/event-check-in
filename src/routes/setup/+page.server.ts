import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { auth, mintSession } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { passkey, user } from '$lib/server/db/schema';
import { issueTicket, TICKET_COOKIE, TICKET_MS, ticketCookieOptions } from '$lib/server/scan-token';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * The guest this link belongs to. Attendees only: an admin's address here would
 * hand anyone who knows it a session on the admin account.
 */
async function guestFromLink(event: RequestEvent) {
	// Lower-cased to match the seeded rows; the unique index on email is case-sensitive.
	const email = event.url.searchParams.get('email')?.trim().toLowerCase();
	if (!email) return null;

	const [guest] = await db
		.select({ id: user.id, email: user.email, firstName: user.firstName })
		.from(user)
		.where(and(eq(user.email, email), eq(user.role, 'attendee')))
		.limit(1);
	return guest ?? null;
}

const hasPasskey = async (userId: string) =>
	(await db.$count(passkey, eq(passkey.userId, userId))) > 0;

export const load: PageServerLoad = async (event) => {
	const guest = await guestFromLink(event);
	if (!guest) error(404, 'Not found');

	// Nothing is issued on GET: link previews and prefetching would otherwise
	// mint tickets and sessions nobody asked for.
	return { email: guest.email, firstName: guest.firstName, hasPasskey: await hasPasskey(guest.id) };
};

export const actions: Actions = {
	/** Thirty seconds to go and scan the code at the door, no credential asked. */
	ticket: async (event) => {
		const guest = await guestFromLink(event);
		if (!guest) error(404, 'Not found');

		event.cookies.set(TICKET_COOKIE, issueTicket(guest.id), ticketCookieOptions);
		return { ticketSeconds: TICKET_MS / 1000 };
	},

	/** Step one of adding a passkey: a session for the browser to register it against. */
	startPasskey: async (event) => {
		const guest = await guestFromLink(event);
		if (!guest) error(404, 'Not found');

		await mintSession(guest.email, event.request.headers);
		return { registering: true };
	},

	finishPasskey: async (event) => {
		const guest = await guestFromLink(event);
		if (!guest) error(404, 'Not found');
		if (event.locals.user?.id !== guest.id) {
			return fail(403, { message: 'That took too long. Start again.' });
		}
		if (!(await hasPasskey(guest.id))) {
			return fail(400, { message: 'That passkey did not save. Try again.' });
		}

		// The passkey is the credential from here on; the session only existed to
		// register it, and guests don't stay signed in.
		await auth.api.signOut({ headers: event.request.headers });
		return { passkeySaved: true };
	}
};
