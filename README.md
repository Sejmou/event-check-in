# event-checkin

SvelteKit + Drizzle (SQLite) + better-auth.

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — SQLite file path, e.g. `local.db`
- `ORIGIN` — public origin, e.g. `http://localhost:5173` — no path, even under a sub-path (see [Serving under a sub-path](#serving-under-a-sub-path))
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`

Create the tables, then seed an admin and the guest list:

```sh
pnpm db:push
pnpm db:seed --admin ops@example.com data/attendees.json
pnpm dev            # or: pnpm dev:tailscale  (needs the tailscale CLI)
```

Guests set up their phones from Moodle, which needs the tool registered on both sides —
see [Moodle](#moodle).

## Docker

```sh
cp .env.example .env      # fill it in, as above
docker compose build
docker compose run --rm tools pnpm db:push
docker compose run --rm tools pnpm db:seed --admin ops@example.com data/attendees.json
docker compose run --rm tools pnpm lti:register-platform --url https://moodle.example.com --client-id <id>
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

Read from `.env` via `env_file`, and by `pnpm dev` outside Docker.

Most are read when the server **starts**: change them and restart, no rebuild. With
Docker that means `docker compose up -d`, which recreates the container with the new
`.env` (a plain `restart` keeps the old values). `BASE_PATH` is the exception: it is
compiled into the **build**, so changing it means `pnpm build` or
`docker compose build` first. `HOST_PORT` is compose's own and never reaches the app.

| Variable             | Required | Read at      | Notes                                                                                                                                                                                                                                                                                        |
| -------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | start        | SQLite file path. Compose overrides it to `/data/app.db`                                                                                                                                                                                                                                     |
| `ORIGIN`             | yes      | start        | Public origin: scheme, host, port — **never a path**, see [below](#serving-under-a-sub-path). adapter-node rejects cross-origin form posts without it, the check-in QR code points at it, organizer passkeys need HTTPS, and its hostname is their relying party (see [Passkeys](#passkeys)) |
| `BETTER_AUTH_SECRET` | yes      | start        | Also signs the QR, presence and enrollment tokens. Changing it invalidates outstanding QR codes and setup links, not set-up phones                                                                                                                                                           |
| `BASE_PATH`          | no       | **build**    | Sub-path the app is served under, e.g. `/check-in`. See [below](#serving-under-a-sub-path)                                                                                                                                                                                                   |
| `ADDRESS_HEADER`     | no       | start        | Set to `x-forwarded-for` behind a reverse proxy, or `check_in.ip_address` records the proxy for everyone                                                                                                                                                                                     |
| `PORT`               | no       | start        | Defaults to 3000. Set in the image, not in `.env`                                                                                                                                                                                                                                            |
| `HOST_PORT`          | no       | compose `up` | Host port compose publishes the app on. Defaults to 3000                                                                                                                                                                                                                                     |

Behind a reverse proxy, `ORIGIN` is the public HTTPS URL — not the container's.

### Serving under a sub-path

To serve the app at `https://example.com/check-in` while `/` is something else:

```sh
ORIGIN=https://example.com   # not https://example.com/check-in
BASE_PATH=/check-in
```

It's tempting to put the whole URL in `ORIGIN`. Don't: it is an _origin_, and the
path would be lost or break things, depending on who reads it. adapter-node quietly
drops it, so pages would still load and hide the mistake. WebAuthn compares it
against the browser's origin, which never has a path, so every passkey sign-in and
registration would fail. better-auth, handed a URL with a path, takes that path as
its entire endpoint and ignores `basePath`. The app builds full URLs (the check-in
QR code) from `ORIGIN` plus `BASE_PATH`.

`BASE_PATH` becomes SvelteKit's `paths.base`, which is compiled into the build: it
is read from the environment (or `.env`) when `pnpm build` runs, not when the server
starts. With Docker, compose passes it as a build arg, so change it and
`docker compose build` again. `pnpm dev` picks it up too, which is the quickest way
to try a sub-path locally.

The reverse proxy has to forward requests **with the prefix intact** —
`/check-in/admin` reaches the app as `/check-in/admin`, not `/admin`. Links, redirects,
cookie paths, the auth endpoints (`/check-in/api/auth`) and the QR code all include it.
The Moodle tool URLs become `https://example.com/check-in/lti-link/…`.

## How guests get in

Guests have no password and never sign in. Accounts are seeded ahead of time, and each
guest proves who they are **once**, through Moodle: the course has a check-in activity
(an LTI 1.3 "external tool"), and opening it on their phone sets that phone up. From then
on, scanning the code at the door is all it takes, for as long as the browser keeps what
the setup stored.

1. `pnpm db:seed --admin <email> attendees.json` seeds the guest list and creates the
   initial admin from it — it prompts for their password. Both arguments are required,
   and `<email>` must appear in the guest list, which is where the admin's name comes
   from. Re-running is safe: existing emails are left alone.
2. The tool is added to the Moodle course and registered here — see [Moodle](#moodle).
3. The admin signs in at `/login` with that password, and is prompted to add a passkey
   (skippable; it asks again next sign-in until they do).
4. The admin opens `/admin/generate-checkin-qr` and leaves it on a screen at the door.
   The QR code **rotates every 30 seconds** and stays up indefinitely.

`data/attendees.json` (the `/data` dir is gitignored):

```json
[{ "email": "alice@corp.com", "firstName": "Alice", "lastName": "Ng" }]
```

Guests are matched by the email address Moodle reports for them, so the list has to use
the addresses their Moodle profiles have.

## Setting up a phone

The guest opens the check-in activity in Moodle **on the phone they'll bring**. Moodle
launches the tool, vouching for who they are, and the tool looks their email up in the
guest list and sends them to `/lti-link/enroll`. There they tap **Set up this phone**:

1. The browser makes an ECDSA P-256 key pair with WebCrypto, the private half
   **non-extractable** — scripts on the page can sign with it, but nothing can read it
   out, not even this app. It is kept in IndexedDB.
2. It sends the public half, signed with the private half, and the proof of the launch.
3. The server stores the public key against the guest (`device_key`), replacing any
   earlier one.

The proof of the launch is an enrollment token: HMAC-signed, naming the guest and the
Moodle account, and good for 15 minutes. It travels in the URL **fragment**, which
browsers never send to a server, so it can't end up in a log or a `Referer`, and the page
takes it out of the address bar as soon as it loads. Setting up a key spends it: a token
issued before the guest's current key was set up is turned down.

### Things that undo it

The key lives in one browser on one phone. The guest has to open Moodle again if:

- they clear that browser's website data, or used a private window
- they set up another phone or browser — there is one key per guest, and the old one stops
  working
- **Safari deletes it.** WebKit clears script-writable storage, IndexedDB included, for a
  site the user hasn't visited in seven days. Setting up more than a week before the event
  may not survive on an iPhone. The setup page asks for persistent storage, but that does
  not switch this rule off. Ask guests to set up in the last few days, or plan for them
  redoing it.

The check-in page says so when it finds no key, and redoing it takes a minute.

### Which browser

The key has to be in the browser that opens when the phone's camera reads a QR code —
usually Safari on an iPhone and Chrome on Android. Two things get in the way:

- **Moodle embedding the tool.** Opened in a frame on Moodle's page, the tool's storage is
  partitioned under Moodle's site (all current browsers do this for third-party frames),
  so a key saved there is invisible to the tab a scan opens. The setup page detects the
  frame and offers a **Continue in a new tab** button, but set the activity to open in a
  new window (see [Moodle](#moodle)) to avoid the detour.
- **The Moodle app.** It opens external tools in its own browser view, whose storage
  isn't the phone's browser's. Guests should use Moodle in the phone's browser for this.

A laptop set up this way works, but nobody scans a QR code with one.

## Checking in

The guest scans the code at the door. `/checkin` records that they saw a live code (the
presence cookie), then the page signs that scan with the device key and posts it straight
back — no tapping. The server checks the signature against the stored public key and
writes the check-in with `method = 'device'`.

What gets signed is `checkin:<scan id>`, the scan's own handle, so a signature is only good
for the scan it was made for, and the unique index collapses any replay of it. The
enrollment signs `enroll:<token>` — the prefixes keep a signature made for one from
passing for the other.

The admin can check in with their passkey through "Organizer? Check in with your
passkey" on `/checkin`, or set up a device key through Moodle like everyone else.

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
scanned". It is weaker than `device` or `passkey`: nobody confirmed who was standing at
that screen, only that one signed in as the admin was showing the code at the door. A
screen left running, or signed in on someone else's laptop, checks the admin in all
the same.

### What stops abuse

Checking a guest in takes their phone — or rather, the key its browser made — plus a code
seen at the door in the last half-minute. Setting that key up takes their Moodle login.
Nobody can check a guest in from their email address alone any more.

What it does **not** stop:

- **A guest handing over their own check-in.** The server can't tell that a key was made
  non-extractable: WebCrypto has no attestation, so a guest who calls the enrollment
  endpoint by hand can register a key they generated themselves and pass it on. It takes
  deliberate effort, and there is still one key per guest, but it can't be prevented —
  the same is true of lending someone the phone.
- **Checking in from elsewhere.** A photo of the code, sent to an absent guest within its
  30 seconds, checks them in from wherever they are. The address and user agent columns
  and the door screen are what catch this.
- **A Moodle account with someone else's email.** Guests are found by the email Moodle
  reports. Moodle normally makes users confirm a new address by mail, but a site can turn
  that off, or let users edit their email freely. The first Moodle account to set up a
  guest is pinned (`device_key.lti_subject`), so an impostor can't take over a guest who
  already set up — but one who gets there first can. If the Moodle site lets users edit
  their email, check the log.

What catches the rest is the screen at the door. Every check-in shows up there as it
happens, as a toast with the guest's name, and the last five stay listed under the code.
A name appearing that doesn't belong to the person standing in front of the screen is
visible to everyone in the queue. The toasts come over server-sent events from
`/admin/checkins/stream`, fanned out in-process, so they reach screens on the same
server only.

`/admin/checkins` is the full log afterwards, newest first, with the two things worth
seeing at a glance flagged. `again` is a guest who had already checked in earlier;
`shared` is an address more than one guest checked in from. Neither is wrong on its own
— people step out for air, and a whole table shares one hotspot — but a code that leaked
looks like several guests on one address who never passed the door.

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

The enrollment token from a Moodle launch is signed with the same secret but has a
prefix of its own, so neither token passes for the other —
`src/lib/server/scan-token.spec.ts` pins that down.

## Moodle

The check-in activity is an LTI 1.3 tool, run inside the app by
[ltijs](https://www.npmjs.com/package/ltijs) rather than as a server of its own. Its
routes live under `/lti-link`:

| URL                        | What Moodle calls it                            |
| -------------------------- | ----------------------------------------------- |
| `<ORIGIN>/lti-link/launch` | Tool URL, and Redirection URI(s)                |
| `<ORIGIN>/lti-link/login`  | Initiate login URL                              |
| `<ORIGIN>/lti-link/keys`   | Public keyset URL (Public key type: Keyset URL) |

With a `BASE_PATH`, it goes between `ORIGIN` and `/lti-link`.

1. In the course, go to **More → LTI External tools → Add tool**
   (`/mod/lti/coursetools.php?id=<course id>`). If there's no button, the Moodle site's
   admins have to allow course-level tools or add it for you.
2. Fill in the URLs above, LTI version **LTI 1.3**, and under **Privacy** set
   **Share launcher's email with tool** to **Always** — without the email, nobody can be
   matched to the guest list, and the setup page says so. Name is optional, the ID is
   all ltijs keeps.
3. Set **Default launch container** to **New window**. Embedded in Moodle's page, the key
   would land in storage the scanning tab can't see (see [Which browser](#which-browser)).
4. Save. Moodle then shows a **Client ID**. Register it here:

   ```sh
   pnpm lti:register-platform --url https://moodle.example.com --client-id <client id>
   ```

5. Add the tool to the course as an activity. Something like **"Event check-in: set up
   your phone"** tells guests what it's for — to them it is just a link that opens a page
   with one button.

`--url` is the Moodle site's base URL exactly as Moodle sends it as the issuer, with no
trailing slash. The script derives Moodle's auth, token and keyset endpoints from it, and
re-running it for a registered URL and client ID does nothing.

### How it fits into SvelteKit

ltijs normally starts its own Express server. Here it gets an `HttpHandler` of ours
(`src/lib/server/lti/http-handler.ts`) that collects its routes, and
`src/routes/lti-link/[...path]/+server.ts` hands requests to it — one process, one port,
and `provider.listen()` is never called. Its storage is `DrizzleDatabaseManager`, on the
app's own better-sqlite3 connection and in the same database file: better-sqlite3 is
synchronous, so no two writes in the process can interleave, and other processes (the
seed and register scripts) wait on SQLite's lock as they already did. It shares the
backups and `db:push`. Its tables are the four `lti_*` ones; `lti_platform` holds the
tool's private RSA key for each platform, so treat backups accordingly.

Moodle posts the launch from its own origin, which SvelteKit's CSRF check turns away —
in production only, as `vite dev` skips the check, so it works locally and fails
deployed. SvelteKit can't exempt a single route, so the check is off in `vite.config.ts`
and done again in `src/hooks.server.ts`, identically, except for `/lti-link/login` and
`/lti-link/launch`. Those two are protected by ltijs itself: signed state, a single-use
nonce, and an id_token signed by Moodle.

`ltijs` is in `dependencies`, not `devDependencies` like everything else: Vite bundles
dev dependencies into the build, and ltijs finds its HTML templates relative to its own
files.

`src/lib/server/lti/launch.spec.ts` runs a whole launch against a fake Moodle.

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
The same goes for guests' device keys: `crypto.subtle` doesn't exist outside a secure
context, so phones need `ORIGIN` on HTTPS.

### Why guests have no passkeys

Guests could set up a passkey at one point. That was removed:

- **Phone passkeys are synced.** A passkey made on an iPhone goes into iCloud Keychain,
  and on Android into Google Password Manager. Both always sync, and so do third-party
  managers like 1Password. There is no setting to keep one on the device only.
- **The site can't ask for a device-bound passkey.** WebAuthn has no option to require
  a passkey that isn't synced. The server only learns whether it is synced (the
  backup-eligible flag) after the guest has already used their face or fingerprint.
- **The flag can't be trusted anyway.** The authenticator reports it, and proving it
  would take attestation, which this app doesn't collect.

The device key does what a passkey was meant to: it stays in one browser. It is no more
provable than a passkey's flag (see [What stops abuse](#what-stops-abuse)), but it
doesn't sync, needs no biometric prompt at the door, and can't be copied off by accident.

Guest passkeys registered before the change are still in the `passkey` table. One can
still sign in, but it doesn't check anyone in, and `/` and `/checkin` end the session.
To clear them:

```sql
delete from passkey where user_id in (select id from user where role = 'attendee');
```

## Commands

| Command                                          | What it does                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm dev`                                       | Dev server                                                                   |
| `pnpm build` / `pnpm preview`                    | Production build (adapter-node) / preview it                                 |
| `pnpm check`                                     | `svelte-check`                                                               |
| `pnpm lint` / `pnpm format`                      | Prettier + ESLint                                                            |
| `pnpm test:unit` / `pnpm test:e2e` / `pnpm test` | Vitest / Playwright / both                                                   |
| `pnpm auth:schema`                               | Regenerate `src/lib/server/db/auth.schema.ts` from the better-auth config    |
| `pnpm db:push`                                   | Apply the schema straight to the DB (no migration files)                     |
| `pnpm db:backup` / `pnpm db:restore`             | Snapshot the DB, and put a snapshot back (see [Backups](#backups))           |
| `pnpm db:seed`                                   | Seed the initial admin and the guest list                                    |
| `pnpm lti:register-platform`                     | Register a Moodle site's client ID with the LTI tool (see [Moodle](#moodle)) |
| `pnpm db:generate` / `pnpm db:migrate`           | Generate / apply migration files                                             |
| `pnpm db:studio`                                 | Drizzle Studio                                                               |

`pnpm auth:schema` needs `DATABASE_URL` set, because it loads `src/lib/server/auth.ts`,
which imports the db client. After changing the better-auth config, run `auth:schema`
then `db:push`.

`pnpm db:seed` and `pnpm lti:register-platform` run through `scripts/run.js`, a five-line Vite SSR loader. Node can't
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

Besides the log, `device_key` (see [Setting up a phone](#setting-up-a-phone)) and ltijs's
`lti_*` tables (see [Moodle](#moodle)), everything lives on better-auth's own tables. The
only addition there is one column on `user`, declared in `src/lib/server/auth.ts` as an `additionalField` with
`input: false` so nobody can set it on themselves:

- `role` — `attendee` or `admin`. Named `role` rather than `is_admin` so adopting
  better-auth's `admin` plugin later is a no-op instead of a migration.

Deliberately absent:

- No summary or attendance table — the log page derives its counts from `check_in` on
  each load, and a stored total can only drift from the rows it claims to count.
- No invite table — a seeded row goes straight into `user`, and the `UNIQUE` constraint
  on email is the dedupe.
- No QR or enrollment-token table — both are signed and carry their own expiry (see
  above). An enrollment is spent by the key it sets up, through `device_key.created_at`.
- No `auth_method` column on `user` — a guest's `device_key` row, and an admin's
  `passkey` row, already say what they have.
  `check_in.method` is a different thing: what was used at one moment, which is history
  and cannot drift.
- No "has the admin added a passkey" column — that is the `passkey` table.

### `check_in`

The one table that is ours. One row per check-in:

| Column                     | Why it's there                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_id`, `checked_in_at` | who and when                                                                                                                                                 |
| `method`                   | `device` (the phone's key), `passkey` (admins only), or `host` (see below), as verified server-side at that moment. `link` is from the removed `/setup` link |
| `ip_address`, `user_agent` | a code photographed and passed around shows up as check-ins from addresses that aren't the venue's                                                           |
| `scan_id`                  | a non-secret handle for one scan; one device working through borrowed accounts shows up as one `scan_id` across many users                                   |

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
