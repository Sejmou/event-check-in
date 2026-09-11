import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * What a scanned code lets you do. Kept apart on purpose: claiming is an
 * unauthenticated route to an account, check-in needs a credential you already
 * have. Every signature below is bound to one of these, so the claim desk's
 * code is useless on the check-in screen and a leaked one rotates alone.
 *
 * The value doubles as the route it unlocks, hence the cookie path below.
 */
export type Purpose = 'claim' | 'checkin';

/** How long one QR code stays on screen before it rotates. */
export const BUCKET_MS = 30_000;

/**
 * How long a guest has to finish after scanning. Decoupled from BUCKET_MS on
 * purpose: the code may rotate while they're still typing.
 */
const PRESENCE_MS = 10 * 60_000;

function hmac(message: string) {
	// better-auth refuses to start without it, so this only fires if that ever
	// stops being true — signing a QR token with nothing is not a fallback.
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('BETTER_AUTH_SECRET is not set');

	return createHmac('sha256', secret).update(message).digest('base64url');
}

function equals(a: string, b: string) {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * The QR payload. Derived from the clock rather than stored, so it rotates by
 * itself, needs no cleanup, and — the point of a kiosk code — is usable by
 * everyone who scans it during its window.
 */
export function bucketToken(purpose: Purpose, at = Date.now()) {
	return hmac(`${purpose}:${Math.floor(at / BUCKET_MS)}`);
}

/** Milliseconds until the on-screen code changes. */
export function msUntilNextBucket(at = Date.now()) {
	return BUCKET_MS - (at % BUCKET_MS);
}

/** Accepts the current bucket and the previous one, so a scan mid-rotation survives. */
export function verifyBucketToken(purpose: Purpose, token: string, at = Date.now()) {
	return (
		equals(token, bucketToken(purpose, at)) || equals(token, bucketToken(purpose, at - BUCKET_MS))
	);
}

/** Proof the holder scanned a live code, in a form that outlives one rotation. */
export function issuePresence(purpose: Purpose, at = Date.now()) {
	const expiresAt = at + PRESENCE_MS;
	return `${expiresAt}.${hmac(`presence:${purpose}:${expiresAt}`)}`;
}

export function verifyPresence(purpose: Purpose, value: string | undefined, at = Date.now()) {
	if (!value) return false;
	const [expiresAt, signature] = value.split('.');
	if (!expiresAt || !signature) return false;
	if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < at) return false;
	return equals(signature, hmac(`presence:${purpose}:${expiresAt}`));
}

/** When the scan happened, recovered from the token the scan handed out. */
export function presenceIssuedAt(value: string) {
	return Number(value.split('.')[0]) - PRESENCE_MS;
}

/**
 * A stable, non-secret handle for one scan, safe to store next to a check-in.
 * Truncated so the row can never be replayed as the presence token itself.
 */
export function scanId(value: string) {
	return value.split('.')[1].slice(0, 16);
}

export const presenceCookie = (purpose: Purpose) => `${purpose}_presence`;

export const presenceCookieOptions = (purpose: Purpose) =>
	({
		path: `/${purpose}`,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: PRESENCE_MS / 1000
	}) as const;
