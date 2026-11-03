# Cartouche — instructions for agents

Cartouche is an open-source digital business card application (Rust backend, Next.js frontend). Every agent reads this file first: it describes the repository, the commands, the workflow and the quality rules. **Languages**: this file, the agent and skill bodies, `spec/`, the docs, the code, the comments, the identifiers and the commit messages are in **English**. Only the **user interface texts** (`frontend/web/messages/fr.json`) are in French, with accents. The historical design and plans in `docs/superpowers/` stay in French and are not translated.

## Repository map

| Path | Contents |
|---|---|
| `spec/` | **Product reference**: numbered rules (`XXX-NNN`), one file per topic. See `spec/README.md`. |
| `docs/superpowers/` | Initial design (frozen) and implementation plans, in French. |
| `backend/` | **All the Rust code**: Cargo workspace, `rust-toolchain.toml`, `Dockerfile`, SQLx cache `.sqlx/`. `domain/` (crate `cartouche-domain`): pure business logic. `server/` (crate `cartouche-api`): Axum, `config`, `auth/`, `db/` (SQLx queries), `routes/`, `test_support/` (feature `test-support`), `migrations/`, `tests/` (integration). |
| `frontend/` | **All the TypeScript code**: pnpm workspace (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`). Run pnpm commands from this folder or with `pnpm -C frontend …`. |
| `frontend/web/` | Next.js: `src/app/` (pages, including the public page `/c/<slug>` and the prospect form `/c/<slug>/e/<id>`), `src/components/` (including `events/`: dashboard for events and leads, and `event-form/`: prospect form shared by all templates), `src/lib/` (logic: auth, `api.ts`, build profile, `events/`: draft model, times, leads; `event-form/`: device, answers, local draft, submission outcomes), `src/templates/` (card templates: contract, registry, settings schema, one folder per template), `messages/fr.json` (interface texts). |
| `frontend/api-client/` | TypeScript client **generated** from the OpenAPI document (`openapi.json`, `schema.d.ts` committed; never edit by hand). |
| `frontend/e2e/` | Playwright end-to-end tests, on the full stack (`fixtures.ts` with the `api.setClock` and `api.seedEvents()` helpers, `env.ts`, `tests/*.spec.ts`). |
| `scripts/` | `spec-lint.mjs` (spec linter), `check-prod-guard.sh`. |
| `.claude/agents/` | Project agents. `.claude/skills/`: project skills. |
| `compose.dev.yml`, `compose.test.yml` | Development database; full stack (db, api, web) for the e2e tests. |
| `.data/media/` | Local card media (`MEDIA_STORAGE=local`, `MEDIA_LOCAL_DIR`), ignored by git; in production, S3-compatible storage. |

## Commands (`make`)

| Command | Effect |
|---|---|
| `make setup` | Installs the dependencies (pnpm, `cargo fetch`, `sqlx-cli`). |
| `make dev-db` | Starts the development PostgreSQL (port 54320). |
| `make api` / `make web` | Runs the API (8080, with `test-support`) / the site (3000). |
| `make seed [SCENARIO=base]` | Fills the database with a data scenario. `cards` extends `base` and `events` extends `cards`: load `base`, then `cards`, then `events` (see the `dev-env` skill). |
| `make test` | `test-api` + `sqlx-check` + `test-web` + `spec-lint-test` (linter tests) + `spec-lint`. |
| `make sqlx-prepare` | After any query or migration addition or change: regenerates the `backend/.sqlx/` cache (to be committed). `make sqlx-check` checks that it is up to date (also in CI). |
| `make lint` | `cargo fmt --check`, `clippy -D warnings`, pnpm lint and typecheck. |
| `make openapi` | Regenerates `openapi.json` (tests run with `--all-features`), then the TypeScript client. |
| `make spec-lint [ARGS=--coverage]` | `node scripts/spec-lint.mjs`; `ARGS=--coverage` lists the rules without a test. |
| `make e2e [ARGS="-g ACC-004"]` | Starts the test stack and runs Playwright. `make e2e-down` stops it. |

Without a `.env` file, everything works locally **without Clerk** (test authentication provider, JWKS served by the API). See `.env.example`, which also documents `MAX_SIMULTANEOUS_EVENTS` (concurrent events per card, 3 by default) and `TRUSTED_PROXY_HOPS` (trusted reverse proxies for the per-IP limit, 1 by default).

Note for the local development machine: `pnpm` is in `~/.local/bin` (Node 25 has no Corepack) and `cargo` is available after `source ~/.cargo/env`. On "command not found", export `PATH="$HOME/.local/bin:$PATH"` and source `~/.cargo/env` before running `make`.

## Mandatory workflow

1. **Spec first.** `planner` updates `spec/` (new rule, changed rule) and checks that no existing rule is contradicted. Any contradiction or behavior change is flagged to the project maintainer **before coding**.
2. **Task plan**: small tasks, each with its tests and the IDs of the rules involved.
3. **`builder` implements in TDD**: a failing test, the minimal code, the passing test, one commit per task.
4. **`task-reviewer`** reviews each finished task. Nothing moves on until the verdict is `APPROVED`.
5. **`make test`**, then **`make e2e`**, must pass **locally before every push**. CI only runs the e2e tests on `main`: on a branch, this local run is what guarantees them.
6. **`feature-reviewer`** reviews the complete feature at the end.
7. **A bug always starts from a test that reproduces it.** `debugger` first; if two attempts fail, `debugger-deep`. If the bug reveals a missing or wrong rule, fix the spec first (step 1).

## Quality rules

- **No business logic in handlers or components**: it goes in `cartouche-domain` (Rust) or in `frontend/web/src/lib` (TypeScript). A handler reads the request, calls the domain and `db/`, and formats the response.
- **Every external dependency sits behind a trait or an interface** (clock, token verification, storage, email, Clerk…), so that tests can replace it.
- **Every user query is filtered by owner in `db/`**: no function reads or writes user data without the owner's ID. The exceptions (reads and writes of the public page and the prospect form, support) are listed at the top of the `db/` file concerned; see the `change-api` skill.
- **Tests cite their rules**: `// spec: ACC-004` before a Rust test; `ACC-004` in the name of a TypeScript test. `node scripts/spec-lint.mjs --coverage` reports the rules without a test.
- **No hard-coded interface text**: everything goes through `frontend/web/messages/fr.json`. The only exception: the default consent text of an event form, in `backend/domain/src/consent.rs`, because it is recorded as is with each lead (proof of the text the prospect saw).
- Test code (`test-support`, `test` authentication adapter) must never be present in a production build.
- Never edit the generated files (`openapi.json`, `schema.d.ts`) by hand: `make openapi`.
- Readable code, explicit names, no dead code; do not add features outside the task.

## Debugging

- Every API response carries an `x-request-id` header, repeated in the `error.request_id` field of JSON errors (`{"error":{"code","message","request_id"}}`) and in **every log line** of the request.
- The API logs are JSON: `docker compose -f compose.test.yml logs api | grep <request_id>`.
- A failing e2e test leaves its artifacts in `frontend/e2e/test-results/`: `trace.zip` (open it with `pnpm -C frontend --filter e2e exec playwright show-trace <path>`), screenshot, video and an `api-logs` attachment (the API logs during the test, with the `request_id`s).
- Reproduce with a test first, fix only afterwards.

## Agents (`.claude/agents/`)

| Agent | When to use it | Model |
|---|---|---|
| `explorer` | Search and summarize the code or the spec, read-only. | Haiku 5.5 |
| `planner` | Turn a request into a spec update and a task plan (writes only in `spec/` and `docs/`). | Opus 5.5, high |
| `builder` | Implement a task of the plan, with its tests. | Sonnet 5.5, medium |
| `task-reviewer` | Review a finished task (plan, spec, tests, readability). | Sonnet 5.5, high |
| `feature-reviewer` | Review a feature or a fix end to end. | Opus 5.5, high |
| `debugger` | Reproduce, diagnose and fix a bug. | Sonnet 5.5, high |
| `debugger-deep` | Complex bug, or when `debugger` has failed twice. | Opus 5.5, high |

## Skills (`.claude/skills/`)

| Skill | When to use it |
|---|---|
| `dev-env` | Start the database, the API and the site locally; seed; reset; switch from the `test` adapter to Clerk; drive the test clock. |
| `run-tests` | Run a targeted test, the tests of a rule (`XXX-NNN`) or the full suite before concluding. |
| `debug-failure` | Diagnose a failure: reproducing test, `x-request-id`, API logs, Playwright trace, escalation to `debugger-deep`. |
| `update-spec` | Add or change a rule in `spec/` without contradiction, before coding. |
| `change-api` | Change the API: migration, `db/`, domain, route and OpenAPI, tests, generated client, frontend. |
| `add-seed-scenario` | Add a data scenario for `make seed` and Playwright. |
| `add-card-template` | Add a card template (public page): folder, settings schema, registry, translations, contract and e2e. |
