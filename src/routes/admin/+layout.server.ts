import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { passkey } from '$lib/server/db/schema';
import { isAdmin } from '$lib/server/roles';
import type { LayoutServerLoad } from './$types';

// Underscore prefix: SvelteKit only allows its own named exports from route modules.
export const _SKIP_PASSKEY_COOKIE = 'skip_passkey_prompt';

export const load: LayoutServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user || !isAdmin(user)) redirect(302, resolve('/login'));

	// A promoted admin's password was chosen by the superadmin; nothing else opens
	// until they replace it, not even the passkey prompt.
	const changePassword = resolve('/admin/change-password');
	if (user.mustChangePassword && event.url.pathname !== changePassword) {
		redirect(302, changePassword);
	}

	// "Has this admin set up a passkey yet" is the passkey table — no column needed.
	const hasPasskey = (await db.$count(passkey, eq(passkey.userId, user.id))) > 0;

	if (
		!user.mustChangePassword &&
		!hasPasskey &&
		!event.cookies.get(_SKIP_PASSKEY_COOKIE) &&
		event.url.pathname !== resolve('/admin/setup-passkey')
	) {
		redirect(302, resolve('/admin/setup-passkey'));
	}

	return { user, hasPasskey };
};
