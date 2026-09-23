/**
 * Creates the superadmin (interactively): an admin who can also promote guests to
 * admin on /admin. Guests aren't seeded — they are created on their first Moodle
 * launch.
 *
 *   pnpm db:seed --admin ops@corp.com --first-name Ada --last-name Lovelace
 *
 * Re-runnable: an existing email is left alone. One exception, for databases
 * seeded before superadmins existed: while there is no superadmin, an existing
 * admin given as --admin becomes it.
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { MIN_PASSWORD_LENGTH } from '../src/lib/server/admins';
import { auth } from '../src/lib/server/auth';
import { db } from '../src/lib/server/db';
import { user } from '../src/lib/server/db/schema';

type Superadmin = { email: string; firstName: string; lastName: string };

const USAGE = 'pnpm db:seed --admin ops@corp.com --first-name Ada --last-name Lovelace';

function readArgs(): Superadmin {
	const { values } = parseArgs({
		options: {
			admin: { type: 'string' },
			'first-name': { type: 'string' },
			'last-name': { type: 'string' }
		}
	});
	const email = values.admin?.trim().toLowerCase();
	const firstName = values['first-name']?.trim();
	const lastName = values['last-name']?.trim();
	if (!email || !firstName || !lastName) {
		throw new Error(`--admin, --first-name and --last-name are required, e.g. ${USAGE}`);
	}
	// better-auth lower-cases the addresses it writes, and the unique index is
	// case-sensitive — hence the lower-casing above.
	return { email, firstName, lastName };
}

/**
 * Asks for the password twice with the echo muted, so it never lands in
 * scrollback. One readline interface serves both prompts — closing and
 * reopening would end stdin when it is a pipe rather than a terminal.
 */
async function readAdminPassword() {
	let muted = false;
	const output = new Writable({
		write(chunk, _encoding, callback) {
			if (!muted) process.stdout.write(chunk);
			callback();
		}
	});
	const rl = createInterface({
		input: process.stdin,
		output,
		terminal: Boolean(process.stdin.isTTY)
	});

	// Reading through the line iterator rather than rl.question(): with piped
	// stdin the stream ends before a second question registers its listener, and
	// that await never settles.
	const lines = rl[Symbol.asyncIterator]();
	const ask = async (question: string) => {
		process.stdout.write(question);
		muted = true;
		try {
			const { value } = await lines.next();
			return (value ?? '').trim();
		} finally {
			muted = false;
			process.stdout.write('\n');
		}
	};

	try {
		for (;;) {
			const password = await ask('Superadmin password: ');
			if (password.length < MIN_PASSWORD_LENGTH) {
				console.error(`  Too short — at least ${MIN_PASSWORD_LENGTH} characters.`);
				continue;
			}
			if (password !== (await ask('Confirm password: '))) {
				console.error('  Passwords did not match.');
				continue;
			}
			return password;
		}
	} finally {
		rl.close();
	}
}

async function seedSuperadmin({ email, firstName, lastName }: Superadmin) {
	const ctx = await auth.$context;

	const [existing] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.email, email));
	if (existing) {
		const noSuperadmin = (await db.$count(user, eq(user.role, 'superadmin'))) === 0;
		if (existing.role === 'admin' && noSuperadmin) {
			await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, existing.id));
			console.log(`Admin ${email} already exists — made them superadmin.`);
		} else {
			console.log(`${email} already exists — leaving it alone.`);
		}
		return;
	}

	const password = await readAdminPassword();

	const created = await ctx.internalAdapter.createUser(
		{
			email,
			name: `${firstName} ${lastName}`,
			firstName,
			lastName,
			role: 'superadmin',
			// Verified out of band by whoever is running this.
			emailVerified: true
		},
		{ method: 'admin' }
	);

	await ctx.internalAdapter.linkAccount({
		userId: created.id,
		accountId: created.id,
		providerId: 'credential',
		password: await ctx.password.hash(password)
	});

	console.log(`Created superadmin ${email}.`);
}

await seedSuperadmin(readArgs());
