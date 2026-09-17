import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (user?.role === 'admin') redirect(302, '/admin');

	// Guests don't sign in. A session left over from an abandoned passkey setup,
	// or a guest's passkey used on /login, ends here.
	if (user) await auth.api.signOut({ headers: event.request.headers });
	return {};
};
