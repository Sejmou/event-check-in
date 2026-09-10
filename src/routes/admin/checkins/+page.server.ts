import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { checkIn, user } from '$lib/server/db/schema';
import { annotate } from '$lib/server/check-in-log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// ponytail: the whole log in one query on one page. An event is hundreds of
	// rows; add paging when a venue makes that untrue.
	const rows = await db
		.select({
			at: checkIn.checkedInAt,
			method: checkIn.method,
			ipAddress: checkIn.ipAddress,
			userAgent: checkIn.userAgent,
			scanId: checkIn.scanId,
			userId: checkIn.userId,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email
		})
		.from(checkIn)
		.innerJoin(user, eq(user.id, checkIn.userId))
		.orderBy(desc(checkIn.checkedInAt));

	return annotate(rows);
};
