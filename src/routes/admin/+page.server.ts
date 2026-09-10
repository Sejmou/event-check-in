import { isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { bucketToken, msUntilNextBucket } from '$lib/server/scan-token';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const claimUrl = new URL('/claim', env.ORIGIN);
	claimUrl.searchParams.set('t', bucketToken('claim'));

	const [qr, total, unclaimed] = await Promise.all([
		// Rendered here rather than in the browser so the page needs no QR library.
		QRCode.toString(claimUrl.toString(), { type: 'svg', margin: 1, width: 420 }),
		db.$count(user),
		db.$count(user, isNull(user.claimedAt))
	]);

	return { qr, claimed: total - unclaimed, total, msUntilNextBucket: msUntilNextBucket() };
};
