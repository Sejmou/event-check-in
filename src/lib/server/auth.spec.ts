import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { auth, mintSession } from './auth';
import { db } from './db';
import { checkIn, session, user, verification } from './db/schema';

const GUEST = 'guest@example.com';
const ADMIN = 'ops@example.com';

beforeAll(async () => {
	// `.env.test` points DATABASE_URL at a scratch file; read it from the same
	// place the app does so the schema push and the app client can't diverge.
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
		stdio: 'ignore',
		env: { ...process.env, DATABASE_URL: env.DATABASE_URL }
	});

	// Emptied rather than deleted: `db` already holds an open handle to the file.
	// session/account/passkey cascade from user.
	await db.delete(user);
	await db.delete(verification);
});

async function seedGuest() {
	await db.insert(user).values({
		id: crypto.randomUUID(),
		email: GUEST,
		name: 'Ada Lovelace',
		firstName: 'Ada',
		lastName: 'Lovelace',
		role: 'attendee',
		emailVerified: false
	});
}

test('registration is closed', async () => {
	await expect(
		auth.api.signUpEmail({
			body: {
				email: 'walkup@example.com',
				password: 'correct-horse',
				name: 'W U',
				firstName: 'W',
				lastName: 'U'
			}
		})
	).rejects.toThrow();

	expect(await db.$count(user, eq(user.email, 'walkup@example.com'))).toBe(0);
});

test('a seeded guest is signed in without a credential, so they can add a passkey', async () => {
	await seedGuest();

	const [guest] = await db.select().from(user).where(eq(user.email, GUEST));

	// sveltekitCookies needs a real request and throws without one. The session
	// row is written before that, and the row is what /setup relies on.
	await mintSession(GUEST, new Headers()).catch(() => {});

	expect(await db.$count(session, eq(session.userId, guest.id))).toBe(1);
});

test('a guest has no password to sign in with', async () => {
	const [guest] = await db.select().from(user).where(eq(user.email, GUEST));
	const before = await db.$count(session, eq(session.userId, guest.id));

	await auth.api.signInEmail({ body: { email: GUEST, password: '' } }).catch(() => {});
	await auth.api.signInEmail({ body: { email: GUEST, password: 'correct-horse' } }).catch(() => {});

	expect(await db.$count(session, eq(session.userId, guest.id))).toBe(before);
});

test('the seeded admin signs in with their password and is an admin', async () => {
	const ctx = await auth.$context;

	const created = await ctx.internalAdapter.createUser(
		{
			email: ADMIN,
			name: 'Ops Admin',
			firstName: 'Ops',
			lastName: 'Admin',
			role: 'admin',
			emailVerified: true
		},
		{ method: 'admin' }
	);
	await ctx.internalAdapter.linkAccount({
		userId: created.id,
		accountId: created.id,
		providerId: 'credential',
		password: await ctx.password.hash('hunter2hunter2')
	});

	const sessions = () => db.$count(session, eq(session.userId, created.id));

	await auth.api
		.signInEmail({ body: { email: ADMIN, password: 'hunter2hunter2' } })
		.catch(() => {});
	expect(await sessions()).toBe(1);

	await auth.api
		.signInEmail({ body: { email: ADMIN, password: 'wrong-password' } })
		.catch(() => {});
	expect(await sessions()).toBe(1);

	const [row] = await db.select().from(user).where(eq(user.email, ADMIN));
	expect(row.role).toBe('admin');
});

test('one scan checks a guest in once, a later scan checks them in again', async () => {
	const [guest] = await db.select().from(user).where(eq(user.email, GUEST));

	const arrive = (scanId: string) =>
		db
			.insert(checkIn)
			.values({ userId: guest.id, method: 'passkey', scanId, ipAddress: '10.0.0.1' })
			.onConflictDoNothing();

	await arrive('scan-one');
	// Double submit riding the same scan: dropped by the unique index.
	await arrive('scan-one');
	expect(await db.$count(checkIn, eq(checkIn.userId, guest.id))).toBe(1);

	// Stepping out and back in is a fresh scan, and a row of its own.
	await arrive('scan-two');
	expect(await db.$count(checkIn, eq(checkIn.userId, guest.id))).toBe(2);
});
