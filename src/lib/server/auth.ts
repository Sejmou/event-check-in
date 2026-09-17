import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { magicLink } from 'better-auth/plugins/magic-link';
import { passkey } from '@better-auth/passkey';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/**
 * Magic-link tokens minted server-side, keyed by email. `signInMagicLink` only
 * returns `{ status: true }`, so the token comes back through `sendMagicLink`.
 * The caller drains it immediately after the await — see `mintSession`.
 *
 * ponytail: last-write-wins if two passkey setups for the SAME email overlap. Both
 * tokens stay valid rows, so the loser just retries. Swap for AsyncLocalStorage
 * if that ever shows up in practice.
 */
const pendingTokens = new Map<string, string>();

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
	// Checked in the router's onRequest, so these 404 over HTTP while
	// auth.api.signInMagicLink / magicLinkVerify keep working from our own code.
	disabledPaths: ['/sign-in/magic-link', '/magic-link/verify'],
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
		// Not the QR token — this is the session-minting primitive, used entirely
		// server-side once a guest's email is known. Never reachable over HTTP.
		magicLink({
			disableSignUp: true,
			storeToken: 'hashed',
			expiresIn: 60,
			sendMagicLink: async ({ email, token }) => {
				pendingTokens.set(email, token);
			}
		}),
		passkey({
			// No rpID: the plugin defaults it to baseURL's hostname, which is what
			// WebAuthn requires it to be anyway. A separate setting could only ever
			// drift away from ORIGIN and silently void every registered passkey.
			rpName: 'Event Check-in',
			origin: env.ORIGIN
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});

/**
 * Signs `email` in without a credential, so a guest has a session to register a
 * passkey against. That endpoint sits behind sessionMiddleware, hence the
 * chicken-and-egg this solves. Guests are signed out again as soon as the
 * passkey is saved — the session is scaffolding, not a login.
 *
 * Caller must have already checked the email belongs to a guest, never an admin:
 * this hands out a session to anyone who knows the address.
 */
export async function mintSession(email: string, headers: Headers) {
	await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });

	const token = pendingTokens.get(email);
	pendingTokens.delete(email);
	if (!token) throw new Error(`magic link token was not captured for ${email}`);

	// No callbackURL, so this returns JSON instead of throwing a redirect.
	// sveltekitCookies turns its Set-Cookie into a real cookie on the response.
	return auth.api.magicLinkVerify({ query: { token }, headers });
}
