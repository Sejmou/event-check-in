import { expect, test } from 'vitest';
import {
	BUCKET_MS,
	ENROLLMENT_MS,
	bucketToken,
	issueEnrollment,
	issuePresence,
	presenceIssuedAt,
	scanId,
	verifyBucketToken,
	verifyEnrollment,
	verifyPresence
} from './scan-token';

test('a code is accepted for its own window and the one before it, and names its host', () => {
	const now = Date.now();
	const token = bucketToken('ops', now);

	expect(verifyBucketToken(token, now)).toBe('ops');
	// Scanned just before a rotation, submitted just after.
	expect(verifyBucketToken(token, now + BUCKET_MS)).toBe('ops');
});

test('a code is rejected two windows later', () => {
	const now = Date.now();
	expect(verifyBucketToken(bucketToken('ops', now), now + 2 * BUCKET_MS)).toBeNull();
});

test('a made-up code is rejected', () => {
	expect(verifyBucketToken('not-a-real-token')).toBeNull();
	expect(verifyBucketToken('')).toBeNull();
});

test('a code cannot be moved to another host', () => {
	const now = Date.now();
	const [, signature] = bucketToken('ops', now).split('.');
	expect(verifyBucketToken(`grace.${signature}`, now)).toBeNull();
});

test('the code changes when the window rolls over', () => {
	const now = Date.now();
	expect(bucketToken('ops', now)).not.toBe(bucketToken('ops', now + BUCKET_MS));
});

test('presence outlives several rotations but not its own expiry', () => {
	const now = Date.now();
	const presence = issuePresence('ops', now);

	expect(verifyPresence(presence, now + 5 * BUCKET_MS)).toBe('ops');
	expect(verifyPresence(presence, now + 11 * 60_000)).toBeNull();
});

test('presence cannot be forged, tampered with or moved to another host', () => {
	const [, expiresAt, signature] = issuePresence('ops').split('.');

	// Push the expiry out, keep the signature.
	expect(verifyPresence(`ops.${Number(expiresAt) + 60_000}.${signature}`)).toBeNull();
	expect(verifyPresence(`ops.${expiresAt}.deadbeef`)).toBeNull();
	expect(verifyPresence(`grace.${expiresAt}.${signature}`)).toBeNull();
	expect(verifyPresence(undefined)).toBeNull();
	expect(verifyPresence('garbage')).toBeNull();
});

test('a scan reports when it happened and gets a handle that is not the token', () => {
	const now = Date.now();
	const presence = issuePresence('ops', now);

	expect(presenceIssuedAt(presence)).toBe(now);
	// Two scans of the same displayed code still get their own handle.
	expect(scanId(presence)).not.toBe(scanId(issuePresence('ops', now + 1)));
	expect(verifyPresence(scanId(presence), now)).toBeNull();
});

const ada = { userId: 'ada', firstName: 'Ada' };

test('an enrollment says who launched, for 15 minutes and no longer', () => {
	const now = Date.now();
	const token = issueEnrollment(ada, now);

	expect(verifyEnrollment(token, now + ENROLLMENT_MS - 1)).toEqual({ ...ada, issuedAt: now });
	expect(verifyEnrollment(token, now + ENROLLMENT_MS + 1)).toBeNull();
});

test('an enrollment cannot be moved to another guest or stretched', () => {
	const now = Date.now();
	const [, signature] = issueEnrollment(ada, now).split('.');
	const forge = (fields: object) =>
		`${Buffer.from(JSON.stringify({ ...ada, issuedAt: now, ...fields })).toString('base64url')}.${signature}`;

	expect(verifyEnrollment(forge({ userId: 'grace' }), now)).toBeNull();
	expect(verifyEnrollment(forge({ issuedAt: now + 60_000 }), now)).toBeNull();
	expect(verifyEnrollment(undefined)).toBeNull();
	expect(verifyEnrollment('garbage')).toBeNull();
});

test('an enrollment and a presence never pass for each other', () => {
	const now = Date.now();
	expect(verifyPresence(issueEnrollment(ada, now), now)).toBeNull();
	expect(verifyEnrollment(issuePresence('ada', now), now)).toBeNull();
});
