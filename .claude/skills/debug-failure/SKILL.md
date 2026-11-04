---
name: debug-failure
description: Use when a Cartouche test (Rust, vitest or Playwright) fails, an API call returns an unexpected error, or a bug is reported and you need to reproduce and diagnose it before fixing.
---

# Diagnose a failure

Basic rule: **reproduce with a test first, fix second.** If the bug reveals a missing or wrong rule, go through `update-spec` before coding.

## 1. Write a reproducing test

At the lowest level that shows the defect: domain (`cartouche-domain`), integration (`backend/server/tests/it/`), component (vitest), and e2e only if the defect is in the browser + API sequence. Cite it with its rule (`// spec: XXX-NNN` or `XXX-NNN` in the name). See it fail **for the right reason**. Commands: skill `run-tests`.

## 2. Follow a request end to end

Every API response carries `x-request-id`; on error it is also in the body: `{"error":{"code","message","request_id"}}`. The same identifier appears in **every log line** of the request.

```bash
curl -si localhost:8080/api/me -H 'x-request-id: debug-1'      # your own identifier (1 to 64 characters [A-Za-z0-9-])
docker compose -f compose.test.yml logs api | grep <request_id>    # test stack (JSON logs)
```

In dev (`make api`), the logs are readable in the API terminal: look for the same identifier. In the browser, the identifier of an API error is also in the Network tab (response header) and in the Sentry tag `request_id`.
The error `code` already says a lot: `token_invalid` / `token_expired` (401), `auth_unavailable` (503), `account_pending|rejected|suspended` (403), `internal_error` (500, detail only in the logs).

**Support reads leave a trace**: each load of a support contact list (`/api/admin/events/{id}/leads`, `/api/admin/cards/{id}/leads`) writes one `leads.viewed` row in `audit_log` before the contacts are sent (ADM-019); if that write fails the request is a `500` and no contact is sent. So an unexpected `500` on a support list is first an audit write failure (look for its `request_id` in the logs). Two rows for one visit in `next dev` come from React StrictMode mounting the list twice, not from a bug; production writes one.

**A download that fails**: an export answers a file, not JSON, so the browser console shows nothing useful: take the `x-request-id` from the response header in the Network tab (or from the error notice) and look for it in the API logs. Prospects' data never appears in the logs (identifiers and counts only): an export error names the card.

## 3. Playwright failure

The artifacts of a failed test are in `frontend/e2e/test-results/<test-folder>/`: `trace.zip`, screenshot, video, `api-logs.txt` (attachment `api-logs`: API logs during the test, with the `request_id`s).

```bash
ls frontend/e2e/test-results/*/
pnpm -C frontend --filter e2e exec playwright show-trace test-results/<test-folder>/trace.zip   # path relative to frontend/e2e/ (pnpm exec runs in that folder)
pnpm -C frontend --filter e2e report                                   # HTML report (frontend/e2e/playwright-report)
cat frontend/e2e/test-results/<test-folder>/api-logs.txt | grep <request_id>
```

Read `api-logs.txt` first (the failing request and its `request_id`), then the trace (DOM state, network requests, console). If the test cannot find `api-logs.txt`: is the test stack actually running (`docker compose -f compose.test.yml ps`)?
Rerun a single test: `make e2e ARGS="-g <title or rule>"`. If the stack keeps a doubtful state: `make e2e-down` then `make e2e`.

## 4. Rust / vitest failure

- Rust: `cd backend && cargo test -p cartouche-api --all-features --test it <file>::<name> -- --nocapture`, with `DATABASE_URL` exported (see `run-tests`). `RUST_BACKTRACE=1` for the stack trace.
- Vitest: `pnpm -C frontend --filter web test <file>`; add `--reporter=verbose` if needed.

## 5. Fix, then widen

One identified cause (not a symptom), the minimal fix, the reproducing test passes, then `make lint test` (and `make e2e` if the browser journey is touched).

## Escalation

- Agent `debugger` first (reproduces, diagnoses, fixes).
- **If two attempts fail** (the test passes then breaks elsewhere, cause not established, non-deterministic behavior, several layers involved): move to `debugger-deep`, giving it the reproducing test, the `request_id`s and what has already been tried.
- Contradiction with the spec or a needed change of behavior: stop and report it to the project maintainer.
