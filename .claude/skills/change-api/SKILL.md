---
name: change-api
description: Use when adding or changing a Cartouche API endpoint, database table or column: migration, db functions, domain logic, route with OpenAPI annotation, integration tests, generated client and frontend adaptation.
---

# Change the API

Precondition: the spec rule exists (skill `update-spec`). Order to follow, each step with its test (TDD: failing test first).

Folders: `backend/domain/` (`cartouche-domain`, pure logic), `backend/server/` (`cartouche-api`). Local machine: `source ~/.cargo/env`, `export PATH="$HOME/.local/bin:$PATH"`, dev database running (`make dev-db`) and `DATABASE_URL` exported for `cargo test`.

1. **SQLx migration**: `backend/server/migrations/NNNN_<name>.sql` (next number after `ls backend/server/migrations`). Applied migrations are never modified: add a new one. They are applied when the API starts and in `#[sqlx::test(migrations = "./migrations")]`.
2. **New tables in `RESET_TABLES`** (`backend/server/src/test_support/seed.rs`): otherwise `reset` does not empty them and the e2e tests pollute each other. A table that references another goes before it, or stays covered by `truncate … cascade`.
3. **`db/` functions** (`backend/server/src/db/<table>.rs`, declared in `db/mod.rs`): SQLx queries with the `sqlx::query!` / `query_as!` macros (checked at compile time against the `backend/.sqlx/` cache), then `make sqlx-prepare` and commit the `.sqlx/` diff; otherwise compilation fails ("no cached data for this query") and so does `make sqlx-check`. **Every read or write of user data takes the owner's identifier** and puts it in the `where` clause; no function without an owner on user data.
4. **Business logic in `cartouche-domain`**: rules, validation, normalization (`normalize`: NFC + trim). The handler contains no logic. Every external dependency (clock, token, storage, email) goes through a trait.
5. **Route** (`backend/server/src/routes/<name>.rs`, declared in `routes/mod.rs`): the handler reads the request, calls the domain and `db/`, formats the response. Annotate with `#[utoipa::path(...)]` (method, `path`, `summary`, `description`, `tag`, `security(("bearer" = []))`, **all** the responses including 401/403/500 with `ErrorBody`) and derive `ToSchema` on the types. Errors go through `ApiError` (`src/error.rs`, shape `{"error":{"code","message","request_id"}}`); a new error code = a new variant. An input error is `ApiError::Validation(Vec<FieldError>)`: `400 validation_failed` with `"fields":[{"field","code"}]` (paths like `content.email`, `links[3].url`; the `fields` field exists only for this code). A `multipart/form-data` body (media upload) is read with the `ApiMultipart` extractor (`src/extract.rs`): `413 payload_too_large` and `415 unsupported_media_type` are already translated there. Then wire the route in `src/app.rs` and add the handler to `paths(...)` in `src/openapi.rs` (new schemas in `components(schemas(...))`, new tag in `tags(...)`). The `/api/test/*` routes are **never** in the OpenAPI.
6. **Integration tests** (`backend/server/tests/<subject>.rs`, harness `tests/common`): `// spec: XXX-NNN` before each test. Cover at minimum: nominal case, 401 without a token, non-approved account status (403) if the route requires an approved account, isolation between owners.
   ```bash
   cd backend && cargo test -p cartouche-api --all-features --test <file>
   ```
7. **Regenerate the contract and the client**: `make openapi` (writes `frontend/api-client/openapi.json` then `src/schema.d.ts`). Never edit these files by hand; commit their diff. Without this, the `openapi_is_up_to_date` test fails ("OpenAPI drift").
8. **Frontend**: use the generated types of `@cartouche/api-client` through `frontend/web/src/lib/api.ts`; logic in `frontend/web/src/lib`, components without business logic; every text in `frontend/web/messages/fr.json` (no hardcoded text). Vitest tests with the rule in the name, and an e2e test (`frontend/e2e/tests/`) if a user journey changes.
9. **Verify**: `make lint test`, then `make e2e` if the interface is touched.

File storage (media): the database is authoritative. Write files through `MediaService`, commit the transaction **before** deleting files, and clean up storage on a best-effort basis after the `commit`: a file that cannot be removed is logged and left in place, and the request still succeeds. On failure along the way, remove the files already written.

Pitfalls: never SQL built by concatenating inputs; normalize (NFC + trim) every string received before storing it; put nothing in the token that the database must re-read (the status is re-read on every request, ACC-005).
