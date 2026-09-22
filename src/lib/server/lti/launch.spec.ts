import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { IdTokenValidationMethod } from 'ltijs';
import { env } from '$env/dynamic/private';
import { checkInMessage, enrollMessage } from '$lib/device-key';
import { actions } from '../../../routes/lti-link/enroll/+page.server';
import { db } from '../db';
import { deviceKey, ltiPlatform, user } from '../db/schema';
import { verifySignature } from '../device-key';
import { verifyEnrollment } from '../scan-token';
import { httpHandler, provider } from './provider';

// Plays Moodle: a platform key pair, and the forms Moodle's pages would post.
const MOODLE = 'https://moodle.test';
const CLIENT_ID = 'check-in-tool';
const TOOL = 'http://localhost:5173/lti-link';
const GUEST = 'lti-guest@example.com';
const platformKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

let guestId: string;

beforeAll(async () => {
	// See auth.spec.ts.
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
		stdio: 'ignore',
		env: { ...process.env, DATABASE_URL: env.DATABASE_URL }
	});
	db.delete(ltiPlatform).where(eq(ltiPlatform.url, MOODLE)).run();
	db.delete(user).where(eq(user.email, GUEST)).run();

	guestId = crypto.randomUUID();
	db.insert(user)
		.values({ id: guestId, email: GUEST, firstName: 'Ada', lastName: 'Lovelace', role: 'attendee' })
		.run();

	await provider.platformManager.registerPlatform({
		name: 'Moodle',
		url: MOODLE,
		clientId: CLIENT_ID,
		authenticationEndpoint: `${MOODLE}/mod/lti/auth.php`,
		accessTokenEndpoint: `${MOODLE}/mod/lti/token.php`,
		idTokenValidation: {
			method: IdTokenValidationMethod.RsaKey,
			key: platformKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
		}
	});
});

