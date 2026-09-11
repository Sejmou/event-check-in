/**
 * Snapshots the SQLite database with SQLite's own VACUUM INTO, which is
 * consistent even while the app is writing — a plain file copy is not.
 *
 *   pnpm db:backup [dest]
 *
 * The default destination sits next to the database, so under Docker it lands
 * on the volume, where `docker compose cp` can reach it:
 *
 *   docker compose run --rm tools pnpm db:backup
 *   docker compose cp app:/data/app.db.2026-09-11.bak ./
 */
import { DatabaseSync } from 'node:sqlite';

const source = process.env.DATABASE_URL;
if (!source) throw new Error('DATABASE_URL is not set');

const dest = process.argv[2] ?? `${source}.${new Date().toISOString().slice(0, 10)}.bak`;

// VACUUM INTO refuses to write over an existing file, so a repeat run on the
// same day is an error rather than a lost backup.
new DatabaseSync(source, { readOnly: true }).exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
console.log(`Wrote ${dest}`);
