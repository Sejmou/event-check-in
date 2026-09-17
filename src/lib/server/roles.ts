import { inArray } from 'drizzle-orm';
import { user } from '$lib/server/db/schema';

/**
 * `user.role` values that open the admin pages. The superadmin is an admin that
 * can also promote guests; there is only the one the seed script creates.
 */
export const ADMIN_ROLES = ['admin', 'superadmin'];

export function isAdmin(u: { role?: string | null } | null | undefined) {
	return ADMIN_ROLES.includes(u?.role ?? '');
}

/** isAdmin as a `where` condition on the user table. */
export const hasAdminRole = () => inArray(user.role, ADMIN_ROLES);
