/**
 * Cheap per-key attempt counter, so a scanned code can't be walked through a
 * guest list or a password list.
 *
 * ponytail: per-process counter, so it resets on redeploy and doesn't add up
 * across instances. Fine for one box at one event; move to the DB if this ever
 * runs more than once.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string, max: number, windowMs = 60_000) {
	const now = Date.now();
	const entry = attempts.get(key);

	if (!entry || entry.resetAt < now) {
		attempts.set(key, { count: 1, resetAt: now + windowMs });
		return false;
	}
	entry.count += 1;
	return entry.count > max;
}
