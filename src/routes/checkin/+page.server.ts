import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { desc, eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { checkIn, passkey } from '$lib/server/db/schema';
import {
	issuePresence,
	presenceCookie,
	presenceCookieOptions,
	presenceIssuedAt,
	scanId,
	verifyBucketToken,
	verifyPresence
} from '$lib/server/scan-token';
import { tooManyAttempts } from '$lib/server/throttle';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const NO_PRESENCE = 'This code has expired. Scan the one showing on the screen.';
/** Same wording whichever half was wrong, so this can't be used to probe the guest list. */
const NO_MATCH = 'Wrong email or password.';
const NOT_FRESH = 'We could not confirm that was you. Try again.';

const MAX_ATTEMPTS = 10;

const COOKIE = presenceCookie('checkin');
const COOKIE_OPTIONS = presenceCookieOptions('checkin');

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('t');
	if (token && verifyBucketToken('checkin', token)) {
		event.cookies.set(COOKIE, issuePresence('checkin'), COOKIE_OPTIONS);
		redirect(302, '/checkin');
	}

	// Signed in but never finished setting up: there is no credential to confirm
	// with, so the desk is the only way forward.
	if (event.locals.user && !event.locals.user.claimedAt) redirect(302, '/claim');

	const presence = event.cookies.get(COOKIE);
	const present = verifyPresence('checkin', presence);
	const user = event.locals.user ?? null;

	const [last] = user
		? await db
				.select({ at: checkIn.checkedInAt, method: checkIn.method, scanId: checkIn.scanId })
				.from(checkIn)
				.where(eq(checkIn.userId, user.id))
				.orderBy(desc(checkIn.checkedInAt))
				.limit(1)
		: [];

	return {
		present,
		user,
		lastCheckIn: last ?? null,
		// Confirmation is per scan, so a guest coming back in later is asked again
		// rather than being shown a stale tick.
		checkedIn: Boolean(present && last && last.scanId === scanId(presence!))
	};
};

export const actions: Actions = {
	/**
	 * The credential check happens here, so the recorded method is what the
	 * server itself verified rather than what the browser claimed.
	 */
	withPassword: async (event) => {
		const presence = event.cookies.get(COOKIE);
		if (!verifyPresence('checkin', presence)) return fail(403, { message: NO_PRESENCE });
		if (tooManyAttempts(presence!, MAX_ATTEMPTS)) return fail(429, { message: NO_MATCH });

		const formData = await event.request.formData();
		const email = formData.get('email')?.toString().trim() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		let signedIn;
		try {
			signedIn = await auth.api.signInEmail({ body: { email, password } });
		} catch (error) {
			if (error instanceof APIError) return fail(400, { message: NO_MATCH });
			return fail(500, { message: 'Something went wrong. Try again.' });
		}

		return record(event, signedIn.user.id, 'password', presence!);
	},

	/**
	 * The assertion itself was verified by better-auth's own endpoint when the
	 * browser called `signIn.passkey`, which mints a fresh session — so requiring
	 * a session newer than the scan is what proves it just happened here.
	 */
	withPasskey: async (event) => {
		const presence = event.cookies.get(COOKIE);
		if (!verifyPresence('checkin', presence)) return fail(403, { message: NO_PRESENCE });

		const { user, session } = event.locals;
		if (!user || !session) return fail(403, { message: NOT_FRESH });
		if (session.createdAt.getTime() < presenceIssuedAt(presence!)) {
			return fail(403, { message: NOT_FRESH });
		}
		// ponytail: a fresh session from a *password* sign-in in another tab would
		// also land here and be filed as a passkey. It mislabels only the user's
		// own row and grants nothing; give better-auth's session a method column if
		// the distinction ever has to hold up.
		if ((await db.$count(passkey, eq(passkey.userId, user.id))) === 0) {
			return fail(403, { message: NOT_FRESH });
		}

		return record(event, user.id, 'passkey', presence!);
	}
};

async function record(
	event: RequestEvent,
	userId: string,
	method: 'passkey' | 'password',
	presence: string
) {
	const scan = scanId(presence);

	// Re-entry later means a new scan and a new row; a double submit rides the
	// same one and is dropped by the unique index.
	await db
		.insert(checkIn)
		.values({
			userId,
			method,
			scanId: scan,
			ipAddress: event.getClientAddress(),
			userAgent: event.request.headers.get('user-agent')
		})
		.onConflictDoNothing();

	redirect(303, '/checkin');
}
