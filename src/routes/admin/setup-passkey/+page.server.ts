import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { _SKIP_PASSKEY_COOKIE } from '../+layout.server';
import type { Actions } from './$types';

export const actions: Actions = {
	// Skipping lasts for this browser session only, so the prompt comes back on
	// the next sign-in until a passkey actually exists.
	skip: (event) => {
		event.cookies.set(_SKIP_PASSKEY_COOKIE, '1', { path: resolve('/admin'), httpOnly: true });
		redirect(302, resolve('/admin'));
	}
};
