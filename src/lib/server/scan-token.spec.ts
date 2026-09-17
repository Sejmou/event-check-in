import { expect, test } from 'vitest';
import {
	BUCKET_MS,
	TICKET_MS,
	bucketToken,
	issuePresence,
	issueTicket,
	presenceIssuedAt,
	scanId,
	verifyBucketToken,
	verifyPresence,
	verifyTicket
} from './scan-token';

test('a code is accepted for its own window and the one before it', () => {
	const now = Date.now();
	const token = bucketToken(now);

	expect(verifyBucketToken(token, now)).toBe(true);
	// Scanned just before a rotation, submitted just after.
	expect(verifyBucketToken(token, now + BUCKET_MS)).toBe(true);
});

test('a code is rejected two windows later', () => {
	const now = Date.now();
	expect(verifyBucketToken(bucketToken(now), now + 2 * BUCKET_MS)).toBe(false);
});

test('a made-up code is rejected', () => {
	expect(verifyBucketToken('not-a-real-token')).toBe(false);
	expect(verifyBucketToken('')).toBe(false);
});

test('the code changes when the window rolls over', () => {
	const now = Date.now();
	expect(bucketToken(now)).not.toBe(bucketToken(now + BUCKET_MS));
});

test('presence outlives several rotations but not its own expiry', () => {
	const now = Date.now();
	const presence = issuePresence(now);

	expect(verifyPresence(presence, now + 5 * BUCKET_MS)).toBe(true);
	expect(verifyPresence(presence, now + 11 * 60_000)).toBe(false);
});

test('presence cannot be forged or tampered with', () => {
	const presence = issuePresence();
	const [expiresAt, signature] = presence.split('.');

	// Push the expiry out, keep the signature.
	expect(verifyPresence(`${Number(expiresAt) + 60_000}.${signature}`)).toBe(false);
	expect(verifyPresence(`${expiresAt}.deadbeef`)).toBe(false);
	expect(verifyPresence(undefined)).toBe(false);
	expect(verifyPresence('garbage')).toBe(false);
});

test('a scan reports when it happened and gets a handle that is not the token', () => {
	const now = Date.now();
	const presence = issuePresence(now);

	expect(presenceIssuedAt(presence)).toBe(now);
	// Two scans of the same displayed code still get their own handle.
	expect(scanId(presence)).not.toBe(scanId(issuePresence(now + 1)));
	expect(verifyPresence(scanId(presence), now)).toBe(false);
});

test('a ticket names its guest for 30 seconds and no longer', () => {
	const now = Date.now();
	const ticket = issueTicket('ada', now);

	expect(verifyTicket(ticket, now + TICKET_MS - 1)).toBe('ada');
	expect(verifyTicket(ticket, now + TICKET_MS + 1)).toBeNull();
});

test('a ticket cannot be moved to another guest or stretched', () => {
	const now = Date.now();
	const [, expiresAt, signature] = issueTicket('ada', now).split('.');

	expect(verifyTicket(`grace.${expiresAt}.${signature}`, now)).toBeNull();
	expect(verifyTicket(`ada.${Number(expiresAt) + 60_000}.${signature}`, now)).toBeNull();
	// Nor does a presence token pass for one.
	expect(verifyTicket(issuePresence(now), now)).toBeNull();
	expect(verifyTicket(undefined)).toBeNull();
});
