import { countDistinct, desc, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';
import { resolve } from '$app/paths';
import { db } from '$lib/server/db';
import { checkIn, user } from '$lib/server/db/schema';
import { bucketToken, msUntilNextBucket } from '$lib/server/scan-token';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const checkinUrl = new URL(resolve('/checkin'), env.ORIGIN);
	// The admin layout already turned away anyone who isn't one.
	checkinUrl.searchParams.set('t', bucketToken(event.locals.user!.id));

	const [qr, [{ present }], recent] = await Promise.all([
		// Rendered here rather than in the browser so the page needs no QR library.
		QRCode.toString(checkinUrl.toString(), { type: 'svg', margin: 1, width: 420 }),
		// Distinct: re-entry writes another row, and the headline number is people.
		db.select({ present: countDistinct(checkIn.userId) }).from(checkIn),
		db
			.select({
				id: checkIn.id,
				at: checkIn.checkedInAt,
				firstName: user.firstName,
				lastName: user.lastName
			})
			.from(checkIn)
			.innerJoin(user, eq(user.id, checkIn.userId))
			.orderBy(desc(checkIn.checkedInAt))
			.limit(5)
	]);

	// No "of how many": there is no guest list, only whoever has opened the
	// Moodle activity so far, which says nothing about who is coming.
	return { qr, present, recent, msUntilNextBucket: msUntilNextBucket() };
};
