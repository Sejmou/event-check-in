import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import { resolve } from '$app/paths';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

/**
 * Where Moodle posts a form from its own origin as part of a launch. Both are
 * guarded by ltijs itself: signed state, a single-use nonce and a signed
 * id_token, none of which a forged post can produce.
 */
const LTI_FORM_POSTS = new Set<string>([resolve('/lti-link/login'), resolve('/lti-link/launch')]);

const FORM_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];

/**
 * SvelteKit's own CSRF check, less the LTI launch. SvelteKit can only switch
 * it off for everything or trust an origin for everything (see `csrf` in
 * vite.config.ts), and trusting Moodle's origin would let any page there post
 * to the admin forms too. Like SvelteKit's, it is skipped in dev.
 */
const handleCsrf: Handle = ({ event, resolve }) => {
	const { request, url } = event;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	const forbidden =
		!dev &&
		['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
		FORM_TYPES.includes(type) &&
		request.headers.get('origin') !== url.origin &&
		!LTI_FORM_POSTS.has(url.pathname);

	if (forbidden) {
		return new Response(`Cross-site ${request.method} form submissions are forbidden`, {
			status: 403
		});
	}
	return resolve(event);
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleCsrf, handleParaglide, handleBetterAuth);
