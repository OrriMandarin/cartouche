---
name: dev-env
description: Use when you need to start, reset or inspect the local Cartouche development environment (database, API, web), seed test data, switch the web auth provider between test and Clerk, or freeze/move the API clock.
---

# Local development environment

Without a `.env` file, everything works **without Clerk**: test tokens, JWKS served by the API. The default values are in the `Makefile` (overridden by a root `.env`, see `.env.example`, without quotes).

Local machine: `export PATH="$HOME/.local/bin:$PATH"` (pnpm) and `source ~/.cargo/env` (cargo) if "command not found".

## Start (three terminals, in this order)

```bash
make setup     # once: pnpm install (frontend/), cargo fetch, sqlx-cli
make dev-db    # dev PostgreSQL, port 54320
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

`now` is required (RFC 3339 date or `null`). Tokens issued after freezing the clock are dated at that instant.

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

For OIDC: `NEXT_PUBLIC_OIDC_AUTHORITY` and `NEXT_PUBLIC_OIDC_CLIENT_ID` instead of the Clerk keys. To go back to test: remove these lines from `.env`.
A `CARTOUCHE_BUILD_PROFILE=production` build refuses the `test` adapter (ACC-008); never work around this.

## Ports

Dev: Postgres 54320, API 8080, web 3000. Test stack (`make e2e`): 15432, 18080, 13000. Both can run together.
