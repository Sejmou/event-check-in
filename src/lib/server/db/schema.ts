import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

export * from './auth.schema';

/**
 * One row per check-in. Re-entry is normal at an event, so a guest may have
 * several — the unique index only collapses a double submit riding the same
 * scan.
 *
 * The trailing columns exist to make abuse visible after the fact: a code
 * photographed and passed around shows up as check-ins from addresses that
 * aren't the venue's, and one device working through borrowed accounts shows up
 * as one userAgent and one scanId across many users.
 */
export const checkIn = sqliteTable(
	'check_in',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		checkedInAt: integer('checked_in_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		// How they proved it was them, not how they signed in earlier.
		method: text('method', { enum: ['passkey', 'password'] }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		// Which scan of which displayed code this rode in on.
		scanId: text('scan_id').notNull()
	},
	(table) => [
		index('check_in_userId_idx').on(table.userId),
		index('check_in_checkedInAt_idx').on(table.checkedInAt),
		unique('check_in_user_scan_unq').on(table.userId, table.scanId)
	]
);
