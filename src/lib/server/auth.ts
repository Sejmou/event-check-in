import { building } from '$app/environment';
import { resolve } from '$app/paths';
import type { Pathname } from '$app/types';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { APIError } from 'better-auth/api';
import { passkey } from '@better-auth/passkey';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { hasAdminRole } from '$lib/server/roles';

export const auth = betterAuth({
	// ORIGIN is scheme and host only. better-auth would take any path on it as the
	// whole auth endpoint and ignore basePath, so the app's sub-path goes here.
	baseURL: env.ORIGIN,
	// Not a route of ours, hence the cast; resolve() just adds the base path.
	basePath: resolve('/api/auth' as Pathname),
	// Placeholder while `vite build` analyses the routes with no env set —
	// better-auth throws on a missing secret. See $lib/server/db.
	secret: building ? 'build-time-placeholder' : env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	// Sign-in stays on for the admin password; guests never get one.
	// disableSignUp closes /sign-up/email AND auth.api.signUpEmail — guests only
	// come from Moodle launches and the superadmin from the seed script, and
	// passwords from it or a superadmin promoting a guest on /admin.
	emailAndPassword: { enabled: true, disableSignUp: true },
	user: {
		additionalFields: {
			firstName: { type: 'string', required: true },
			lastName: { type: 'string', required: true },
			// better-auth hardcodes `name` on the user model and can't drop it.
			// Demoted to a nullable derived column; callers set it from the two above.
			name: { type: 'string', required: false, input: false },
			// attendee, admin or superadmin — see $lib/server/roles.
			role: { type: 'string', required: false, input: false, defaultValue: 'attendee' },
			// The Moodle account (`["<iss>","<sub>"]`) a guest was created from on their
			// first launch — how every later launch finds them. Empty for the seeded
			// superadmin. See $lib/server/lti/provider.
			ltiSubject: { type: 'string', required: false, input: false, unique: true },
			// Set when a superadmin promotes someone with a password they chose. The
			// admin layout holds the new admin on /admin/change-password until it's cleared.
			mustChangePassword: {
				type: 'boolean',
				required: false,
				input: false,
				defaultValue: false
			}
		}
	},
	plugins: [
		passkey({
			// No rpID: the plugin defaults it to baseURL's hostname, which is what
			// WebAuthn requires it to be anyway. A separate setting could only ever
			// drift away from ORIGIN and silently void every registered passkey.
			rpName: 'Event Check-in',
			origin: env.ORIGIN,
			// Admins only — see "Why guests have no passkeys" in the README. Guests
			// can't get a session to register one against anyway; this holds even if
			// a leftover guest passkey signs in and calls the endpoint directly.
			registration: {
				afterVerification: async ({ user: registering }) => {
					const admin = and(eq(user.id, registering.id), hasAdminRole());
					if ((await db.$count(user, admin)) === 0) {
						throw new APIError('FORBIDDEN', { message: 'Only organizers can add a passkey.' });
					}
				}
			}
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
