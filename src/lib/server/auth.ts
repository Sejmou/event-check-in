import { building } from '$app/environment';
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

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	// Placeholder while `vite build` analyses the routes with no env set —
	// better-auth throws on a missing secret. See $lib/server/db.
	secret: building ? 'build-time-placeholder' : env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	// Sign-in stays on for the admin password; guests never get one.
	// disableSignUp closes /sign-up/email AND auth.api.signUpEmail — accounts only
	// come from the seed script.
	emailAndPassword: { enabled: true, disableSignUp: true },
	user: {
		additionalFields: {
			firstName: { type: 'string', required: true },
			lastName: { type: 'string', required: true },
			// better-auth hardcodes `name` on the user model and can't drop it.
			// Demoted to a nullable derived column; callers set it from the two above.
			name: { type: 'string', required: false, input: false },
			role: { type: 'string', required: false, input: false, defaultValue: 'attendee' }
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
					const admin = and(eq(user.id, registering.id), eq(user.role, 'admin'));
					if ((await db.$count(user, admin)) === 0) {
						throw new APIError('FORBIDDEN', { message: 'Only organizers can add a passkey.' });
					}
				}
			}
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
