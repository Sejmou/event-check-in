import { and, eq, gt, inArray, lte, type SQL } from 'drizzle-orm';
import type {
	AccessTokenRecord,
	DatabaseManager,
	IdTokenClaims,
	PlatformAttributes,
	PlatformFilter,
	PlatformRecord
} from 'ltijs';
import { db } from '$lib/server/db';
import { ltiAccessToken, ltiIdToken, ltiNonce, ltiPlatform } from '$lib/server/db/schema';

/** How long a login's nonce may take to come back as a launch. */
const NONCE_TTL_MS = 10 * 60_000;
/** How long a launch can be resumed by its ltik. Matches ltijs's own ltik lifetime. */
const ID_TOKEN_TTL_MS = 24 * 60 * 60_000;

/**
 * ltijs's storage, on the app's own database connection instead of the MongoDB
 * it defaults to.
 *
 * No write here can interleave with another in this process: better-sqlite3 is
 * synchronous, so each method runs start to finish without yielding, and a
 * read-then-write (updatePlatformById) sits in a transaction for good measure.
 * Another process on the same file (`pnpm lti:register-platform`, the seed
 * script) waits on SQLite's lock like it already does.
 *
 * Mongo's TTL indexes are emulated by filtering on createdAt, and pruning
 * whenever a new row goes in.
 */
export class DrizzleDatabaseManager implements DatabaseManager {
	// The connection is the app's, opened in $lib/server/db and never closed by us.
	async listen() {}
	async close() {}

	async getPlatforms(filter: PlatformFilter = {}) {
		const where: SQL[] = [];
		if (filter.url !== undefined) where.push(eq(ltiPlatform.url, filter.url));
		if (filter.name !== undefined) where.push(eq(ltiPlatform.name, filter.name));
		if (filter.clientId !== undefined) {
			where.push(inArray(ltiPlatform.clientId, [filter.clientId].flat()));
		}
		return db
			.select()
			.from(ltiPlatform)
			.where(and(...where))
			.all()
			.map(toRecord);
	}

	async getPlatformById(id: string) {
		const row = db.select().from(ltiPlatform).where(eq(ltiPlatform.id, id)).get();
		return row && toRecord(row);
	}

	async getPlatformByUrlAndClientId(url: string, clientId: string) {
		const row = db
			.select()
			.from(ltiPlatform)
			.where(and(eq(ltiPlatform.url, url), eq(ltiPlatform.clientId, clientId)))
			.get();
		return row && toRecord(row);
	}

	async savePlatform(platform: PlatformAttributes) {
		const id = crypto.randomUUID();
		db.insert(ltiPlatform)
			.values({ ...platform, id })
			.run();
		return id;
	}

	async updatePlatformById(id: string, fields: Partial<PlatformAttributes>) {
		db.transaction((tx) => {
			const row = tx.select().from(ltiPlatform).where(eq(ltiPlatform.id, id)).get();
			if (!row) return;
			// Nested objects are replaced whole, the way ltijs's Mongo store does it.
			tx.update(ltiPlatform)
				.set({ ...row, ...fields, id })
				.where(eq(ltiPlatform.id, id))
				.run();
		});
	}

	async deletePlatformById(id: string) {
		db.delete(ltiPlatform).where(eq(ltiPlatform.id, id)).run();
	}

	// Expiry is checked by ltijs itself (createdAt + expires_in), so no TTL here.
	async getAccessToken(platformUrl: string, clientId: string, scopes: string) {
		const row = db
			.select({ token: ltiAccessToken.token })
			.from(ltiAccessToken)
			.where(
				and(
					eq(ltiAccessToken.platformUrl, platformUrl),
					eq(ltiAccessToken.clientId, clientId),
					eq(ltiAccessToken.scopes, scopes)
				)
			)
			.get();
		return row?.token;
	}

	async saveAccessToken(
		platformUrl: string,
		clientId: string,
		scopes: string,
		token: AccessTokenRecord
	) {
		db.insert(ltiAccessToken)
			.values({ platformUrl, clientId, scopes, token })
			.onConflictDoUpdate({
				target: [ltiAccessToken.platformUrl, ltiAccessToken.clientId, ltiAccessToken.scopes],
				set: { token }
			})
			.run();
		return JSON.stringify([platformUrl, clientId, scopes]);
	}

	async getIdToken(id: string) {
		const row = db
			.select({ claims: ltiIdToken.claims })
			.from(ltiIdToken)
			.where(
				and(eq(ltiIdToken.id, id), gt(ltiIdToken.createdAt, new Date(Date.now() - ID_TOKEN_TTL_MS)))
			)
			.get();
		return row && { ...row.claims, id };
	}

	async saveIdToken(claims: IdTokenClaims) {
		db.delete(ltiIdToken)
			.where(lte(ltiIdToken.createdAt, new Date(Date.now() - ID_TOKEN_TTL_MS)))
			.run();
		const row = db.insert(ltiIdToken).values({ claims }).returning({ id: ltiIdToken.id }).get();
		return row.id;
	}

	async saveNonce(nonce: string) {
		db.delete(ltiNonce)
			.where(lte(ltiNonce.createdAt, new Date(Date.now() - NONCE_TTL_MS)))
			.run();
		db.insert(ltiNonce)
			.values({ nonce, createdAt: new Date() })
			.onConflictDoUpdate({ target: ltiNonce.nonce, set: { createdAt: new Date() } })
			.run();
		return nonce;
	}

	/** True exactly once per nonce: the delete is the check. */
	async consumeNonce(nonce: string) {
		const { changes } = db
			.delete(ltiNonce)
			.where(
				and(eq(ltiNonce.nonce, nonce), gt(ltiNonce.createdAt, new Date(Date.now() - NONCE_TTL_MS)))
			)
			.run();
		return changes > 0;
	}
}

function toRecord(row: typeof ltiPlatform.$inferSelect): PlatformRecord {
	const { authorizationServer, ...rest } = row;
	return authorizationServer === null ? rest : { ...rest, authorizationServer };
}
