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
  **One server per worktree that runs tests.** `#[sqlx::test]` names its databases after the test path only, so two worktrees running Rust tests at the same time on the same server drop each other's databases: a test then fails at random (a `404` on a card just created, a panic in `sqlx-core/src/testing/mod.rs`) and passes when rerun alone. Give each worktree its own server: in its `.env`, `DEV_DB_PORT=<free port>` and `DATABASE_URL=postgres://cartouche:cartouche@localhost:<port>/<database>`, then `make dev-db` (docker compose uses the directory name as project, so the container and volume are separate).
- **Rust: always `--all-features`** (some tests use the `test-support` probe, e.g. `/api/test/approved-check`).
- **e2e**: Docker running; the tests run in the `Europe/Paris` time zone and the `fr-FR` locale (`frontend/e2e/playwright.config.ts`), so the times shown and entered in the event tests are Paris times (a date assertion must take this into account); `make e2e` builds and starts the test stack (ports 15432/18080/13000). Do not run two `make e2e` in parallel (shared database). The stack (`compose.test.yml`, docker compose project `cartouche-test`, fixed ports) is shared by **every worktree of the machine**: two worktrees running `make e2e` at the same time tear down each other's containers, so a failure with a stack that vanishes mid-run usually means another worktree started its own.

## A targeted test

```bash
# Rust: the integration tests are one binary, `it` (tests/it/main.rs); filter on <file>::<test name>
cd backend && cargo test -p cartouche-api --all-features --test it account::approved_user
cd backend && cargo test -p cartouche-api --all-features --test it account::  # a whole file
# The filter is a substring: `cards::` also runs `admin_cards::`, `db_cards::` and `public_cards::`.
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

Then run each file found (Rust: `--test it <file without .rs>::` for `backend/server/tests/it/<file>.rs`, or `--lib` for `src/`; web: `pnpm -C frontend --filter web test <file>`; e2e: `make e2e ARGS="-g ACC-004"`). A rule without a test shows up with `node scripts/spec-lint.mjs --coverage`.

## The tests of events and leads

Rules: `EVT-*` (`spec/events.md`), `FRM-*` (`spec/event-form.md`), `ABU-*` (`spec/anti-abuse.md`), `LEA-*` (`spec/leads-exports.md`, leads and exports).

| Topic | Rust (`backend/server/tests/it/`, `--test it <file>::`) | Web (vitest, file pattern) | e2e (`make e2e ARGS=…`) |
|---|---|---|---|
| Owner's events (creation, duration, concurrent, code) | `events`, `db_events`; domain: `cargo test -p cartouche-domain` | `src/lib/events`, `src/components/events` (`EventEditor`, `EventList`) | `tests/events.spec.ts` |
| Leads (list, whole-card list, spam, deletion) | `leads`, `db_events` | `LeadList`, `LeadDetail`, `src/lib/events/leads`, `lead-search`, `lead-answers`, `lead-actions` | `tests/leads.spec.ts` (LEA-002 to LEA-020, ACC-017) |
| Exports (CSV, XLSX, JSON; file name, spam, time zone) | `lead_exports`; files: `cargo test -p cartouche-domain export` | `ExportDialog`, `src/lib/events/lead-export`, `useDownloadExport` in `src/lib/api.test.tsx` | `tests/exports.spec.ts` (`-g LEA-0`) |
| Public page, form, submission | `public_events`, `public_cards`, `leads_submit` | `src/lib/event-form`, `src/components/event-form` (`LeadForm`, `EventFormPage`), `src/lib/public-event.test.ts` | `tests/event-form.spec.ts`, `tests/public-page.spec.ts` (`-g TPL-003`) |
| Per-IP limit, address used, honeypot field | `client_ip`, `leads_submit`, `public_events`; sliding window: `cargo test -p cartouche-domain` | | `tests/event-form.spec.ts` (`-g ABU-`) |
| Signed media URLs (MED-023, MED-024) | `media`; signature: `cargo test -p cartouche-api --all-features --lib` | | |

These tests depend on the clock: in Rust the harness (`tests/it/common/`) provides a frozen clock (`ManualClock`) and `request_from(ip, …)` to set the client's address; in e2e, `api.seedEvents()` freezes the clock at `EVENTS_NOW` (2027-03-15 10:00 UTC) **before** any sign-in. An event test that fails with an expired token forgot this order (see `add-seed-scenario`). The concurrency tests (`join_all`) live in `tests/it/events.rs` (concurrent events) and `tests/it/leads_submit.rs` (double submission).

## Support access, account deletion and blocked slugs

Rules: `ADM-007`, `ADM-008`, `ADM-016` to `ADM-020` (`spec/admin-support.md`, support views of events and leads and their audit), `ACC-018` to `ACC-024` (`spec/account-auth.md`, account deletion), `LNK-015`, `LNK-031` to `LNK-033` (`spec/card-links.md`, blocked slugs).

| Topic | Rust (`backend/server/tests/it/`, `--test it <file>::`) | Web (vitest, file pattern) | e2e (`make e2e ARGS=…`) |
|---|---|---|---|
| Support views of events and leads, audit | `admin_leads` (audit rows included); other support actions: `admin_cards` | `src/components/support` (`SupportEventList`, `SupportLeads`), the pages under `src/app/(app)/support/cards` | `tests/support-leads.spec.ts` (`-g ADM-007`) |
| Account deletion | `account_deletion` (all-or-nothing: media storage failure), `account` | `DeleteAccount`, `src/lib/account/deletion`, `src/app/(app)/account-deleted/page.test.tsx` | `tests/account-deletion.spec.ts` (`-g ACC-02`) |
| Blocked slugs (claim, suggestion, availability) | `blocked_slugs` (including the race with a deletion), `slugs`, `cards` | | `tests/account-deletion.spec.ts` (`-g LNK-032`) |
| Leave guard of the editors (EDI-016, EDI-021) | | `src/lib/leave-guard.test.tsx`, `EventEditor`, `CardEditor` | `tests/events.spec.ts`, `tests/editor.spec.ts` |

**Downloads in e2e**: start listening **before** the click, `const downloading = page.waitForEvent("download"); await page.getByTestId(…).click(); const download = await downloading;`, then read the file with `downloadedText(download)` or `downloadedBytes(download)` (`frontend/e2e/fixtures.ts`) and check `download.suggestedFilename()`. The tests of exports freeze the clock with `api.seedEvents()`, so the day in the file name is `2027-03-15`.

**XLSX**: a spreadsheet is a zip of XML, so the Rust tests open it with the `calamine` dev-dependency of `cartouche-domain` (`backend/domain/src/export/xlsx.rs`, `cargo test -p cartouche-domain export`) and read back the cells (sheet "Contacts", text kept as text, accents and emojis intact). In e2e, `downloadedBytes` only checks the file name and that it is a zip (`PK` signature); the content is checked in Rust.

## The full suite (before concluding a task)

```bash
make lint test e2e              # lint, unit + integration tests + spec-lint, then Playwright: mandatory before every push (CI runs e2e only on main)
node scripts/spec-lint.mjs --coverage   # rules without a test: to read, not blocking
make e2e-down                   # stops the test stack when done
```

`make test` = `test-api` + `test-web` + `spec-lint-test` + `spec-lint`. Never announce "it passes" without having seen the output of these commands.
On failure: see the `debug-failure` skill.
