/**
 * Replaces the database with a backup taken by `pnpm db:backup`.
 *
 *   pnpm db:restore <backup>
 *
 * Stop the app first — restoring under a running process leaves it holding a
 * file that no longer exists. The database being replaced is not deleted but
 * moved aside as <db>.<timestamp>.pre-restore.bak, so a restore of the wrong
 * file is recoverable.
 */
import { DatabaseSync } from 'node:sqlite';
import { renameSync, rmSync, existsSync } from 'node:fs';

const dest = process.env.DATABASE_URL;
if (!dest) throw new Error('DATABASE_URL is not set');

const source = process.argv[2];
if (!source) throw new Error('usage: pnpm db:restore <backup>');
if (!existsSync(source)) throw new Error(`${source} does not exist`);

// Reading the backup before touching anything: an unreadable or truncated file
// fails here, while the database it would have replaced is still in place.
const check = new DatabaseSync(source, { readOnly: true });
const [{ integrity_check: result }] = check.prepare('pragma integrity_check').all();
if (result !== 'ok') throw new Error(`${source} is not a healthy SQLite database: ${result}`);
check.close();

if (existsSync(dest)) {
	const aside = `${dest}.${new Date().toISOString().replaceAll(':', '-')}.pre-restore.bak`;
	renameSync(dest, aside);
	// The rollback journal and WAL of the file just moved away describe a
	// database that is no longer there; leaving them beside the restored copy is
	// how a good backup turns into a corrupt one.
	for (const suffix of ['-journal', '-wal', '-shm']) rmSync(`${dest}${suffix}`, { force: true });
	console.log(`Moved the current database to ${aside}`);
}

new DatabaseSync(source, { readOnly: true }).exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
console.log(`Restored ${dest} from ${source}`);
