import { resolve } from '$app/paths';
import { eq } from 'drizzle-orm';
import { Provider } from 'ltijs';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { issueEnrollment } from '$lib/server/scan-token';
import { DrizzleDatabaseManager } from './database-manager';
import { SvelteKitHttpHandler } from './http-handler';

export const httpHandler = new SvelteKitHttpHandler();

/**
 * The LTI 1.3 tool Moodle launches when a guest opens the check-in activity.
 * Mounted at /lti-link by `src/routes/lti-link/[...path]`; see "Moodle" in
 * the README for the URLs to give Moodle.
 *
 * Never `listen()`ed: that would connect a database we already have, start a
 * server we don't want, and install a SIGINT handler that exits the process
 * behind adapter-node's back.
 */
export const provider = new Provider({
	databaseManager: new DrizzleDatabaseManager(),
	httpHandler,
	routes: { loginRoute: '/login', launchRoute: '/launch', keysetRoute: '/keys' }
});

/**
 * Moodle has just vouched for who this is. Find the guest by their Moodle
 * account, creating them on their first launch, and send them on to set up
 * this browser, carrying that proof along in the URL fragment.
 *
 * There is no guest list: anyone who can open the activity becomes a guest.
 * The Moodle roles claim is ignored on purpose — it doesn't map Moodle's roles
 * the way we'd need, and who is an organizer is decided here, not in Moodle.
 */
provider.onResourceLink(async (context, _request, response) => {
	const enroll = resolve('/lti-link/enroll');
	const { user: launcher, platform } = context.idToken;
	// `sub` is Moodle's user ID: permanent, unlike the email, and only unique
	// within one Moodle, hence the issuer alongside it.
	const ltiSubject = JSON.stringify([platform.url, launcher.id]);

	// One transaction: two launches racing for a new guest can't both create them.
	const guest = db.transaction((tx) => {
		const found = tx
			.select({ id: user.id, firstName: user.firstName })
			.from(user)
			.where(eq(user.ltiSubject, ltiSubject))
			.get();
		if (found) return found;

		// Only there if the tool's privacy settings in Moodle share them.
		const email = launcher.email?.trim().toLowerCase();
		const firstName = launcher.givenName?.trim();
		const lastName = launcher.familyName?.trim();
		if (!email || !firstName || !lastName) return 'no-profile';

		// Deliberately not linked by email: the address is whatever the Moodle
		// profile says, and the account already holding it (the seeded superadmin,
		// say) may belong to someone else.
		if (tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) {
			return 'email-taken';
		}

		return tx
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				email,
				name: `${firstName} ${lastName}`,
				firstName,
				lastName,
				role: 'attendee',
				ltiSubject
			})
			.returning({ id: user.id, firstName: user.firstName })
			.get();
	});
	if (typeof guest === 'string') return response.redirect(`${enroll}?problem=${guest}`);

	const token = issueEnrollment({ userId: guest.id, firstName: guest.firstName });
	response.redirect(`${enroll}#${token}`);
});
