/**
 * Seeds the guest list and makes one of its entries the superadmin (interactively):
 * an admin who can also promote other guests to admin on /admin.
 *
 *   pnpm db:seed --admin ops@corp.com data/attendees.json
 *
 * The superadmin must appear in the guest list — their name comes from that entry.
 * Re-runnable: existing emails are left alone. One exception, for databases seeded
 * before superadmins existed: while there is no superadmin, an existing admin
 * given as --admin becomes it.
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { MIN_PASSWORD_LENGTH } from '../src/lib/server/admins';
import { auth } from '../src/lib/server/auth';
import { db } from '../src/lib/server/db';
import { user } from '../src/lib/server/db/schema';

type Attendee = { email: string; firstName: string; lastName: string };

function parseArgs(argv: string[]) {
	const usage = 'pnpm db:seed --admin ops@corp.com data/attendees.json';
	const flag = argv.indexOf('--admin');
	if (flag === -1 || !argv[flag + 1]) {
		throw new Error(`--admin <email> is required, e.g. ${usage}`);
	}
	const adminEmail = argv[flag + 1];
	const attendeesFile = argv.filter((_, i) => i !== flag && i !== flag + 1)[0];
	if (!attendeesFile) {
		throw new Error(`a guest list file is required, e.g. ${usage}`);
	}
	return { adminEmail, attendeesFile };
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

async function seedSuperadmin({ email, firstName, lastName }: Attendee) {
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

async function readAttendees(file: string): Promise<Attendee[]> {
	const attendees: Attendee[] = JSON.parse(await readFile(file, 'utf8'));

	return attendees.map(({ email, firstName, lastName }) => {
		if (!email || !firstName || !lastName) {
			throw new Error(
				`every attendee needs email, firstName and lastName: ${JSON.stringify({ email, firstName, lastName })}`
			);
		}
		// better-auth lower-cases the addresses it writes, and the unique index is
		// case-sensitive — an unnormalized list seeds a second row for the same person.
		return { email: email.trim().toLowerCase(), firstName, lastName };
	});
}

async function seedAttendees(attendees: Attendee[], file: string) {
	const rows = attendees.map(({ email, firstName, lastName }) => ({
		id: crypto.randomUUID(),
		email,
		name: `${firstName} ${lastName}`,
		firstName,
		lastName,
		role: 'attendee',
		emailVerified: false
	}));

	if (!rows.length) return console.log(`${file} is empty — nothing to seed.`);

	// The UNIQUE constraint on email is the dedupe; re-running is a no-op, and the
	// superadmin — already inserted above with their role — is skipped the same way.
	await db.insert(user).values(rows).onConflictDoNothing({ target: user.email });

	const seeded = await db.$count(user, eq(user.role, 'attendee'));
	console.log(`Seeded ${rows.length} attendee(s) from ${file}; ${seeded} on the guest list now.`);
}

const { adminEmail, attendeesFile } = parseArgs(process.argv.slice(2));
const attendees = await readAttendees(attendeesFile);

const superadmin = attendees.find((a) => a.email === adminEmail.trim().toLowerCase());
if (!superadmin) {
	throw new Error(
		`${adminEmail} is not in ${attendeesFile} — the superadmin must be on the guest list.`
	);
}

await seedSuperadmin(superadmin);
await seedAttendees(attendees, attendeesFile);
