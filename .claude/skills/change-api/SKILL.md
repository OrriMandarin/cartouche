---
name: change-api
description: Use when adding or changing a Cartouche API endpoint, database table or column: migration, db functions, domain logic, route with OpenAPI annotation, integration tests, generated client and frontend adaptation.
---

# Change the API

Precondition: the spec rule exists (skill `update-spec`). Order to follow, each step with its test (TDD: failing test first).

Folders: `backend/domain/` (`cartouche-domain`, pure logic), `backend/server/` (`cartouche-api`). Local machine: `source ~/.cargo/env`, `export PATH="$HOME/.local/bin:$PATH"`, dev database running (`make dev-db`) and `DATABASE_URL` exported for `cargo test`.

1. **SQLx migration**: `backend/server/migrations/NNNN_<name>.sql` (next number after `ls backend/server/migrations`). Applied migrations are never modified: add a new one. They are applied when the API starts and in `#[sqlx::test(migrations = "./migrations")]`.
2. **New tables in `RESET_TABLES`** (`backend/server/src/test_support/seed.rs`): otherwise `reset` does not empty them and the e2e tests pollute each other. A table that references another goes before it, or stays covered by `truncate … cascade`.
3. **`db/` functions** (`backend/server/src/db/<table>.rs`, declared in `db/mod.rs`): SQLx queries with the `sqlx::query!` / `query_as!` macros (checked at compile time against the `backend/.sqlx/` cache), then `make sqlx-prepare` and commit the `.sqlx/` diff; otherwise compilation fails ("no cached data for this query") and so does `make sqlx-check`. **Every read or write of user data takes the owner's identifier** and puts it in the `where` clause; no function without an owner on user data. The only exceptions are documented **at the top of the file**: `db/public_cards.rs` and `db/admin_cards.rs`, the `*_public` functions of `db/events.rs` (reading an event of a card already resolved by its slug) and `lock_device`, `count_for_device`, `insert` of `db/leads.rs` (write by an anonymous prospect, always for an event resolved by `events::find_public`), `db/admin_leads.rs` (support reads of events and leads, called only from `/api/admin/*`), `db/blocked_slugs.rs` (global like `db/slugs.rs`: a hash of a slug holds no owner by design) and `db/account.rs` (works on the caller's own user ID, which is the owner). Any new exception is documented the same way and justified in review.
4. **Business logic in `cartouche-domain`**: rules, validation, normalization (`normalize`: NFC + trim). The handler contains no logic. Every external dependency (clock, token, storage, email) goes through a trait.
5. **Route** (`backend/server/src/routes/<name>.rs`, declared in `routes/mod.rs`): the handler reads the request, calls the domain and `db/`, formats the response. Annotate with `#[utoipa::path(...)]` (method, `path`, `summary`, `description`, `tag`, `security(("bearer" = []))`, **all** the responses including 401/403/500 with `ErrorBody`) and derive `ToSchema` on the types. Errors go through `ApiError` (`src/error.rs`, shape `{"error":{"code","message","request_id"}}`); a new error code = a new variant. An input error is `ApiError::Validation(Vec<FieldError>)`: `400 validation_failed` with `"fields":[{"field","code"}]` (paths like `content.email`, `links[3].url`; the `fields` field exists only for this code). A `multipart/form-data` body (media upload) is read with the `ApiMultipart` extractor (`src/extract.rs`): `413 payload_too_large` and `415 unsupported_media_type` are already translated there. Then wire the route in `src/app.rs` and add the handler to `paths(...)` in `src/openapi.rs` (new schemas in `components(schemas(...))`, new tag in `tags(...)`). The `/api/test/*` routes are **never** in the OpenAPI. Owner routes take the `ApprovedUser` extractor; public routes take no token and carry the `public` tag; support routes take `AdminUser` and carry the `admin` tag.
6. **Integration tests** (`backend/server/tests/<subject>.rs`, harness `tests/common`): `// spec: XXX-NNN` before each test. Cover at minimum: nominal case, 401 without a token, non-approved account status (403) if the route requires an approved account, isolation between owners.
   ```bash
   cd backend && cargo test -p cartouche-api --all-features --test <file>
   ```
7. **Regenerate the contract and the client**: `make openapi` (writes `frontend/api-client/openapi.json` then `src/schema.d.ts`). Never edit these files by hand; commit their diff. Without this, the `openapi_is_up_to_date` test fails ("OpenAPI drift").
8. **Frontend**: use the generated types of `@cartouche/api-client` through `frontend/web/src/lib/api.ts`; logic in `frontend/web/src/lib`, components without business logic; every text in `frontend/web/messages/fr.json` (no hardcoded text). Vitest tests with the rule in the name, and an e2e test (`frontend/e2e/tests/`) if a user journey changes.
9. **Verify**: `make lint test`, then `make e2e` if the interface is touched.

