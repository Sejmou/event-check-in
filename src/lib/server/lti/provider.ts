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
 * Moodle has just vouched for who this is. Match them to the guest list by
 * email and send them on to set up this browser, carrying that proof along
 * in the URL fragment.
 */
provider.onResourceLink(async (context, _request, response) => {
	const enroll = resolve('/lti-link/enroll');

	// Only there if the tool's privacy setting in Moodle shares it.
	const email = context.idToken.user.email?.trim().toLowerCase();
	if (!email) return response.redirect(`${enroll}?problem=no-email`);

	const guest = db
		.select({ id: user.id, firstName: user.firstName })
		.from(user)
		.where(eq(user.email, email))
		.get();
	if (!guest) return response.redirect(`${enroll}?problem=not-invited`);

	const token = issueEnrollment({
		userId: guest.id,
		ltiSubject: JSON.stringify([context.idToken.platform.url, context.idToken.user.id]),
		firstName: guest.firstName
	});
	response.redirect(`${enroll}#${token}`);
});
