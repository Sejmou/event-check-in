import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { MIN_PASSWORD_LENGTH, replaceTemporaryPassword } from '$lib/server/admins';
import { isAdmin } from '$lib/server/roles';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	// The admin layout already turned away anyone who isn't one.
	return {
		temporary: Boolean(locals.user?.mustChangePassword),
		minPasswordLength: MIN_PASSWORD_LENGTH
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const current = locals.user;
		if (!current || !isAdmin(current)) error(403, 'Forbidden');

		const formData = await request.formData();
		const currentPassword = formData.get('currentPassword')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const confirm = formData.get('confirm')?.toString() ?? '';

		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { message: `At least ${MIN_PASSWORD_LENGTH} characters.` });
		}
		if (password !== confirm) return fail(400, { message: 'The passwords did not match.' });

		// A temporary password was just used to sign in, and the admin may not have it
		// any more: a reset can be signed into with a passkey. So it isn't asked for.
		if (current.mustChangePassword) {
			if ((await replaceTemporaryPassword(current.id, password)) === 'unchanged') {
				return fail(400, { message: 'Choose a password other than the one you were given.' });
			}
			redirect(302, resolve('/admin'));
		}

		try {
			await auth.api.changePassword({
				body: { currentPassword, newPassword: password, revokeOtherSessions: true },
				headers: request.headers
			});
		} catch (e) {
			if (e instanceof APIError) {
				return fail(400, { message: 'Your current password is wrong.' });
			}
			console.error('password change failed:', e);
			return fail(500, { message: 'Something went wrong. Try again.' });
		}
		return { changed: true };
	}
};