function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
	const request = new Request(`${TOOL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		body: new URLSearchParams(fields)
	});
	return httpHandler.handle({ request, url: new URL(request.url) } as never, path);
}

/** Moodle's login initiation, then the state ltijs hands the browser to keep. */
async function login() {
	const response = await post('/login', {
		iss: MOODLE,
		client_id: CLIENT_ID,
		login_hint: '42',
		target_link_uri: `${TOOL}/launch`
	});
	expect(response?.status).toBe(200);
	const html = await response!.text();
	const data = JSON.parse(html.match(/id="ltijs-login-data">(.*?)<\/script>/s)![1]);
	return {
		state: data.state as string,
		recoveryToken: data.recoveryToken as string,
		nonce: new URL(data.targetUrl).searchParams.get('nonce')!
	};
}

function idToken(nonce: string, claims: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	const lti = 'https://purl.imsglobal.org/spec/lti/claim';
	const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const body = `${segment({ alg: 'RS256', typ: 'JWT', kid: 'moodle' })}.${segment({
		iss: MOODLE,
		sub: '42',
		aud: CLIENT_ID,
		iat: now,
		exp: now + 60,
		nonce,
		email: 'LTI-Guest@example.com',
		[`${lti}/version`]: '1.3.0',
		[`${lti}/deployment_id`]: '1',
		[`${lti}/roles`]: [],
		[`${lti}/message_type`]: 'LtiResourceLinkRequest',
		[`${lti}/target_link_uri`]: `${TOOL}/launch`,
		[`${lti}/resource_link`]: { id: 'check-in' },
		...claims
	})}`;
	const signature = createSign('RSA-SHA256').update(body).sign(platformKeys.privateKey);
	return `${body}.${signature.toString('base64url')}`;
}

/** The whole launch, as Moodle and ltijs's own pages would drive it. */
async function launch(claims: Record<string, unknown> = {}) {
	const { state, recoveryToken, nonce } = await login();
	const id_token = idToken(nonce, claims);

	// Moodle's cross-origin post: ltijs answers with a page that fetches the
	// state back out of the browser's storage...
	const first = await post('/launch', { id_token, state }, { 'sec-fetch-site': 'cross-site' });
	expect(await first!.text()).toContain('ltijs_recovered_state');

	// ...and posts it back from our own origin.
	return post(
		'/launch',
		{ id_token, state, ltijs_recovered_state: recoveryToken },
		{ 'sec-fetch-site': 'same-origin' }
	);
}

async function enroll(token: string) {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
		'sign',
		'verify'
	]);
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		pair.privateKey,
		new TextEncoder().encode(enrollMessage(token))
	);
	const request = new Request('http://localhost:5173/lti-link/enroll?/enroll', {
		method: 'POST',
		body: new URLSearchParams({
			token,
			publicKey: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)),
			signature: Buffer.from(signature).toString('base64url')
		})
	});
	return { privateKey: pair.privateKey, result: await actions.enroll({ request } as never) };
}

function tokenFrom(response: Response | null) {
	expect(response?.status).toBe(303);
	const location = new URL(response!.headers.get('location')!, TOOL);
	expect(location.pathname).toBe('/lti-link/enroll');
	return location.hash.slice(1);
}

test('a launch sends the guest Moodle vouched for on to set up their phone', async () => {
	const enrollment = verifyEnrollment(tokenFrom(await launch()));
	expect(enrollment).toMatchObject({
		userId: guestId,
		firstName: 'Ada',
		ltiSubject: JSON.stringify([MOODLE, '42'])
	});
});

test('an id_token is good for one launch', async () => {
	const { state, recoveryToken, nonce } = await login();
	const fields = { id_token: idToken(nonce), state, ltijs_recovered_state: recoveryToken };

	expect((await post('/launch', fields, { 'sec-fetch-site': 'same-origin' }))?.status).toBe(303);
	expect((await post('/launch', fields, { 'sec-fetch-site': 'same-origin' }))?.status).toBe(400);
});

test('an id_token not signed by the platform is turned down', async () => {
	const { state, recoveryToken, nonce } = await login();
	const [header, payload] = idToken(nonce).split('.');
	const forged = `${header}.${payload}.${Buffer.from('nope').toString('base64url')}`;

	const response = await post(
		'/launch',
		{ id_token: forged, state, ltijs_recovered_state: recoveryToken },
		{ 'sec-fetch-site': 'same-origin' }
	);
	// A 500, not a 400: ltijs lets jsonwebtoken's own error through, and its
	// Express handler answers that with a 500 too. What matters is no redirect.
	expect(response?.status).toBeGreaterThanOrEqual(400);
	expect(response?.headers.get('location')).toBeNull();
});

test('someone off the guest list, or without an email, is told so', async () => {
	const off = await launch({ email: 'stranger@example.com' });
	expect(off?.headers.get('location')).toBe('/lti-link/enroll?problem=not-invited');

	const hidden = await launch({ email: undefined });
	expect(hidden?.headers.get('location')).toBe('/lti-link/enroll?problem=no-email');
});

test('setting up stores a key that then checks the guest in, once per launch', async () => {
	const token = tokenFrom(await launch());
	const { privateKey, result } = await enroll(token);
	expect(result).toMatchObject({ keyId: expect.any(String) });

	const stored = db.select().from(deviceKey).where(eq(deviceKey.userId, guestId)).get()!;
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		new TextEncoder().encode(checkInMessage('scan-1'))
	);
	const signed = Buffer.from(signature).toString('base64url');
	expect(verifySignature(stored.publicKey, checkInMessage('scan-1'), signed)).toBe(true);
	// Bound to its scan: no good for the next one.
	expect(verifySignature(stored.publicKey, checkInMessage('scan-2'), signed)).toBe(false);

	// The same link again is spent.
	expect((await enroll(token)).result).toMatchObject({ status: 403 });
});

test('another Moodle account with the same email cannot take the guest over', async () => {
	await enroll(tokenFrom(await launch()));
	const before = db.select().from(deviceKey).where(eq(deviceKey.userId, guestId)).get();

	const { result } = await enroll(tokenFrom(await launch({ sub: '666' })));
	expect(result).toMatchObject({ status: 403 });
	expect(db.select().from(deviceKey).where(eq(deviceKey.userId, guestId)).get()).toEqual(before);
});

test('a public key without proof of its private half is refused', async () => {
	const token = tokenFrom(await launch());
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign'
	]);
	const request = new Request('http://localhost:5173/lti-link/enroll?/enroll', {
		method: 'POST',
		body: new URLSearchParams({
			token,
			publicKey: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)),
			signature: Buffer.from('not a signature').toString('base64url')
		})
	});
	expect(await actions.enroll({ request } as never)).toMatchObject({ status: 400 });
});
