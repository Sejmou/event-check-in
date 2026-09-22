import { and, asc, eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { hasAdminRole, isAdmin } from '$lib/server/roles';

/** better-auth's own default, and what the seed script asks for. */
export const MIN_PASSWORD_LENGTH = 8;

export function listAdmins() {
	return db
		.select({
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			role: user.role,
			mustChangePassword: user.mustChangePassword
		})
		.from(user)
		.where(hasAdminRole())
		.orderBy(asc(user.firstName), asc(user.lastName));
}

/**
 * Makes a guest an admin who signs in with `password` and has to replace it on
 * their first sign-in. Only guests: accounts still come from the guest list, and
 * this never touches an existing admin's password.
 */
export async function promoteToAdmin(email: string, password: string) {
	const [found] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.email, email.trim().toLowerCase()));
	if (!found) return 'not-found';
	if (isAdmin(found)) return 'already-admin';

	await setTemporaryPassword(found.id, password);
	await db.update(user).set({ role: 'admin' }).where(eq(user.id, found.id));
	return 'promoted';
}

/**
 * For an admin who forgot their password: `password` replaces it, and they have to
 * choose their own on their next sign-in. Signs them out everywhere, since whoever
 * holds a session may be the reason for the reset. Not for the superadmin, who
 * changes their own password and has nobody above them to reset it.
 */
export async function resetAdminPassword(email: string, password: string) {
	const [found] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.email, email.trim().toLowerCase()), eq(user.role, 'admin')));
	if (!found) return 'not-admin';

	await setTemporaryPassword(found.id, password);
	await (await auth.$context).internalAdapter.deleteUserSessions(found.id);
	return 'reset';
}

/** A password someone else chose, which the user has to replace on sign-in. */
async function setTemporaryPassword(userId: string, password: string) {
	const ctx = await auth.$context;
	const hash = await ctx.password.hash(password);
	// A guest has no credential account, but one left over from an earlier promotion
	// (demoted by hand in the database) gets its password replaced instead.
	if (await ctx.internalAdapter.findCredentialAccount(userId)) {
		await ctx.internalAdapter.updatePassword(userId, hash);
	} else {
		await ctx.internalAdapter.linkAccount({
			userId,
			accountId: userId,
			providerId: 'credential',
			password: hash
		});
	}
	await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
}

/** Replaces a temporary password the superadmin chose. Refuses to keep that same one. */
export async function replaceTemporaryPassword(userId: string, password: string) {
	const ctx = await auth.$context;
	const account = await ctx.internalAdapter.findCredentialAccount(userId);
	if (account?.password && (await ctx.password.verify({ hash: account.password, password }))) {
		return 'unchanged';
	}

	await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
	await db.update(user).set({ mustChangePassword: false }).where(eq(user.id, userId));
	return 'changed';
}
