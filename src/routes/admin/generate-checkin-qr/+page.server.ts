import { countDistinct, desc, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { checkIn, user } from '$lib/server/db/schema';
import { bucketToken, msUntilNextBucket } from '$lib/server/scan-token';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const checkinUrl = new URL('/checkin', env.ORIGIN);
	checkinUrl.searchParams.set('t', bucketToken());

	const [qr, [{ present }], expected, recent] = await Promise.all([
		// Rendered here rather than in the browser so the page needs no QR library.
		QRCode.toString(checkinUrl.toString(), { type: 'svg', margin: 1, width: 420 }),
		// Distinct: re-entry writes another row, and the headline number is people.
		db.select({ present: countDistinct(checkIn.userId) }).from(checkIn),
		db.$count(user, eq(user.role, 'attendee')),
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

	return { qr, present, expected, recent, msUntilNextBucket: msUntilNextBucket() };
};
