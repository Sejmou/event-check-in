import { redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { checkIn } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) redirect(302, '/login');
	// Signed in but no credential yet — finish claiming first.
	if (!user.claimedAt) redirect(302, '/claim');

	const [last] = await db
		.select({ at: checkIn.checkedInAt })
		.from(checkIn)
		.where(eq(checkIn.userId, user.id))
		.orderBy(desc(checkIn.checkedInAt))
		.limit(1);

	return { user, lastCheckIn: last ?? null };
};

export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
