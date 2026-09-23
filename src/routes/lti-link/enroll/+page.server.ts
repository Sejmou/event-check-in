import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { enrollMessage } from '$lib/device-key';
import { db } from '$lib/server/db';
import { deviceKey, user } from '$lib/server/db/schema';
import { parsePublicKey, verifySignature } from '$lib/server/device-key';
import { verifyEnrollment } from '$lib/server/scan-token';
import type { Actions, PageServerLoad } from './$types';

const PROBLEMS = {
	'no-profile':
		"Moodle didn't tell us your name and email address, which we need to set you up. Let the organizers know: the activity's privacy settings in Moodle need to share both.",
	'email-taken':
		"Your email address already belongs to another account here, for example an organizer's. Organizers check in with their passkey. Anyone else: let the organizers know."
} as const;

const EXPIRED =
	'This setup link has expired or was already used. Open the check-in activity in Moodle again.';
const BAD_KEY = 'Something went wrong creating the key. Try again.';

export const load: PageServerLoad = ({ url }) => {
	const problem = url.searchParams.get('problem');
	return {
		problem: problem && problem in PROBLEMS ? PROBLEMS[problem as keyof typeof PROBLEMS] : null
	};
};

export const actions: Actions = {
	/**
	 * Stores the public key this browser just made, for the guest a Moodle
	 * launch vouched for. The signature over the enrollment token shows the
	 * browser posting it holds the matching private key.
	 */
	enroll: async (event) => {
		const form = await event.request.formData();
		const token = form.get('token');
		const signature = form.get('signature');
		if (typeof token !== 'string' || typeof signature !== 'string') {
			return fail(400, { message: BAD_KEY });
		}

		const enrollment = verifyEnrollment(token);
		if (!enrollment) return fail(403, { message: EXPIRED });

		const publicKey = parsePublicKey(parseJson(form.get('publicKey')));
		if (!publicKey || !verifySignature(publicKey, enrollMessage(token), signature)) {
			return fail(400, { message: BAD_KEY });
		}

		// One transaction: two tabs racing with the same link can't both find it unspent.
		const outcome = db.transaction((tx) => {
			const guest = tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, enrollment.userId))
				.get();
			if (!guest) return EXPIRED;

			const existing = tx
				.select({ createdAt: deviceKey.createdAt })
				.from(deviceKey)
				.where(eq(deviceKey.userId, guest.id))
				.get();
			// A key set up since this link was issued spent it.
			if (existing && existing.createdAt.getTime() >= enrollment.issuedAt) return EXPIRED;

			// Replaces any earlier key, and gives it a new id, so the browser that
			// held the old one is no longer set up.
			const values = {
				id: crypto.randomUUID(),
				publicKey,
				createdAt: new Date(),
				userAgent: event.request.headers.get('user-agent')
			};
			return tx
				.insert(deviceKey)
				.values({ ...values, userId: guest.id })
				.onConflictDoUpdate({ target: deviceKey.userId, set: values })
				.returning({ keyId: deviceKey.id })
				.get();
		});

		if (typeof outcome === 'string') return fail(403, { message: outcome });
		return outcome;
	}
};

function parseJson(value: FormDataEntryValue | null): unknown {
	if (typeof value !== 'string') return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
