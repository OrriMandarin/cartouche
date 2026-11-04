---
name: run-tests
description: Use when you need to run Cartouche tests: one test, the tests of a spec rule (XXX-NNN), a single package, or the full suite before concluding a task.
---

# Run the tests

Local machine: `export PATH="$HOME/.local/bin:$PATH"` and `source ~/.cargo/env` if needed.

## Prerequisites

- **Rust (integration)**: the `#[sqlx::test]` tests need the dev database and `DATABASE_URL`.
  ```bash
  make dev-db
  export DATABASE_URL=postgres://cartouche:cartouche@localhost:54320/cartouche
  ```
  `make test-api` / `make test` use the `Makefile`'s default `DATABASE_URL`; for a direct `cargo test`, export it.
- **Rust: always `--all-features`** (some tests use the `test-support` probe, e.g. `/api/test/approved-check`).
- **e2e**: Docker running; the tests run in the `Europe/Paris` time zone and the `fr-FR` locale (`frontend/e2e/playwright.config.ts`), so the times shown and entered in the event tests are Paris times (a date assertion must take this into account); `make e2e` builds and starts the test stack (ports 15432/18080/13000). Do not run two `make e2e` in parallel (shared database).

## A targeted test

```bash
# Rust: file tests/<file>.rs, filter on the test name
cd backend && cargo test -p cartouche-api --all-features --test account approved_user
cd backend && cargo test -p cartouche-domain                      # pure business logic
cd backend && cargo test -p cartouche-api --all-features --lib    # inline tests in src/

# Web (vitest): file pattern, or -t to filter on the test name
pnpm -C frontend --filter web test AccountGate
pnpm -C frontend --filter web test -t ACC-004
pnpm -C frontend --filter @cartouche/api-client test

# e2e (Playwright): ARGS is passed to `playwright test`
make e2e ARGS="-g ACC-004"
make e2e ARGS="tests/account.spec.ts --project=desktop"
```

Do not write `pnpm -C frontend --filter web test -- <pattern>`: the `--` is passed as is to vitest and the filter is ignored (the whole suite runs).

## The tests of a rule

A test cites its rule (`// spec: ACC-004` in Rust, `ACC-004` in the name in TypeScript).

```bash
grep -rn "ACC-004" backend frontend --include='*.rs' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.next
```

Then run each file found (Rust: `--test <file without .rs>` for `backend/server/tests/<file>.rs`, or `--lib` for `src/`; web: `pnpm -C frontend --filter web test <file>`; e2e: `make e2e ARGS="-g ACC-004"`). A rule without a test shows up with `node scripts/spec-lint.mjs --coverage`.

## The tests of events and leads

Rules: `EVT-*` (`spec/events.md`), `FRM-*` (`spec/event-form.md`), `ABU-*` (`spec/anti-abuse.md`), `LEA-*` (`spec/leads-exports.md`, leads).

| Topic | Rust (`backend/server/tests/`, `--test <file>`) | Web (vitest, file pattern) | e2e (`make e2e ARGS=…`) |
|---|---|---|---|
| Owner's events (creation, duration, concurrent, code) | `events`, `db_events`; domain: `cargo test -p cartouche-domain` | `src/lib/events`, `src/components/events` (`EventEditor`, `EventList`) | `tests/events.spec.ts` |
| Leads (list, spam, deletion) | `leads`, `db_events` | `LeadList`, `src/lib/events/leads` | `tests/leads.spec.ts` |
| Public page, form, submission | `public_events`, `public_cards`, `leads_submit` | `src/lib/event-form`, `src/components/event-form` (`LeadForm`, `EventFormPage`), `src/lib/public-event.test.ts` | `tests/event-form.spec.ts`, `tests/public-page.spec.ts` (`-g TPL-003`) |
| Per-IP limit, address used, honeypot field | `client_ip`, `leads_submit`, `public_events`; sliding window: `cargo test -p cartouche-domain` | | `tests/event-form.spec.ts` (`-g ABU-`) |
| Signed media URLs (MED-023, MED-024) | `media`; signature: `cargo test -p cartouche-api --all-features --lib` | | |

These tests depend on the clock: in Rust the harness (`tests/common/`) provides a frozen clock (`ManualClock`) and `request_from(ip, …)` to set the client's address; in e2e, `api.seedEvents()` freezes the clock at `EVENTS_NOW` (2027-03-15 10:00 UTC) **before** any sign-in. An event test that fails with an expired token forgot this order (see `add-seed-scenario`). The concurrency tests (`join_all`) live in `tests/events.rs` (concurrent events) and `tests/leads_submit.rs` (double submission).

## Fonts and reduced motion in e2e

- Fonts: listen to `page.on("request")` and keep the URLs ending in `.woff2`; the public page must download only the files of its pair (TPL-012), and wait for `networkidle` before asserting (see `public-page.spec.ts`).
- Reduced motion: call `page.emulateMedia({ reducedMotion: "reduce" })` before `page.goto` (PUB-005, PUB-038); the header video then shows its poster and the animations stop.

## The full suite (before concluding a task)

```bash
make lint test e2e              # lint, unit + integration tests + spec-lint, then Playwright: mandatory before every push (CI runs e2e only on main)
node scripts/spec-lint.mjs --coverage   # rules without a test: to read, not blocking
make e2e-down                   # stops the test stack when done
```

`make test` = `test-api` + `test-web` + `spec-lint-test` + `spec-lint`. Never announce "it passes" without having seen the output of these commands.
On failure: see the `debug-failure` skill.
