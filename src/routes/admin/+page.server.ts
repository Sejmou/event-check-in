import { redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const guests = await db
		.select({
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName
		})
		.from(user)
		.where(eq(user.role, 'attendee'))
		.orderBy(asc(user.lastName), asc(user.firstName));

	return {
		guests: guests.map((guest) => {
			const setupUrl = new URL('/setup', env.ORIGIN);
			setupUrl.searchParams.set('email', guest.email);
			return { ...guest, setupUrl: setupUrl.toString() };
		})
	};
};

export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
