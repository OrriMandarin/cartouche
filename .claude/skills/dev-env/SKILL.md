---
name: dev-env
description: Use when you need to start, reset or inspect the local Cartouche development environment (database, API, web), seed test data, switch the web auth provider between test and Clerk, or freeze/move the API clock.
---

# Local development environment

Without a `.env` file, everything works **without Clerk**: test tokens, JWKS served by the API. The default values are in the `Makefile` (overridden by a root `.env`, see `.env.example`, without quotes).

Two API variables concern events; without a `.env`, the defaults apply:

| Variable | Default | Effect |
|---|---|---|
| `MAX_SIMULTANEOUS_EVENTS` | `3` (integer ≥ 1) | maximum number of events in progress at the same time on one card (EVT-019); beyond it, `409 too_many_simultaneous_events` |
| `TRUSTED_PROXY_HOPS` | `1` (integer from 0 to 10) | number of trusted reverse proxies in front of the API: the per-IP limit (ABU-008) uses the n-th address of `X-Forwarded-For` from the right. `1` behind Caddy; `0` when the API is reached directly, in which case the header is ignored and the connection's address counts |

An invalid value prevents the API from starting. Add them to the `.env` (uncomment them in `.env.example`), then restart `make api`.

Local machine: `export PATH="$HOME/.local/bin:$PATH"` (pnpm) and `source ~/.cargo/env` (cargo) if "command not found".

## Start (three terminals, in this order)

```bash
make setup     # once: pnpm install (frontend/), cargo fetch, sqlx-cli
make dev-db    # dev PostgreSQL, port 54320 (or DEV_DB_PORT, one server per worktree that runs Rust tests)
make api       # API on :8080, feature test-support, migrations applied at startup
make web       # site on :3000
```

Check: `curl -s localhost:8080/api/health` must answer `{"status":"ok","db":"ok"}`.

## Media

By default (`MEDIA_STORAGE=local`), the API writes card media to `MEDIA_LOCAL_DIR` and serves it itself under `/media/*`. The `Makefile` sets `MEDIA_LOCAL_DIR` to `.data/media` at the repository root (ignored by git): delete that folder to start over without media. `make e2e` writes to `/data/media` in the API container (lost on `make e2e-down`). The `s3` mode (`MEDIA_S3_*`, `MEDIA_PUBLIC_BASE_URL`) is documented in `.env.example`.

## Data

```bash
make seed                      # "base" scenario (administrator + one user per status)
make seed SCENARIO=<name>      # another scenario (for example "cards": demo cards)
cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list    # list of scenarios
cd backend && APP_ENV=development DATABASE_URL=postgres://cartouche:cartouche@localhost:54320/cartouche \
  cargo run -p cartouche-api --features test-support --bin cartouche-seed -- reset   # empties the tables (APP_ENV and DATABASE_URL required outside `make`)
curl -s -X POST localhost:8080/api/test/reset              # same thing, through the running API (no variables to export)
```

The seed binary refuses to run if `APP_ENV` is not `development` or `test`.
Start from scratch: `docker compose -f compose.dev.yml down -v && make dev-db`.

### Events locally

The `events` scenario extends `cards`, which extends `base`: `make seed SCENARIO=events` **alone fails** (cards and users not found). Load all three in order:

```bash
make seed && make seed SCENARIO=cards && make seed SCENARIO=events
```

The scenario's dates are relative to the loading time (T0): the "Salon du Mariage", the "Portes ouvertes" and the "Démonstration en boutique" of `alice-durand` are in progress, the "Atelier découverte" ended 10 minutes ago (submissions still accepted), the "Foire de Lyon" is upcoming. Sign in as `seed-alice` to see them in the dashboard (the card's events page, the leads list).

Open a prospect form: `http://localhost:3000/c/alice-durand/e/<event ID>`, or click its button on `http://localhost:3000/c/alice-durand`. The identifiers are fixed: the "Portes ouvertes de l'Atelier" are `0198c8a2-0000-7000-8000-000000000002` and ask for the access code **Château** (case, spaces and accents do not matter). Beyond 120 submissions in 10 minutes, or 30 wrong codes, from the same address, the API answers `429` with `Retry-After`; locally the address is the connection's (`TRUSTED_PROXY_HOPS=1` without `X-Forwarded-For` falls back to it). `POST /api/test/reset` resets the counters, but also empties the database.

**Watching an event start or end**: freeze the API's clock, load the scenarios **through the API** (it then uses the frozen clock, whereas `make seed` dates at the real time), then move the clock:

```bash
api() { curl -s -X POST "localhost:8080/api/test/$1" -H 'content-type: application/json' -d "$2"; }
api reset '{}'; api clock '{"now":"2027-03-15T10:00:00Z"}'
api seed '{"scenario":"base"}'; api seed '{"scenario":"cards"}'; api seed '{"scenario":"events"}'
api clock '{"now":"2027-03-15T12:30:00Z"}'    # the "Démonstration" (ends at T0+2 h) is over, no more button on the next render
api clock '{"now":null}'                       # back to real time
```

A sign-in token signed before moving the clock may be expired for the new time: sign in again (`/login`) after each change. See "Controlling the API clock" below. For the Playwright tests, `api.seedEvents()` does all of this (see `add-seed-scenario`).

### Leads, exports, support views and account deletion locally

With the three scenarios loaded (`make seed && make seed SCENARIO=cards && make seed SCENARIO=events`), sign in as `seed-alice`:

