import { expect, test } from 'vitest';
import {
	BUCKET_MS,
	bucketToken,
	issuePresence,
	presenceIssuedAt,
	scanId,
	verifyBucketToken,
	verifyPresence
} from './scan-token';

test('a code is accepted for its own window and the one before it', () => {
	const now = Date.now();
	const token = bucketToken('claim', now);

	expect(verifyBucketToken('claim', token, now)).toBe(true);
	// Scanned just before a rotation, submitted just after.
	expect(verifyBucketToken('claim', token, now + BUCKET_MS)).toBe(true);
});

test('a code is rejected two windows later', () => {
	const now = Date.now();
	expect(verifyBucketToken('claim', bucketToken('claim', now), now + 2 * BUCKET_MS)).toBe(false);
});

test('a made-up code is rejected', () => {
	expect(verifyBucketToken('claim', 'not-a-real-token')).toBe(false);
	expect(verifyBucketToken('claim', '')).toBe(false);
});

test('the code changes when the window rolls over', () => {
	const now = Date.now();
	expect(bucketToken('claim', now)).not.toBe(bucketToken('claim', now + BUCKET_MS));
});

test('the claim code and the check-in code are not interchangeable', () => {
	const now = Date.now();

	expect(bucketToken('claim', now)).not.toBe(bucketToken('checkin', now));
	// The whole point of keeping them apart: a code shown at the door cannot
	// open the account-claiming flow, and vice versa.
	expect(verifyBucketToken('checkin', bucketToken('claim', now), now)).toBe(false);
	expect(verifyBucketToken('claim', bucketToken('checkin', now), now)).toBe(false);
	expect(verifyPresence('checkin', issuePresence('claim', now), now)).toBe(false);
});

test('presence outlives several rotations but not its own expiry', () => {
	const now = Date.now();
	const presence = issuePresence('claim', now);

	expect(verifyPresence('claim', presence, now + 5 * BUCKET_MS)).toBe(true);
	expect(verifyPresence('claim', presence, now + 11 * 60_000)).toBe(false);
});

test('presence cannot be forged or tampered with', () => {
	const presence = issuePresence('claim');
	const [expiresAt, signature] = presence.split('.');

	// Push the expiry out, keep the signature.
	expect(verifyPresence('claim', `${Number(expiresAt) + 60_000}.${signature}`)).toBe(false);
	expect(verifyPresence('claim', `${expiresAt}.deadbeef`)).toBe(false);
	expect(verifyPresence('claim', undefined)).toBe(false);
	expect(verifyPresence('claim', 'garbage')).toBe(false);
});

test('a scan reports when it happened and gets a handle that is not the token', () => {
	const now = Date.now();
	const presence = issuePresence('checkin', now);

	expect(presenceIssuedAt(presence)).toBe(now);
	// Two scans of the same displayed code still get their own handle.
	expect(scanId(presence)).not.toBe(scanId(issuePresence('checkin', now + 1)));
	expect(verifyPresence('checkin', scanId(presence), now)).toBe(false);
});