## Public route for an object attached to a card (events, form)

Models: `routes/public_events.rs` and `routes/public_cards.rs`.

- **Resolve the card with `serve_card(state, slug)`** (`routes/public_cards.rs`), never with a home-grown query: a former slug or a slug written with capitals reaches the card like the current slug. A card that is not served (disabled, deleted, owner suspended) answers `410 card_inactive`, a slug never assigned `404 not_found`. An unknown object or one of another card is also `404 not_found` (use `events::find_public(db, card.id, event_id)`, never the owner's read).
- **Disclose nothing**: a public view never contains the access code (neither in clear nor hashed), even for an event with a code; the fields, the description and the consent of such an event only come out after a correct code. Write the test that looks for the code in the HTML and in every response of `/api/public/*`.
- **Log nothing of the prospect's input.** The bodies that carry answers or a code (`UnlockBody`, `LeadSubmission`) do **not** derive `Debug` (with a `// No Debug` comment as a reminder); the `ApiJson` extractor only logs the rejection status, because serde's rejection text can quote the values. No `tracing::…` receives an answer, a code or an email address.
- **Per-IP limit**: add a `ClientIp(ip)` to the handler (`src/client_ip.rs`: the n-th address of `X-Forwarded-For` from the right, n = `TRUSTED_PROXY_HOPS`, ABU-008) and go through `state.rate_limiter` (trait `RateLimiter`, `src/rate_limit.rs`). Each counter is a `Bucket` (`LeadSubmission`, `FailedAccessCode`) whose limit comes from the domain. `hit` checks and counts in one step, under a single lock (which counts even a rejected submission); when only a failure counts (a wrong code), take a slot **before** any `await` with `Reservation::take(&state.rate_limiter, bucket, ip, now)`, then `keep()` if it is a failure: the slot is given back (`release`) when the reservation is dropped, otherwise simultaneous requests would all pass the check. A rejection is `ApiError::RateLimited { retry_after_secs }`: `429 rate_limited` with the `Retry-After` header. A new counter = a `Bucket` variant and its constant in the domain. In tests, `app.request_from("203.0.113.7", method, path, token, json)` simulates the address of a client behind the proxy; `POST /api/test/reset` resets the counters.
- **The time always comes from `state.clock.now()`** (submission grace period, per-IP limit window, today's date for a date of birth: `clock.now().date_naive()`), never from `Utc::now()` in `server/src` outside `main.rs` and `bin/`. This is what lets tests freeze the clock.
- **Media URLs** (`views::Audience`): `Audience::Dashboard(now)` for owner and support views (signed URLs, readable even if the card is not served, MED-023), `Audience::Public` for the public (plain URLs, `404` if the card is not served). A view built for the wrong audience is a privacy bug or a broken image.
- **Concurrency**: two simultaneous requests must not cross a limit through a check-then-write. Take a lock in the transaction: the card's (`cards::lock_for_owner`, or `events::lock_card_of_event` which takes it first, for the concurrent events limit) or an advisory lock (`leads::lock_device`, `pg_advisory_xact_lock`, for the per-device limit), then re-read and decide. The test fires the requests together with `futures_util::future::join_all` and counts the statuses (`tests/events.rs`, `tests/leads_submit.rs`).
- **Added error codes** (`ApiError` variants): `too_many_simultaneous_events`, `event_not_running`, `event_closed`, `form_changed`, `device_limit_reached` (409), `invalid_access_code` (403), `rate_limited` (429, `Retry-After`); `card_inactive` (410) and `not_found` (404) are reused. Field codes of `validation_failed`: `end_before_start`, `out_of_range`, `no_fields`, `too_many_fields`, `duplicate_field_id`, `too_few_options`, `too_many_options`, `duplicate_option`, `invalid_date`, `invalid_number`, `invalid_choice`, `invalid_value`, in addition to `required`, `too_long`, `invalid_email`, `invalid_phone`. Field paths look like `custom_fields[2].options[1]` or `answers.address.city`.
- **Environment variables**: a new variable is read in `config`, documented in `.env.example` (without accents) and in the `dev-env` skill. Plan 3's: `MAX_SIMULTANEOUS_EVENTS` (default 3, integer ≥ 1) and `TRUSTED_PROXY_HOPS` (default 1, integer from 0 to 10).

## Route that answers a file (exports)

Model: `routes/lead_exports.rs` (`file_response`), `GET /api/events/{id}/leads/export` and `GET /api/cards/{id}/leads/export`.

- The body is the file's bytes with `Content-Type`, `Content-Disposition: attachment; filename="…"` and `Cache-Control: no-store` (personal data must not stay in a cache). The file itself is built in `cartouche-domain` (`backend/domain/src/export/`: `render` and one module per format); the handler only reads the data, calls `render` and wraps the bytes.
- OpenAPI: a unit struct implementing `PartialSchema` as a binary string (`ExportFileBody`) and one `content((ExportFileBody = "<media type>"), …)` entry per format under the 200 response, so the generated client sees a file and not JSON.
- The generated client reads JSON only, so the web downloads through `useDownloadExport()` (`src/lib/api.ts`, logic in `src/lib/events/lead-export.ts`): it fetches with the session's token, then hands the blob to the browser through a temporary link, named after `Content-Disposition`. A plain `<a href>` would send no token.
- Dates, the day in the file name and the user's time zone: the web sends `tz` (IANA name, `Europe/Paris` when missing or unknown); the time of the export is `state.clock.now()`.
- Nothing from a file (cell, name, address) is logged and an error text never quotes a cell: a failure names the card only. The labels written in the files (column headers, "Oui"/"Non", sheet name) are in `backend/domain/src/export/labels.rs`, in French, because the server writes the file (the second exception to "no hard-coded interface text").

## Support read of user data

Model: `routes/admin_leads.rs` and `db/admin_leads.rs`.

- Route: `AdminUser`, tag `admin`, and a **unique `operation_id`** (`support_list_card_events`, `support_list_event_leads`, `support_list_card_leads`): the same path-based name as an owner route would clash in the generated client.
- `db/`: functions in a `db/admin_*.rs` file whose header documents the exception to the owner rule; they are called only from `/api/admin/*`. Read-only: support has no route that marks, deletes or exports leads (ADM-012, ADM-018).
- **Audit before answering, fail-closed (ADM-019).** Open a transaction, read, `audit::record(&mut tx, AuditEntry { … })`, `commit`, and only then build the response. Any early return drops the transaction: no entry stays and no data is sent; an audit write that fails answers `500`, not the data.
- The audit metadata holds identifiers and counts only (`owner_id`, `card_id`, `lead_count`), never prospect data (ADM-020). A listing that shows no prospect data (the events of a card) is not audited.

## Claim of a slug

A route that gives a card a slug (create, change) reads in this order, in the same transaction (`claim_slug` in `routes/cards.rs`): `slugs::find_for_update`, **then** `blocked_slugs::is_blocked`, then `decide_claim` (LNK-032). The first read waits for a deletion of the account holding the slug to commit; the second, a new statement, then sees the hashes that deletion has just written. The other order can miss them. The read-only checks (`suggest_slug`, `slug_availability`) use `slugs::find` and `is_blocked` with `decide_claim` too, so they never offer a blocked slug. Blocked slugs are kept as SHA-256 hashes.

## Account deletion and new user data

`DELETE /api/me` (`routes/account.rs`, `db/account.rs`) deletes the user and everything that depends on them in one transaction: it locks the user (`users::find_for_update`), blocks the slugs, strips the slugs from the audit log, deletes the user (the cascade removes cards, events, leads…), deletes the media files **before** the commit (a storage failure rolls everything back, nothing is half-deleted), then commits. Consequences for a change:

- A **new table that holds user data** must be reached by the cascade (foreign key `on delete cascade` toward `users` or `cards`) or handled in `db/account.rs`; add it to the account deletion tests (`tests/account_deletion.rs`) and to `RESET_TABLES`.
- A **new kind of file** goes through `MediaService` so `delete_card` removes it with the card.
- A new place that stores a slug (the audit log is one) is stripped or hashed in the deletion (ACC-024).
- A deletion refused to administrators answers `403 cannot_delete_admin`. Tables that must outlive the user hold no foreign key to `users` (migration `0006_account_deletion.sql` dropped the one of `audit_log`).

File storage (media): the database is authoritative. Write files through `MediaService`, commit the transaction **before** deleting files, and clean up storage on a best-effort basis after the `commit`: a file that cannot be removed is logged and left in place, and the request still succeeds. On failure along the way, remove the files already written.

Pitfalls: never SQL built by concatenating inputs; normalize (NFC + trim) every string received before storing it; put nothing in the token that the database must re-read (the status is re-read on every request, ACC-005).