- **Whole-card lead view**: from the card's events page (`/dashboard/cards/<card ID>/events`), the "Tous les contacts de la carte" link (`card-leads-link`) opens `/dashboard/cards/<card ID>/leads` for `alice-durand`: contacts of every event, with their event, a search box and the detail view.
- **Exports**: the export button of an event's contacts or of the whole-card view opens a dialog (format CSV, XLSX or JSON, spam included or not) and downloads the file. The browser sends its time zone as `tz` (`Europe/Paris` when missing or unknown). Without the site, by hand: `curl -s -D - -o /tmp/leads.csv "localhost:8080/api/cards/<card ID>/leads/export?format=csv&include_spam=true&tz=Europe/Paris" -H "authorization: Bearer $TOKEN"` (token as below). The contacts of the events scenario contain accents and emojis; open the XLSX in a spreadsheet to check them. The file name carries the day, read from the API's clock.
- **Support views** (read-only, audited): sign in as `seed-admin`, open `/support`, the "approved" tab, Alice's user page (`user-link-seed-alice`), then the "Événements" button of her card (`/support/cards/<card ID>/events`), then the contacts of an event or of the whole card. Each load of a contact list writes one `leads.viewed` audit row (identifiers and count only). The lead list loads once on mount; in `next dev`, React StrictMode mounts components twice, so a visit in development can write **two** rows where production writes one: that is not a bug.
- **Account deletion**: sign in as `seed-bob`, open the account page (`/dashboard/account`, `account-link` in the header) and delete the account. The site lands on `/account-deleted` (outside the account gate on purpose, so it sends no API request that would recreate an empty account). `seed-admin` cannot delete their account (`403 cannot_delete_admin`). To get Bob back, reseed: `make seed && make seed SCENARIO=cards`. **Blocked slugs survive a reseed** (`blocked_slugs` is not touched by scenarios): `bob-martin` stays unavailable to a new card, whereas `POST /api/test/reset` (or `cartouche-seed reset`) empties the table with the rest.
## Changing a seeded card's theme

To try another ready-made theme or font pair on a seeded card, save the card through the API (the body replaces the whole card; start from `GET /api/cards/<id>`): set `"theme": {"preset": "minuit"}` (ids: `craie`, `ivoire`, `terracotta`, `sauge`, `bonbon`, `lagon`, `encre`, `minuit`; see `frontend/web/src/lib/theme/themes.json` for their colours and font pairs). In Playwright use `api.updateCard("seed-alice", id, { theme: { preset: "bonbon" } })`. The server refuses an unreadable colour combination (`400 low_contrast`).

## Signing in locally (`test` adapter)

The site offers a test sign-in panel on `/login` (users `seed-admin`, `seed-alice`, …); a visitor who is already signed in and opens `/login` is redirected to `/dashboard`. For a token by hand:

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/test/token -H 'content-type: application/json' \
  -d '{"subject":"seed-alice"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s localhost:8080/api/me -H "authorization: Bearer $TOKEN"
```

The body also accepts `email`, `name`, `expires_in_secs` (max 86400).

## Controlling the API clock

```bash
curl -s -X POST localhost:8080/api/test/clock -H 'content-type: application/json' -d '{"now":"2026-03-01T10:00:00Z"}'   # freezes the clock
curl -s -X POST localhost:8080/api/test/clock -H 'content-type: application/json' -d '{"now":null}'                       # goes back to real time
```

`now` is required (RFC 3339 date or `null`). Tokens issued after freezing the clock are dated at that instant; **freeze the clock before signing a token**, otherwise it is expired (or not yet valid) for the new time. The clock also drives event periods, the 15-minute submission grace period, the per-IP limit and the validity of signed media URLs.

## Switching from the `test` adapter to Clerk (or OIDC)

Put these variables in the root `.env` (the `Makefile` exports them), then restart `make api` and `make web`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_AUTH_PROVIDER` | `clerk` (or `oidc`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | keys of the development Clerk instance |
| `AUTH_ISSUER` | issuer (`iss`) of the Clerk tokens, e.g. `https://<instance>.clerk.accounts.dev` |
| `AUTH_JWKS_URL` | `<AUTH_ISSUER>/.well-known/jwks.json` |
| `AUTH_AUDIENCE` | optional |
| `ADMIN_USER_IDS` | Clerk `sub` of the administrators (comma-separated) |

For OIDC: `NEXT_PUBLIC_OIDC_AUTHORITY` and `NEXT_PUBLIC_OIDC_CLIENT_ID` instead of the Clerk keys. The OIDC client must also allow, as post-logout redirect URIs, the site's origin and `<site origin>/account-deleted`: after deleting an account the site signs out with `signOut({ redirectTo: "/account-deleted" })` (the auth module's `signOut(opts?: { redirectTo?: string })`; the test adapter ignores it), and the identity provider refuses a redirect it does not know (documented in `.env.example`). To go back to test: remove these lines from `.env`.
A `CARTOUCHE_BUILD_PROFILE=production` build refuses the `test` adapter (ACC-008); never work around this.

## Ports

The web contact points (`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL`) default to placeholders; set them in `.env` to see real ones.

Dev: Postgres 54320 (`DEV_DB_PORT`), API 8080, web 3000. Test stack (`make e2e`): 15432, 18080, 13000. Both can run together.

**The test stack is shared by every worktree of the machine**: `compose.test.yml` is the docker compose project `cartouche-test` with fixed ports, so two worktrees running `make e2e` at the same time tear down each other's containers (and database). Run `make e2e` from one worktree at a time.
