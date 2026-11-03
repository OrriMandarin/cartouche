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
- **e2e**: Docker running; `make e2e` builds and starts the test stack (ports 15432/18080/13000). Do not run two `make e2e` in parallel (shared database).

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

## The full suite (before concluding a task)

```bash
make lint test e2e              # lint, unit + integration tests + spec-lint, then Playwright: mandatory before every push (CI runs e2e only on main)
node scripts/spec-lint.mjs --coverage   # rules without a test: to read, not blocking
make e2e-down                   # stops the test stack when done
```

`make test` = `test-api` + `test-web` + `spec-lint-test` + `spec-lint`. Never announce "it passes" without having seen the output of these commands.
On failure: see the `debug-failure` skill.
