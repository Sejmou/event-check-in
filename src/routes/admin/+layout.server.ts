import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { passkey } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

// Underscore prefix: SvelteKit only allows its own named exports from route modules.
export const _SKIP_PASSKEY_COOKIE = 'skip_passkey_prompt';

export const load: LayoutServerLoad = async (event) => {
	const user = event.locals.user;
	if (user?.role !== 'admin') redirect(302, resolve('/login'));

	// "Has this admin set up a passkey yet" is the passkey table — no column needed.
	const hasPasskey = (await db.$count(passkey, eq(passkey.userId, user.id))) > 0;

	if (
		!hasPasskey &&
		!event.cookies.get(_SKIP_PASSKEY_COOKIE) &&
		event.url.pathname !== resolve('/admin/setup-passkey')
	) {
		redirect(302, resolve('/admin/setup-passkey'));
	}

	return { user, hasPasskey };
};
