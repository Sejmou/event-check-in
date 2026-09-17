import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { publishCheckIn } from '$lib/server/check-in-events';
import { db } from '$lib/server/db';
import { checkIn, passkey, user } from '$lib/server/db/schema';
import {
	issuePresence,
	PRESENCE_COOKIE,
	presenceCookieOptions,
	presenceIssuedAt,
	scanId,
	TICKET_COOKIE,
	ticketCookieOptions,
	verifyBucketToken,
	verifyPresence,
	verifyTicket
} from '$lib/server/scan-token';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const NO_PRESENCE = 'This code has expired. Scan the one showing on the screen.';
const NOT_FRESH = 'We could not confirm that was you. Try again.';
const NO_TICKET =
	'More than 30 seconds passed. Open your personal link, tap "Check in now" and scan again.';

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('t');
	if (token && verifyBucketToken(token)) {
		event.cookies.set(PRESENCE_COOKIE, issuePresence(), presenceCookieOptions);
		redirect(302, '/checkin');
	}

	return {
		present: verifyPresence(event.cookies.get(PRESENCE_COOKIE)),
		// Only whether there is one — the page submits it straight back.
		hasTicket: verifyTicket(event.cookies.get(TICKET_COOKIE)) !== null
	};
};

export const actions: Actions = {
	/** A ticket from `/setup`, which this device picked up in the last 30 seconds. */
	withTicket: async (event) => {
		const presence = event.cookies.get(PRESENCE_COOKIE);
		if (!verifyPresence(presence)) return fail(403, { message: NO_PRESENCE });

		const userId = verifyTicket(event.cookies.get(TICKET_COOKIE));
		if (!userId) return fail(403, { message: NO_TICKET });
		// One ticket, one check-in.
		event.cookies.delete(TICKET_COOKIE, ticketCookieOptions);

		return record(event, userId, 'link', presence!);
	},

	/**
	 * The assertion itself was verified by better-auth's own endpoint when the
	 * browser called `signIn.passkey`, which mints a fresh session — so requiring
	 * a session newer than the scan is what proves it just happened here.
	 */
	withPasskey: async (event) => {
		const presence = event.cookies.get(PRESENCE_COOKIE);
		if (!verifyPresence(presence)) return fail(403, { message: NO_PRESENCE });

		const { user: current, session } = event.locals;
		if (!current || !session) return fail(403, { message: NOT_FRESH });
		if (session.createdAt.getTime() < presenceIssuedAt(presence!)) {
			return fail(403, { message: NOT_FRESH });
		}
		// ponytail: an admin's fresh *password* sign-in in another tab would also
		// land here and be filed as a passkey. Guests have no password, so it can
		// only mislabel an admin's own row.
		if ((await db.$count(passkey, eq(passkey.userId, current.id))) === 0) {
			return fail(403, { message: NOT_FRESH });
		}

		const result = await record(event, current.id, 'passkey', presence!);
		// The session was only the passkey's receipt. Guests don't stay signed in;
		// an admin checking in on their own phone does.
		if (current.role !== 'admin') await auth.api.signOut({ headers: event.request.headers });
		return result;
	}
};

async function record(
	event: RequestEvent,
	userId: string,
	method: 'passkey' | 'link',
	presence: string
) {
	const [guest] = await db
		.select({ firstName: user.firstName, lastName: user.lastName })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	// Signed tickets outlive nothing, but a guest deleted from the list in the
	// last 30 seconds would otherwise hit the foreign key.
	if (!guest) return fail(403, { message: NOT_FRESH });

	// Re-entry later means a new scan and a new row; a double submit rides the
	// same one and is dropped by the unique index.
	const [row] = await db
		.insert(checkIn)
		.values({
			userId,
			method,
			scanId: scanId(presence),
			ipAddress: event.getClientAddress(),
			userAgent: event.request.headers.get('user-agent')
		})
		.onConflictDoNothing()
		.returning({ id: checkIn.id, at: checkIn.checkedInAt });

	if (row) publishCheckIn({ ...guest, id: row.id, at: row.at.getTime() });

	return { checkedIn: guest.firstName };
}
