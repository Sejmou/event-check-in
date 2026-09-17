import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { auth } from '$lib/server/auth';
import { isAdmin } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (isAdmin(user)) redirect(302, resolve('/admin'));

	// Guests don't sign in. A session from a guest passkey registered before
	// guests lost them, used on /login, ends here.
	if (user) await auth.api.signOut({ headers: event.request.headers });
	return {};
};
