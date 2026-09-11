import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/');
	return {};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		try {
			await auth.api.signInEmail({ body: { email, password } });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: 'Wrong email or password.' });
			}
			// Whatever reaches here is not a rejected credential — a locked or
			// read-only database, say. Nobody can act on "something went wrong"
			// without it in the log.
			console.error('sign-in failed:', error);
			return fail(500, { message: 'Something went wrong. Try again.' });
		}

		redirect(302, '/');
	}
};
