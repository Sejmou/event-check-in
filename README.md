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

The app listens on port 3000 in the container, published on 3000. The SQLite file
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

### Environment

Read from `.env` via `env_file`, and by `pnpm dev` outside Docker:

| Variable             | Required | Notes                                                                                                                                                                                                                        |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | SQLite file path. Compose overrides it to `/data/app.db`                                                                                                                                                                     |
| `ORIGIN`             | yes      | Public base URL, scheme included. adapter-node rejects cross-origin form posts without it, the check-in QR code points at it, passkeys need HTTPS, and its hostname is the passkey relying party (see [Passkeys](#passkeys)) |
| `BETTER_AUTH_SECRET` | yes      | Also signs the QR and presence tokens. Changing it invalidates outstanding QR links                                                                                                                                          |
| `ADDRESS_HEADER`     | no       | Set to `x-forwarded-for` behind a reverse proxy, or `check_in.ip_address` records the proxy for everyone                                                                                                                     |
| `PORT`               | no       | Defaults to 3000. Set in the image, not in `.env`                                                                                                                                                                            |

Behind a reverse proxy, `ORIGIN` is the public HTTPS URL — not the container's.

## How people get accounts

There is no sign-up. Accounts are seeded ahead of time and claimed in person.

1. `pnpm db:seed --admin <email> attendees.json` seeds the guest list as **unclaimed**
   accounts and creates the initial admin from it — it prompts for their password. Both
   arguments are required, and `<email>` must appear in the guest list, which is where
   the admin's name comes from. Re-running is safe: existing emails are left alone.
2. The admin signs in at `/login` with that password, and is prompted to add a passkey
   (skippable; it asks again next sign-in until they do).
3. At `/admin` a QR code is displayed. It **rotates every 30 seconds** — leave the page
   open on the check-in screen.
4. A guest scans it with their own phone, enters the email they were invited with, and
   is prompted to create a passkey. Only if their device can't do passkeys are they
   asked to set a password instead.
5. That's the account claimed. The guest signs in at `/login` from then on.

Claiming an account is not checking in — see [Checking in](#checking-in).

`data/attendees.json` (the `/data` dir is gitignored):

```json
[{ "email": "alice@corp.com", "firstName": "Alice", "lastName": "Ng" }]
```

### What the QR codes actually prove

A code is an HMAC of its purpose and the current 30-second time bucket — derived from
the clock, not stored anywhere. The route recomputes it and accepts the current bucket
and the previous one, so a scan that crosses a rotation still works.

It is deliberately **multi-use**: everyone who scans the code during its window can
claim, which is the point of leaving it on screen. What it proves is that the scanner
was looking at the check-in screen within the last half-minute — nothing more. On a
successful scan the guest gets a signed, short-lived presence cookie, so the code
rotating while they type their email costs them nothing.

Two things follow from this, both deliberate:

- **Closing the kiosk tab does not stop claiming.** Nobody can claim without having
  seen a code, but there is no off switch. The smallest fix, if it's ever wanted, is a
  `claim_open_until` timestamp the kiosk refreshes on each rotation.
- **Anyone who scans could try other people's addresses.** Unknown, already-claimed and
  not-on-the-list all return the same message, and the form is rate-limited per
  presence cookie, so it leaks nothing and probing is slow.

### Why the claim code and the check-in code are separate

They could be one code on one route that branches on whether the account is claimed.
They are not, because the two gate very different things:

|                  | `/claim`              | `/checkin`                                 |
| ---------------- | --------------------- | ------------------------------------------ |
| Who can use it   | anyone holding a scan | only someone with the account's credential |
| What it grants   | the account itself    | a row in `check_in`                        |
| Where it belongs | the staffed desk      | any door, all evening                      |

Merging them would attach the account-claiming surface to every screen showing the
check-in code — and the check-in screen is exactly the one you want unattended at a
second entrance, up for hours, in the background of people's photos. Keeping them apart
also means a leaked code rotates one capability rather than both.

The separation is in the HMAC itself (`claim:<bucket>` vs `checkin:<bucket>`), not in a
check somewhere, so a code shown at the door is simply not a valid claim code —
`src/lib/server/scan-token.spec.ts` pins that down. The cost is one `purpose` argument.

## Checking in

1. The admin opens `/admin/generate-checkin-qr` and leaves it on a screen at the door.
   Like the claim code it rotates every 30 seconds and stays up indefinitely.
2. A guest scans it and lands on `/checkin`, which gets the same signed presence cookie
   the claim flow uses.
3. They confirm it is them — a passkey if they have one, otherwise email and password.
   A session alone is not enough: the credential is checked again on the spot, so a
   borrowed unlocked phone can't check somebody in.
4. A row goes into `check_in`.

Re-entry is normal, so a guest may have several rows. A double submit is not: the
unique index on `(user_id, scan_id)` collapses everything riding one scan into one row,
while a later scan gets a row of its own.

Guests who scan the check-in code before claiming are sent to `/claim` — there is no
credential for them to confirm with yet.

`/admin/checkins` is the log: every row, newest first, with the two things worth seeing
at a glance flagged. `again` is a guest who had already checked in earlier; `shared` is
an address more than one guest checked in from. Neither is wrong on its own — people
step out for air, and a whole table shares one hotspot — but a code that leaked looks
like several guests on one address who never passed the desk.

## Passkeys

The relying party ID is `ORIGIN`'s hostname. It is not configured separately: WebAuthn
requires it to match the hostname in the browser's address bar, and the passkey plugin
already defaults it to `baseURL`'s hostname, so a second setting could only ever drift.
Changing `ORIGIN`'s hostname invalidates every passkey already registered, so settle it
before the event.

WebAuthn also needs a **secure context**: HTTPS, or `localhost` exactly. Guests scan on
their own phones, so plain-HTTP LAN or Tailscale testing will always fall through to
the password branch. That is the fallback working correctly, but it means the passkey
path can't be tested off `localhost` without `tailscale serve` or a real certificate.

Device support is detected with `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`.
That check misreports on private-mode browsers and managed devices, in both directions,
so the UI always keeps a manual way over to the password form.

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

Everything the claim flow needs lives on better-auth's own tables. The only additions
are two columns on `user`, both declared in `src/lib/server/auth.ts` as
`additionalFields` with `input: false` so nobody can set them on themselves:

- `claimed_at` — `NULL` means the account is seeded but unclaimed. That single nullable
  timestamp is the whole "inactive account" concept.
- `role` — `attendee` or `admin`. Named `role` rather than `is_admin` so adopting
  better-auth's `admin` plugin later is a no-op instead of a migration.

Deliberately absent:

- No summary or attendance table — the log page derives its counts from `check_in` on
  each load, and a stored total can only drift from the rows it claims to count.
- No pending-user or invite table — a seeded row goes straight into `user`, so the
  `UNIQUE` constraint on email is the dedupe and passkeys can reference `user.id` at once.
- No claim-token table — the QR code is derived from the clock (see above).
- No `auth_method` column on `user` — a `passkey` row or a `credential` `account` row
  already says what somebody has, and a copy of that can only drift. `check_in.method`
  is a different thing: what was verified at one moment, which is history and cannot
  drift.
- No "has the admin added a passkey" column — that is the `passkey` table.

### `check_in`

The one table that is ours. One row per check-in:

| Column                     | Why it's there                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `user_id`, `checked_in_at` | who and when                                                                                                               |
| `method`                   | `passkey` or `password`, as verified server-side at that moment                                                            |
| `ip_address`, `user_agent` | a code photographed and passed around shows up as check-ins from addresses that aren't the venue's                         |
| `scan_id`                  | a non-secret handle for one scan; one device working through borrowed accounts shows up as one `scan_id` across many users |

`ip_address` comes from `event.getClientAddress()`. Behind a reverse proxy that is the
proxy unless adapter-node is told otherwise — set `ADDRESS_HEADER=x-forwarded-for` (and
`XFF_DEPTH`) or the column records one address for the whole event.

Passwords (the admin's, and the guest fallback) go in better-auth's `account` table as
`provider_id = 'credential'`. Passkeys go in the `passkey` table from
`@better-auth/passkey`. Both arrive via `pnpm auth:schema`.
