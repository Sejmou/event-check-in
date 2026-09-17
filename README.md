# event-checkin

SvelteKit + Drizzle (SQLite) + better-auth.

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — SQLite file path, e.g. `local.db`
- `ORIGIN` — public base URL, e.g. `http://localhost:5173`
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`

Create the tables, then seed an admin and the guest list:

```sh
pnpm db:push
pnpm db:seed --admin ops@example.com data/attendees.json
pnpm dev            # or: pnpm dev:tailscale  (needs the tailscale CLI)
```

## Docker

```sh
cp .env.example .env      # fill it in, as above
docker compose build
docker compose run --rm tools pnpm db:push
docker compose run --rm tools pnpm db:seed --admin ops@example.com data/attendees.json
docker compose up -d
```

The app listens on port 3000 in the container, published on the host's `HOST_PORT`
(3000 unless `.env` says otherwise). The SQLite file
lives on the `db` volume, so compose overrides `DATABASE_URL` to `/data/app.db` for
both services — the value in `.env` only applies outside Docker.

### Backups

`pnpm db:backup [dest]` snapshots the database through SQLite's `VACUUM INTO`, which
is consistent while the app is writing — a plain `cp` of a live database is not. It
refuses to write over an existing file. Without `dest` it writes next to the database
(`local.db.2026-09-11.bak`), which under Docker means the volume, where
`docker compose cp` can reach it:

```sh
docker compose run --rm tools pnpm db:backup
docker compose cp app:/data/app.db.2026-09-11.bak ./
```

`pnpm db:restore <backup>` puts one back. Stop the app first — restoring under a
running process leaves it holding a file that no longer exists:

```sh
docker compose stop app
docker compose cp ./app.db.2026-09-11.bak app:/data/restore-me.bak
docker compose run --rm tools pnpm db:restore /data/restore-me.bak
docker compose start app
```

The backup is checked (`pragma integrity_check`) before anything is overwritten, so a
truncated or unreadable file fails while the database it would have replaced is still
in place. The database being replaced is moved aside as
`<db>.<timestamp>.pre-restore.bak` rather than deleted, so restoring the wrong file
costs nothing but the confusion.

`docker compose down -v` deletes the `db` volume and everything in it. Without `-v` the
volume survives, and the next `up` finds the same database.

`tools` is the same image built one stage earlier, where the dev dependencies
(drizzle-kit, the Vite loader `pnpm db:seed` runs on) still exist. It is behind a
compose profile, so `docker compose up` never starts it. `db:seed` prompts for the
admin password, which is why it is `run` and not a startup step.

It runs as `node`, the same user the app runs as. Left as root it would create an
`app.db` the app can read but not write, and the only symptom is "Something went
wrong. Try again." on sign-in. On a volume created before that was fixed, repair the
ownership once:

```sh
docker compose run --rm --user root tools chown -R node:node /data
docker compose restart app
```

### Environment

Read from `.env` via `env_file`, and by `pnpm dev` outside Docker:

| Variable             | Required | Notes                                                                                                                                                                                                                            |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | SQLite file path. Compose overrides it to `/data/app.db`                                                                                                                                                                         |
| `ORIGIN`             | yes      | Public base URL, scheme included. adapter-node rejects cross-origin form posts without it, the check-in QR code points at it, organizer passkeys need HTTPS, and its hostname is their relying party (see [Passkeys](#passkeys)) |
| `BETTER_AUTH_SECRET` | yes      | Also signs the QR, presence and ticket tokens. Changing it invalidates outstanding QR links                                                                                                                                      |
| `ADDRESS_HEADER`     | no       | Set to `x-forwarded-for` behind a reverse proxy, or `check_in.ip_address` records the proxy for everyone                                                                                                                         |
| `PORT`               | no       | Defaults to 3000. Set in the image, not in `.env`                                                                                                                                                                                |
| `HOST_PORT`          | no       | Host port compose publishes the app on. Defaults to 3000                                                                                                                                                                         |

Behind a reverse proxy, `ORIGIN` is the public HTTPS URL — not the container's.

## How guests get in

Guests have no password and never sign in. Accounts are seeded ahead of time, and each
guest gets a personal link instead: `/setup?email=<their address>`. This app doesn't
hand the links out. The external tool guests already use opens `/setup` with their
email in the query string.

1. `pnpm db:seed --admin <email> attendees.json` seeds the guest list and creates the
   initial admin from it — it prompts for their password. Both arguments are required,
   and `<email>` must appear in the guest list, which is where the admin's name comes
   from. Re-running is safe: existing emails are left alone.
2. The admin signs in at `/login` with that password, and is prompted to add a passkey
   (skippable; it asks again next sign-in until they do).
3. The admin opens `/admin/generate-checkin-qr` and leaves it on a screen at the door.
   The QR code **rotates every 30 seconds** and stays up indefinitely.

`data/attendees.json` (the `/data` dir is gitignored):

```json
[{ "email": "alice@corp.com", "firstName": "Alice", "lastName": "Ng" }]
```

## Checking in

`/setup` only opens for an email on the guest list, the admin included; anything else is a 404. There a guest taps **Check in now**: the device gets a signed ticket cookie good
for **30 seconds**. The guest scans the code at the door within that window, in the same
browser, and `/checkin` redeems the ticket without asking for anything. Once used, it is
gone. Next time they come in, they open the link again.

Guests can't set up a passkey — see [Why guests have no passkeys](#why-guests-have-no-passkeys).
The admin can, and may check in with it through "Organizer? Check in with your
passkey" on `/checkin`, or use their personal link like everyone else. `/setup` hands out a ticket and nothing
more, so an admin's address there is no more exposed than a guest's.

Every check-in puts a row in `check_in`. Re-entry is normal, so a guest may have several
rows. A double submit is not: the unique index on `(user_id, scan_id)` collapses
everything riding one scan into one row, while a later scan gets a row of its own.

The admin showing the code gets checked in too. The first time a guest checks in
through their screen, a second row goes in for the admin, with `method = 'host'` and
the guest's `scan_id`, so the log shows the two side by side. It happens only if the
admin has no check-in yet. If they checked in themselves first, or an earlier guest
already did it for them, nothing is added. `expected` on the check-in screen counts
admins, so they can't push `present` past it.

`host` means "this admin was signed in on the screen showing the code a guest just
scanned". It is weaker than `link` or `passkey`: nobody confirmed who was standing at
that screen, only that one signed in as the admin was showing the code at the door. A
screen left running, or signed in on someone else's laptop, checks the admin in all
the same.

### What stops abuse

Very little up front, on purpose. Anyone holding a guest's link can check that guest in.
The personal link is the invitation, and it
should be treated like one.

What catches it is the screen at the door. Every check-in shows up there as it happens,
as a toast with the guest's name, and the last five stay listed under the code. A name
appearing that doesn't belong to the person standing in front of the screen is visible
to everyone in the queue. The toasts come over server-sent events from
`/admin/checkins/stream`, fanned out in-process, so they reach screens on the same
server only.

`/admin/checkins` is the full log afterwards, newest first, with the two things worth
seeing at a glance flagged. `again` is a guest who had already checked in earlier;
`shared` is an address more than one guest checked in from. Neither is wrong on its own
— people step out for air, and a whole table shares one hotspot — but a code that leaked
looks like several guests on one address who never passed the door.

Also, `/setup` answers 404 for unknown addresses, so it tells anyone who tries whether an
address is on the guest list.

### What the QR code actually proves

A code is an HMAC of the current 30-second time bucket and the ID of the admin showing
it, derived from the clock rather than stored. The route recomputes it and accepts the current bucket and the previous
one, so a scan that crosses a rotation still works.

It is deliberately **multi-use**: everyone who scans during its window gets in, which is
the point of leaving it on screen. What it proves is that the scanner saw the check-in
screen within the last half-minute, nothing more. On a successful scan the guest gets a
signed presence cookie good for 10 minutes, so the code rotating while they confirm
costs them nothing. The cookie carries the admin's ID along, signed, so the check-in
knows whose screen it came through, and neither token can be moved to another admin.

The ticket from `/setup` is signed with the same secret but binds a user ID and its own
expiry, and has a prefix of its own, so neither token passes for the other —
`src/lib/server/scan-token.spec.ts` pins that down.

## Passkeys

Only the admin has one. It is offered after their first password sign-in, works on
`/login`, and checks them in at the door. The server refuses a passkey registration for
anyone who isn't an admin.

The relying party ID is `ORIGIN`'s hostname. It is not configured separately: WebAuthn
requires it to match the hostname in the browser's address bar, and the passkey plugin
already defaults it to `baseURL`'s hostname, so a second setting could only ever drift.
Changing `ORIGIN`'s hostname invalidates every passkey already registered, so settle it
before the event.

WebAuthn also needs a **secure context**: HTTPS, or `localhost` exactly. The passkey
path can't be tested off `localhost` without `tailscale serve` or a real certificate.

### Why guests have no passkeys

Guests could set up a passkey on `/setup` at one point. That was removed. The goal
was a credential that stays on the guest's phone, so a passkey couldn't be handed around
like the link. It doesn't work for guests:

- **Phone passkeys are synced.** A passkey made on an iPhone goes into iCloud Keychain,
  and on Android into Google Password Manager. Both always sync, and so do third-party
  managers like 1Password. There is no setting to keep one on the device only. A
  device-bound credential on a phone in practice means a hardware security key, which
  guests don't carry.
- **The site can't ask for a device-bound passkey.** WebAuthn has no option to require
  a passkey that isn't synced. The server only learns whether it is synced (the
  backup-eligible flag) after the guest has already used their face or fingerprint, so
  enforcing it would mean rejecting almost every guest after they had done everything
  right.
- **The flag can't be trusted anyway.** The authenticator reports it, and proving it
  would take attestation, which this app doesn't collect.
- **A synced passkey adds nothing over the link.** It can be shared with anyone on the
  same Apple or Google account, and whoever can set one up already holds the personal
  link, which checks the guest in on its own. It also needed extra code: a server-side
  magic link to give guests a session to register against, and a second check-in path.

So guests have one way in, the 30-second ticket, and abuse is caught by the door screen
([What stops abuse](#what-stops-abuse)). The admin keeps a passkey: they sign in to the
admin pages, and there a passkey replaces a password rather than a link.

Guest passkeys registered before the change are still in the `passkey` table. One can
still sign in, but it doesn't check anyone in, and `/` and `/checkin` end the session.
To clear them:

```sql
delete from passkey where user_id in (select id from user where role = 'attendee');
```

## Commands

| Command                                          | What it does                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`                                       | Dev server                                                                |
| `pnpm build` / `pnpm preview`                    | Production build (adapter-node) / preview it                              |
| `pnpm check`                                     | `svelte-check`                                                            |
| `pnpm lint` / `pnpm format`                      | Prettier + ESLint                                                         |
| `pnpm test:unit` / `pnpm test:e2e` / `pnpm test` | Vitest / Playwright / both                                                |
| `pnpm auth:schema`                               | Regenerate `src/lib/server/db/auth.schema.ts` from the better-auth config |
| `pnpm db:push`                                   | Apply the schema straight to the DB (no migration files)                  |
| `pnpm db:backup` / `pnpm db:restore`             | Snapshot the DB, and put a snapshot back (see [Backups](#backups))        |
| `pnpm db:seed`                                   | Seed the initial admin and the guest list                                 |
| `pnpm db:generate` / `pnpm db:migrate`           | Generate / apply migration files                                          |
| `pnpm db:studio`                                 | Drizzle Studio                                                            |

`pnpm auth:schema` needs `DATABASE_URL` set, because it loads `src/lib/server/auth.ts`,
which imports the db client. After changing the better-auth config, run `auth:schema`
then `db:push`.

`pnpm db:seed` runs through `scripts/run.js`, a five-line Vite SSR loader. Node can't
resolve SvelteKit's `$env/*` and `$lib/*` aliases on its own and SvelteKit ships no
script runner, so the seed script would otherwise need its own copy of the auth config.

Tests read `.env.test`, which points `DATABASE_URL` at a scratch database. Vite gives
`.env.test` precedence over `.env` in test mode, and `$env/dynamic/private` reads what
Vite loaded — so overriding `process.env` from inside a spec does **not** work.

## The `user.name` quirk

The user model has `first_name` and `last_name`. It also has a `name` column that
nothing should read. Here is why it still exists.

better-auth hardcodes `name` on its user model — it is not a default you can turn off:

- `@better-auth/core/dist/db/get-tables.mjs` builds the `user` table with `name` as a
  required field. `user.additionalFields` only adds fields, and `user.fields.name` only
  renames its column.
- `better-auth/dist/api/routes/sign-up.mjs` hardcodes `name: z.string()` in the
  `/sign-up/email` body schema, so it is required on every sign-up regardless.

So `src/lib/server/auth.ts` does the next best thing:

- `firstName` / `lastName` are required `user.additionalFields` → `first_name` /
  `last_name`, both `NOT NULL`. These are the real fields.
- `name` is overridden to `required: false, input: false`, making the column nullable
  and keeping it out of user-facing input.

Callers still have to pass `name` to `signUpEmail` because of the zod schema above, so
the sign-up action sets it to `` `${firstName} ${lastName}` ``. It is a write-only
display leftover — read `firstName` / `lastName` instead.

Two things that follow from this:

- **Nothing keeps `name` in sync on update.** A `databaseHooks.user.update.before` hook
  would, but adding `databaseHooks` to the config makes TypeScript give up on inferring
  the options generic, and `signUpEmail`'s body type and `auth.$Infer` collapse back to
  the base user type without the additional fields. Not worth it while nothing reads
  `name`.
- **`src/app.d.ts` infers `Locals` from `auth.$Infer.Session`**, not from
  `import type { User } from 'better-auth'`. The exported `User` is the base type and
  does not carry additional fields, so `locals.user.firstName` would not typecheck.

`src/lib/server/auth.spec.ts` pins all of this down.

## Schema notes

Everything outside the log lives on better-auth's own tables. The only addition is one
column on `user`, declared in `src/lib/server/auth.ts` as an `additionalField` with
`input: false` so nobody can set it on themselves:

- `role` — `attendee` or `admin`. Named `role` rather than `is_admin` so adopting
  better-auth's `admin` plugin later is a no-op instead of a migration.

Deliberately absent:

- No summary or attendance table — the log page derives its counts from `check_in` on
  each load, and a stored total can only drift from the rows it claims to count.
- No invite or setup-token table — the link is the email itself, a seeded row goes
  straight into `user`, and the `UNIQUE` constraint on email is the dedupe.
- No QR or ticket table — both are signed and carry their own expiry (see above).
- No `auth_method` column on `user` — guests all have the link, and an admin's `passkey`
  row already says what they have.
  `check_in.method` is a different thing: what was used at one moment, which is history
  and cannot drift.
- No "has the admin added a passkey" column — that is the `passkey` table.

### `check_in`

The one table that is ours. One row per check-in:

| Column                     | Why it's there                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `user_id`, `checked_in_at` | who and when                                                                                                               |
| `method`                   | `link` (a ticket from `/setup`), `passkey` (admins only), or `host` (see below), as verified server-side at that moment    |
| `ip_address`, `user_agent` | a code photographed and passed around shows up as check-ins from addresses that aren't the venue's                         |
| `scan_id`                  | a non-secret handle for one scan; one device working through borrowed accounts shows up as one `scan_id` across many users |

`method = 'host'` marks the admin who was signed in on the check-in screen, checked in
automatically when the first guest got in through their code. It has no `ip_address`
or `user_agent`, because the request that wrote it came from the guest's phone, and
it shares that guest's `scan_id`. See [Checking in](#checking-in) for what it does and
doesn't prove.

`ip_address` comes from `event.getClientAddress()`. Behind a reverse proxy that is the
proxy unless adapter-node is told otherwise — set `ADDRESS_HEADER=x-forwarded-for` (and
`XFF_DEPTH`) or the column records one address for the whole event.

The admin's password goes in better-auth's `account` table as
`provider_id = 'credential'`; guests have none. The admin's passkeys go in the `passkey` table from
`@better-auth/passkey`. Both arrive via `pnpm auth:schema`.
