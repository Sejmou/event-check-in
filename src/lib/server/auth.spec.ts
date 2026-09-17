import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { listAdmins, promoteToAdmin, replaceTemporaryPassword, resetAdminPassword } from './admins';
import { auth } from './auth';
import { checkInHost } from './check-in-host';
import { db } from './db';
import { isAdmin } from './roles';
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

test('a guest has no password to sign in with', async () => {
	await seedGuest();
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

test('a promoted guest signs in with the initial password until they replace it', async () => {
	const PROMOTED = 'helper@example.com';
	await db.insert(user).values({
		id: crypto.randomUUID(),
		email: PROMOTED,
		name: 'Grace Hopper',
		firstName: 'Grace',
		lastName: 'Hopper',
		role: 'attendee',
		emailVerified: false
	});

	expect(await promoteToAdmin('nobody@example.com', 'initial-pass')).toBe('not-found');
	expect(await promoteToAdmin(ADMIN, 'initial-pass')).toBe('already-admin');
	expect(await promoteToAdmin(' Helper@Example.com ', 'initial-pass')).toBe('promoted');

	const [promoted] = await db.select().from(user).where(eq(user.email, PROMOTED));
	expect(promoted).toMatchObject({ role: 'admin', mustChangePassword: true });

	const sessions = () => db.$count(session, eq(session.userId, promoted.id));
	const signIn = (password: string) =>
		auth.api.signInEmail({ body: { email: PROMOTED, password } }).catch(() => {});

	await signIn('initial-pass');
	expect(await sessions()).toBe(1);

	expect(await replaceTemporaryPassword(promoted.id, 'initial-pass')).toBe('unchanged');
	expect(await replaceTemporaryPassword(promoted.id, 'my-own-pass')).toBe('changed');

	const [after] = await db.select().from(user).where(eq(user.id, promoted.id));
	expect(after.mustChangePassword).toBe(false);

	await signIn('initial-pass');
	expect(await sessions()).toBe(1);
	await signIn('my-own-pass');
	expect(await sessions()).toBe(2);
});

test('one scan checks a guest in once, a later scan checks them in again', async () => {
	const [guest] = await db.select().from(user).where(eq(user.email, GUEST));

	const arrive = (scanId: string) =>
		db
			.insert(checkIn)
			.values({ userId: guest.id, method: 'link', scanId, ipAddress: '10.0.0.1' })
			.onConflictDoNothing();

	await arrive('scan-one');
	// Double submit riding the same scan: dropped by the unique index.
	await arrive('scan-one');
	expect(await db.$count(checkIn, eq(checkIn.userId, guest.id))).toBe(1);

	// Stepping out and back in is a fresh scan, and a row of its own.
	await arrive('scan-two');
	expect(await db.$count(checkIn, eq(checkIn.userId, guest.id))).toBe(2);
});

test("the first guest through an admin's code checks that admin in, once", async () => {
	const [admin] = await db.select().from(user).where(eq(user.email, ADMIN));
	const [guest] = await db.select().from(user).where(eq(user.email, GUEST));
	const hostRows = () => db.select().from(checkIn).where(eq(checkIn.userId, admin.id));

	expect(checkInHost(admin.id, 'scan-three')).toMatchObject({ firstName: 'Ops' });
	const [row] = await hostRows();
	expect(row).toMatchObject({ method: 'host', scanId: 'scan-three', ipAddress: null });

	// The next guest through the same screen doesn't add another.
	expect(checkInHost(admin.id, 'scan-four')).toBeNull();
	expect(await hostRows()).toHaveLength(1);

	// A code naming someone who isn't an admin checks nobody in.
	await db.delete(checkIn).where(eq(checkIn.userId, guest.id));
	expect(checkInHost(guest.id, 'scan-five')).toBeNull();
	expect(await db.$count(checkIn, eq(checkIn.userId, guest.id))).toBe(0);
});

test('the superadmin is an admin everywhere an admin is', async () => {
	const id = crypto.randomUUID();
	await db.insert(user).values({
		id,
		email: 'super@example.com',
		name: 'Super Admin',
		firstName: 'Super',
		lastName: 'Admin',
		role: 'superadmin',
		emailVerified: true
	});

	expect(isAdmin({ role: 'superadmin' })).toBe(true);
	expect(isAdmin({ role: 'attendee' })).toBe(false);
	expect(isAdmin(undefined)).toBe(false);
	expect((await listAdmins()).map((a) => a.email)).toContain('super@example.com');
	expect(await promoteToAdmin('super@example.com', 'initial-pass')).toBe('already-admin');
	// The SQL side of isAdmin: the host check-in only goes through for admins.
	expect(checkInHost(id, 'scan-six')).toMatchObject({ firstName: 'Super' });
});

test('a reset signs the admin out and holds them to a temporary password', async () => {
	const HELPER = 'helper@example.com';
	const [helper] = await db.select().from(user).where(eq(user.email, HELPER));
	const sessions = () => db.$count(session, eq(session.userId, helper.id));
	const signIn = (password: string) =>
		auth.api.signInEmail({ body: { email: HELPER, password } }).catch(() => {});
	expect(await sessions()).toBeGreaterThan(0);

	// Only plain admins: not guests, not the superadmin, not addresses nobody has.
	expect(await resetAdminPassword(GUEST, 'temporary-pass')).toBe('not-admin');
	expect(await resetAdminPassword('super@example.com', 'temporary-pass')).toBe('not-admin');
	expect(await resetAdminPassword('nobody@example.com', 'temporary-pass')).toBe('not-admin');

	expect(await resetAdminPassword(HELPER, 'temporary-pass')).toBe('reset');
	expect(await sessions()).toBe(0);
	const [after] = await db.select().from(user).where(eq(user.id, helper.id));
	expect(after.mustChangePassword).toBe(true);

	await signIn('my-own-pass');
	expect(await sessions()).toBe(0);
	await signIn('temporary-pass');
	expect(await sessions()).toBe(1);
});
