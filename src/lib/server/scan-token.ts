import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/** How long one QR code stays on screen before it rotates. */
export const BUCKET_MS = 30_000;

/**
 * How long a guest has to finish after scanning. Decoupled from BUCKET_MS on
 * purpose: the code may rotate while they're still confirming.
 */
const PRESENCE_MS = 10 * 60_000;

/** How long a ticket from `/setup` stays good for. The whole window to go and scan. */
export const TICKET_MS = 30_000;

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
export function bucketToken(at = Date.now()) {
	return hmac(`checkin:${Math.floor(at / BUCKET_MS)}`);
}

/** Milliseconds until the on-screen code changes. */
export function msUntilNextBucket(at = Date.now()) {
	return BUCKET_MS - (at % BUCKET_MS);
}

/** Accepts the current bucket and the previous one, so a scan mid-rotation survives. */
export function verifyBucketToken(token: string, at = Date.now()) {
	return equals(token, bucketToken(at)) || equals(token, bucketToken(at - BUCKET_MS));
}

/** Proof the holder scanned a live code, in a form that outlives one rotation. */
export function issuePresence(at = Date.now()) {
	const expiresAt = at + PRESENCE_MS;
	return `${expiresAt}.${hmac(`presence:${expiresAt}`)}`;
}

export function verifyPresence(value: string | undefined, at = Date.now()) {
	if (!value) return false;
	const [expiresAt, signature] = value.split('.');
	if (!expiresAt || !signature) return false;
	if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < at) return false;
	return equals(signature, hmac(`presence:${expiresAt}`));
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

/**
 * Says "this device may check `userId` in", for guests without a passkey. Handed
 * out by `/setup` to anyone holding the guest's link, so all that keeps it honest
 * is how short it lives and the check-in screen showing every name that uses one.
 */
export function issueTicket(userId: string, at = Date.now()) {
	const expiresAt = at + TICKET_MS;
	return `${userId}.${expiresAt}.${hmac(`ticket:${userId}:${expiresAt}`)}`;
}

/** The user the ticket is for, or null if it is expired or not ours. */
export function verifyTicket(value: string | undefined, at = Date.now()) {
	if (!value) return null;
	const [userId, expiresAt, signature] = value.split('.');
	if (!userId || !expiresAt || !signature) return null;
	if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < at) return null;
	return equals(signature, hmac(`ticket:${userId}:${expiresAt}`)) ? userId : null;
}

export const PRESENCE_COOKIE = 'checkin_presence';
export const TICKET_COOKIE = 'checkin_ticket';

export const presenceCookieOptions = {
	path: '/checkin',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: PRESENCE_MS / 1000
} as const;

// Lax, not strict: the scan arrives as a top-level navigation from the camera
// app, and strict would leave the cookie behind.
export const ticketCookieOptions = {
	path: '/checkin',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: TICKET_MS / 1000
} as const;
