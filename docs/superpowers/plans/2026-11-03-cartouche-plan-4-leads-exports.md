# Cartouche — Plan 4: Leads, exports, support access to leads, account deletion — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner finds, searches and reads their leads per event and for a whole card, marks or deletes them from the list or from a detail view, and downloads them as CSV (UTF-8 with BOM, Notion-compatible), native XLSX or typed JSON, spam excluded by default; an administrator views any user's events and leads read-only, each view of leads being recorded in the audit log; a user deletes their account and all their data (cards, media files, events, leads), their slugs being kept only as hashes so that no old link ever points to a stranger.

**Architecture:** Pure rules go to `cartouche-domain`: the export table (column planning, merge of custom fields across events, cell typing, time zone), the CSV, XLSX and JSON writers and the file name (`export/`), the slug-claim decision with blocked slugs, and the account-deletion guard. `cartouche-api` adds migration `0006` (`blocked_slugs`, audit actor no longer a foreign key), the whole-card lead list and the two export routes for the owner, three read-only support routes that write `leads.viewed` audit entries before answering, and `DELETE /api/me`, which deletes the account in one transaction that also deletes the media files. The web gets a reusable lead list (search, detail dialog, in-place updates, owner or read-only mode), the whole-card page, an export dialog that downloads through an authenticated `fetch`, the support pages for events and leads, the "Mon compte" page with the deletion dialog and the `/account-deleted` page, and the event editor's unsaved-changes guard.

**Tech Stack:** what plans 1 to 3 use (Rust 2024, Axum 0.8, SQLx 0.9 offline, utoipa 5, `object_store` 0.14, `aws-lc-rs` 1.19 · Next 16, React 19, Tailwind 4, shadcn/ui, next-intl, openapi-fetch, `date-fns` 4 + `@date-fns/tz` 1, Vitest, Playwright 1.64) + in `cartouche-domain`: `csv` 1, `rust_xlsxwriter` (current release, with its `chrono` feature if the release has one), `chrono-tz` 0.10; dev-dependency `calamine` (current release) to read XLSX files back in tests. No new web dependency.

**Spec:** `spec/` is authoritative: `leads-exports.md` (LEA-001 to LEA-032), `account-auth.md` (ACC-004 amended, ACC-018 to ACC-024), `admin-support.md` (ADM-007, ADM-008, ADM-016 to ADM-020), `card-links.md` (LNK-015, LNK-016, LNK-031 to LNK-033), `dashboard-editor.md` (EDI-010, EDI-021). Frozen initial design: `docs/superpowers/specs/2026-11-02-cartouche-design.md` (French), sections 5.1, 5.7, 5.8, 7.2 and 7.5. Rules added for this plan: LEA-013 to LEA-032, ACC-019 to ACC-024, ADM-016 to ADM-020, LNK-031 to LNK-033, EDI-021, plus three glossary terms; ACC-004 amended.

**Paths:** `backend/` (Cargo workspace: `domain/`, `server/`), `frontend/` (pnpm workspace: `web/`, `api-client/`, `e2e/`). Local machine: `source ~/.cargo/env` and `export PATH="$HOME/.local/bin:$PATH"` before `make`. The development database of this worktree is `cartouche_plan4` on the shared PostgreSQL at `localhost:54320`, already set in the worktree's `.env`: **do not run `make dev-db`**, the database is already running; `make sqlx-prepare` and `make sqlx-check` use it.

**Follow-ups:** `docs/superpowers/plans/2026-11-03-cartouche-plan-4-followups.md` (spec/plan rulings R-S1 to R-S26, then execution rulings and review findings).

---

## Points ruled without the owner

This plan runs without the project owner: each open question was decided in favour of the option most consistent with the existing spec and the frozen design, written as a numbered rule and recorded as a ruling (`R-S<n>`) in the follow-ups file. **Four rulings change behaviour that plans 1 to 3 already shipped: points 20 to 23.**

1. **API shape** (R-S1): owner `GET /api/cards/{id}/leads`, `GET /api/events/{id}/leads/export`, `GET /api/cards/{id}/leads/export` (`format=csv|xlsx|json` required, `include_spam=false` by default, `tz` optional); support `GET /api/admin/cards/{id}/events`, `GET /api/admin/events/{id}/leads`, `GET /api/admin/cards/{id}/leads`; `DELETE /api/me` → 204; new error code `cannot_delete_admin` 403; `LeadView.event_title`. Tasks 1, 4, 6, 8.
2. **Search in the browser** (LEA-014 to LEA-016, R-S2): the loaded list is filtered by a `lib` function (words ANDed, case and accents ignored, phone digits); no pagination, no search route. Tasks 9, 10.
3. **Detail view = dialog** over the list, from the list's data; no route, no extra audit (LEA-018, ADM-019, R-S3). Task 10.
4. **Exports generated in the domain** with `csv`, `rust_xlsxwriter`, `chrono-tz` (R-S4). Tasks 2, 3.
5. **French headers in the domain** (`export/labels.rs`), second documented exception to "no hard-coded interface text"; JSON keys in English (LEA-023, LEA-030, R-S5). Tasks 2, 3, 15.
6. **Time zone of exports** (LEA-026, R-S6): the browser's zone as `tz`, Europe/Paris when unknown, named in the two time headers; JSON in UTC. Tasks 2, 4, 9.
7. **CSV dialect** (LEA-027, R-S7): RFC 4180, comma, CRLF, BOM; the export dialog advises XLSX for Excel. Tasks 3, 11.
8. **Formula injection** (LEA-028, LEA-029, R-S8): apostrophe prefix in CSV, text cells only in XLSX. Task 3.
9. **Columns** (LEA-023 to LEA-025, R-S9): standard columns asked or answered; custom columns by event, deleted fields after current ones; whole-card merge by label (case and accents ignored) and type; " (2)" suffixes. Task 2.
10. **Rows oldest first; search does not filter exports; disabled cards exportable** (LEA-021, LEA-023, R-S10). Tasks 2, 4.
11. **File name and headers** (LEA-022, LEA-032, R-S11). Tasks 3, 4.
12. **Authenticated download** through `fetch` + blob (R-S12). Tasks 9, 11.
13. **Support access** (ADM-016 to ADM-020, R-S13): read-only; events not audited; each lead list request audited before the answer, fail-closed; administrators cannot export, mark or delete. Tasks 6, 12.
14. **Who can delete** (ACC-021, R-S14): every status; not a current administrator. Tasks 8, 13.
15. **Deletion transaction** (ACC-022, R-S15): rows then files inside one transaction; a storage error rolls back → 500. Task 8.
16. **Identity provider untouched** (ACC-023, R-S16): sign-out and an explanation; a later sign-in is a new account; no tombstone. Tasks 8, 13.
17. **Typed confirmation "SUPPRIMER"** (ACC-020, R-S17). Task 13.
18. **Blocked slugs** (LNK-031 to LNK-033, R-S18): SHA-256 computed in SQL, hash only; claim locks the slug row before checking the blocked list; a blocked slug resolves like a deleted card. Task 7.
19. **Audit log outlives accounts** (ACC-024, R-S19): migration drops the actor foreign key; deletion strips slugs from the metadata of the user's entries. Tasks 7, 8.
20. **(changes implemented behaviour) ACC-004 amended** (R-S20): account deletion is open to `pending`, `rejected` and `suspended` accounts, whose screens offer it. Tasks 8, 13.
21. **(changes implemented behaviour) Lead list display and refresh** (LEA-017, LEA-020, R-S21): no repeated email; in-place update after an action, no stale list. Task 10.
22. **(changes implemented behaviour) Spam date kept on re-marking** (R-S22, `coalesce`). Task 1.
23. **(changes implemented behaviour) Event editor asks before leaving unsaved changes** (EDI-021, R-S23). Task 14.
24. **Seed: one answer to a deleted field** (R-S24) on Jean-Michel's lead, no new lead or event. Task 5.
25. **Support event list reuses `EventView`** (R-S25). Task 6.

## Plan 3 follow-ups taken up here

From `docs/superpowers/plans/2026-11-03-cartouche-plan-3-followups.md`:

1. R-S15 (plan 4 adds search, detail view, whole-card view, exports and support access on top of plan 3's routes and page) → LEA-013 to LEA-032, ADM-016 to ADM-020; Tasks 1 to 4, 6, 9 to 12. Plan 3's three lead routes are kept unchanged (apart from the added `event_title`).
2. R-E5 / "Constats reportés": event editor without an unsaved-changes guard → **EDI-021**, Task 14.
3. Task 10 minor: re-marking spam overwrites `spam_at` → `coalesce`, Task 1 (R-S22).
4. Task 10 minor: no test for a non-boolean spam body or a malformed lead id → tests in Task 1.
5. Task 15 minor: a failed post-action reload leaves a stale list → LEA-020, Task 10 (R-S21).
6. Task 15 minor: email shown twice for a nameless lead → LEA-017, Tasks 9 and 10 (R-S21).
7. Task 15 minor: uncommented `useEffect` void-async wrapper in `LeadList` → rewritten in Task 10.
8. Task 11 minor: `seed_lead` passes the raw event title to the consent text; custom-consent seed branch untested → Task 5.
9. Task 11 minor: "`make seed SCENARIO=events` needs base and cards first, check the docs" → already documented in the `dev-env` skill and `CLAUDE.md`; nothing to do.

Kept deferred, with their reason, in the plan 4 follow-ups file ("Deferred findings (carried over from plan 3)"): the in-memory limiter without a cap (R-E8, no anti-abuse rule touched here), S3 media of an unserved card (MED-024, documented v1 limit; deleted accounts now lose their files), the flaky tests (not reproduced; watched during the final gate), the TDD order of plan 3 Task 17 (historical), and the plan 3 minors in files this plan does not touch.

## Global Constraints

- Languages (`CLAUDE.md`): code, identifiers, comments, commits, spec and docs in **English**; interface texts in **French** with accents, all in `frontend/web/messages/fr.json`. Two documented exceptions: the default consent text (`backend/domain/src/consent.rs`, plan 3) and the export labels (`backend/domain/src/export/labels.rs`, R-S5): column headers, "Oui"/"Non", the sheet name "Contacts", the `evenement` fallback of file names.
- No business logic in handlers or components: `cartouche-domain` or `frontend/web/src/lib`. A handler reads the request, calls the domain and `db/`, formats the response.
- Every `db/` function on user data takes the owner's ID and puts it in the `where`. New documented exceptions, listed at the top of their file: `db/admin_leads.rs` (support reads, called only from `/api/admin/*`), `db/blocked_slugs.rs` (global, like `db/slugs.rs`; holds no owner by design), `db/account.rs` (works on the caller's own user ID, which is the owner).
- Time always comes from `state.clock.now()`: export date, `exported_at`, spam date. Never `Utc::now()` in `server/src` outside `main.rs` and `bin/`.
- Error body: `{"error":{"code","message","request_id"}}`. New code: `cannot_delete_admin` 403. Reused: `not_found` 404, `forbidden` 403, `invalid_request` 400, `slug_taken` 409, `card_inactive` 410, `internal_error` 500.
- **Prospects' personal data never goes to logs**: no lead field, export content or file name in a `tracing` event (identifiers and counts only).
- Routes: owner routes with `ApprovedUser`, tag `leads`; support routes with `AdminUser`, tag `admin`, each with a unique `operation_id` (`support_list_card_events`, `support_list_event_leads`, `support_list_card_leads`) so the generated client has no clash; `DELETE /api/me` with `CurrentUser`, tag `account`. After any route change: `make openapi`, commit `frontend/api-client/openapi.json` and `schema.d.ts`; a generated type change that breaks the web build is fixed in the same task.
- After any query or migration change: `make sqlx-prepare`, commit `backend/.sqlx/`. Never edit an applied migration: this plan adds `0006_account_deletion.sql` only (Task 7).
- Tests: `// spec: XXX-NNN` before each Rust test; the ID in the name of each TypeScript test. Data with accents, typographic apostrophes and emojis ("Éloïse D’Aubigné-Müller", "Zoé Lefèvre ✨").
- Web unit tests: `pnpm -C frontend --filter web exec vitest run <path>`.
- E2E: `api.seedEvents()` freezes the clock at `EVENTS_NOW = 2027-03-15T10:00:00Z` before seeding; sign in only afterwards. Playwright runs in `Europe/Paris` / `fr-FR`. Downloads are read with `page.waitForEvent("download")`.
- Every task that touches the interface ends with `make e2e ARGS="-g <rules of the task>"`; Task 16 runs the full `make lint test` and `make e2e`.

## Review Focus

1. **Bob asks for Alice's leads or exports** (`GET /api/cards/{alice card}/leads`, both export routes with Alice's card or event, with every `format`) → `404 not_found`, no file, no `Content-Disposition`; an administrator calling the owner routes on Alice's data also gets 404 (ACC-017). Tests in Tasks 1 and 4.
2. **A prospect types `=HYPERLINK("https://evil.test/?"&A2;"Cliquez")` as first name and `-5 rue des Lilas` as street** → the CSV cells start with `'`; the XLSX cells are text, the workbook holds no formula; the phone `+33612345678` and a negative `number` answer stay unchanged. Tests in Tasks 3 and 4.
3. **Whole-card export where event A has "Entreprise" (text) and a field deleted since, and event B has "entreprise" (text), "Entreprise" (long text) and a field labelled "Email"** → columns "Entreprise" (A and B merged), "Entreprise (2)" (long text), the deleted field with its last label, "Email (2)"; no answer lost, no answer in the wrong column. Tests in Task 2.
4. **An administrator opens Alice's leads** → exactly one `leads.viewed` entry per list request, with `owner_id`, `card_id`, `lead_count` and nothing else; when the audit insert fails the response is 500 with no lead in it; `/api/admin/*` has no export, spam or delete route. Tests in Task 6.
5. **Alice claims `bob-martin` while Bob's account deletion is in flight** → after both, the slug is blocked and Alice got `409 slug_taken`, never the slug. Tests in Task 7.
6. **The media storage fails during Bob's deletion** → `500 internal_error`, Bob's account, cards, slugs, events and leads all still there; the retry succeeds and leaves no users row, no card, no slug row, no media file of his, only the hashes. Tests in Task 8.
7. **After Bob's deletion**, `/c/bob-martin`, a former slug of his, its vCard and its forms show the neutral page or `410`, never "Carte introuvable" and never someone else's card; nobody, Bob included after signing in again, can take the slug back. Tests in Tasks 7, 8 and 13.
8. **Summer time**: leads submitted at `2027-03-28T00:59:59Z` and `2027-03-28T01:00:00Z`, exported with `tz=Europe/Paris` → `2027-03-28 01:59:59` and `2027-03-28 03:00:00`; the header says "Date d'envoi (Europe/Paris)"; the JSON keeps the `Z` instants. Tests in Task 2.
9. **After the deletion dialog succeeds, the browser sends no authenticated request** (which would recreate an empty account, ACC-001): at the end of the e2e, the admin list has no account for `seed-bob`. Tests in Tasks 8 and 13.
10. **An administrator tries to delete their account** → `403 cannot_delete_admin` and nothing deleted; **a former administrator** (no longer in `ADMIN_USER_IDS`) with audit entries as actor deletes theirs → 204, the entries remain. Tests in Task 8.
11. **A lead deleted for a GDPR request** is absent from the list, the search, the CSV and the JSON. Tests in Tasks 4 and 10.

---

## File structure

```
backend/domain/src/
  text.rs                + fold (NFD, marks removed, lowercase, trim)
  access_code.rs         fold_access_code delegates to text::fold
  slug.rs                + slug_form ; decide_claim(existing, blocked, owner, card)
  user.rs                + check_account_deletion, AdminAccountDeletion
  export/mod.rs          ExportEvent, ExportLead, ExportScope, ExportRequest, ExportContext, ExportFormat, ExportFile, render
  export/table.rs        Column, StandardColumn, Cell, ExportTable, build_table, parse_zone
  export/labels.rs       French headers and values (documented exception)
  export/{csv.rs, xlsx.rs, json.rs, file_name.rs}
backend/server/
  migrations/0006_account_deletion.sql
  src/db/{admin_leads.rs, blocked_slugs.rs, account.rs}   + leads.rs (list_for_card, event_title, coalesce)
  src/routes/{lead_exports.rs, admin_leads.rs, account.rs} + leads.rs (list_card_leads)
  tests/{lead_exports.rs, admin_leads.rs, blocked_slugs.rs, account_deletion.rs}  + leads.rs
frontend/web/src/
  app/(app)/dashboard/cards/[id]/leads/page.tsx
  app/(app)/dashboard/account/page.tsx
  app/(app)/account-deleted/page.tsx
  app/(app)/support/cards/[id]/events/page.tsx
  app/(app)/support/cards/[id]/events/[eventId]/leads/page.tsx
  app/(app)/support/cards/[id]/leads/page.tsx
  components/events/     LeadList (reworked), LeadDetail, ExportDialog
  components/support/    SupportEventList
  components/account/    DeleteAccount
  lib/events/            lead-search.ts, lead-answers.ts, lead-export.ts  + leads.ts (leadHeading)
  lib/account/           deletion.ts
frontend/e2e/tests/      exports.spec.ts, support-leads.spec.ts, account-deletion.spec.ts  + leads.spec.ts, events.spec.ts
```

---

### Task 1: Whole-card lead list, event title on leads, spam date kept

**Files:**
- Modify: `backend/server/src/db/leads.rs`, `backend/server/src/routes/leads.rs`, `backend/server/src/views.rs`, `backend/server/src/app.rs`, `backend/server/src/openapi.rs`, `backend/server/tests/leads.rs`, `frontend/api-client/{openapi.json, src/schema.d.ts}` (generated), `frontend/web/src/lib/events/lead-view.fixture.ts`

**Rules:** LEA-001, LEA-013, LEA-014, ABU-003, ABU-009, ACC-017, LNK-008, EDI-020.

**Interfaces:**
- `db::leads::Lead` gains `pub event_title: String`; every select of a lead joins `events` and reads `e.title` (`list_for_event`, `set_spam`'s `returning`, the new `list_for_card`).
- `pub async fn list_for_card(pool: &PgPool, owner_id: Uuid, card_id: Uuid) -> Result<Option<Vec<Lead>>, sqlx::Error>`: `None` when the owner has no such card (same `exists` check as `events::list_for_card`); leads of every event of the card, `order by l.submitted_at desc, l.id desc`, owner in the `where` through `cards.owner_id`.
- `set_spam` keeps the first marking date: `set spam_at = case when $3::timestamptz is null then null else coalesce(l.spam_at, $3) end` (R-S22).
- `views::LeadView` gains `pub event_title: String` (the event's current title).
- `GET /api/cards/{id}/leads` → `LeadList` (`list_card_leads`, tag `leads`), 404 when the card is not the caller's; a disabled card's leads are listed (LNK-008).

- [ ] **Step 1: Write the failing tests** (`tests/leads.rs`)

```rust
// spec: LEA-001, LEA-013, LEA-014
#[sqlx::test] async fn whole_card_lists_every_event_newest_first(pool) {
    /* Alice's card with events A and B; leads at t (A), t+1 (A, then marked spam), t+2 (B) → GET /api/cards/{id}/leads:
       3 leads in the order t+2, t+1, t; event_title "A"/"B" on each; spam lead present with spam: true */ }
// spec: EDI-020, LEA-013
#[sqlx::test] async fn event_leads_carry_their_event_title(pool) { /* GET /api/events/{id}/leads → event_title on each lead */ }
// spec: ACC-017
#[sqlx::test] async fn whole_card_of_another_user_is_404(pool) { /* Bob → Alice's card 404; unknown card 404 */ }
// spec: LNK-008
#[sqlx::test] async fn whole_card_of_a_disabled_card_is_listed(pool) { /* owner-disabled → 200 */ }
// spec: ABU-003, ABU-009
#[sqlx::test] async fn re_marking_spam_keeps_the_first_date(pool) {
    /* mark at t1; clock.advance(1 h); mark again → spam_at in the table (read with sqlx) is still t1; unmark → null; mark → t1 + 1 h */ }
// spec: ABU-003
#[sqlx::test] async fn spam_body_and_lead_id_are_checked(pool) {
    /* PUT /api/leads/{id}/spam with {"spam":"yes"} → 400 invalid_request; with {} → 400 invalid_request;
       PUT /api/leads/not-a-uuid/spam → 400 invalid_request; DELETE /api/leads/not-a-uuid → 400 invalid_request */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test leads` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare`; `make openapi`; add `event_title` to `lead-view.fixture.ts` so `pnpm -C frontend -r typecheck` passes.
- [ ] **Step 4: Run and see them pass** — same command, then `make test-api` and `pnpm -C frontend -r typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend && git commit -m "feat(api): whole-card lead list, event title on leads, first spam date kept"`

---

### Task 2: Domain — export table (columns, rows, cells, time zone)

**Files:**
- Create: `backend/domain/src/export/{mod.rs, table.rs, labels.rs}`
- Modify: `backend/domain/Cargo.toml` (`chrono-tz = "0.10"`), `backend/domain/src/{lib.rs, text.rs, access_code.rs}`

**Rules:** LEA-010, LEA-011, LEA-012, LEA-023, LEA-024, LEA-025, LEA-026, LEA-031, FRM-022, FRM-023.

**Interfaces:**
- `text::fold(input: &str) -> String`: NFD, combining marks removed, lowercase, trimmed (the body of today's `fold_access_code`, which now calls it; its tests stay green).
- `export/mod.rs` (inputs, all owned plain data, no `sqlx`):
  - `pub struct ExportEvent { pub id: Uuid, pub title: String, pub starts_at: DateTime<Utc>, pub standard: StandardFields, pub custom: Vec<CustomField> }`
  - `pub struct ExportLead { pub id: Uuid, pub event_id: Uuid, pub submitted_at: DateTime<Utc>, pub standard: StandardAnswers, pub custom: Vec<AnswerSnapshot>, pub consent_at: DateTime<Utc>, pub consent_text: String, pub spam: bool }`
  - `pub enum ExportScope { Event, Card }` · `pub struct ExportRequest<'a> { pub scope: ExportScope, pub events: &'a [ExportEvent], pub leads: &'a [ExportLead], pub include_spam: bool, pub zone: chrono_tz::Tz }`
  - `pub fn exported_leads<'a>(req: &ExportRequest<'a>) -> Vec<&'a ExportLead>`: spam ones dropped unless `include_spam` (LEA-012), sorted by `submitted_at` then `id`, ascending (LEA-023).
- `export/table.rs`:
  - `pub enum StandardColumn { FirstName, LastName, BirthDate, Email, Phone, Street, PostalCode, City, Country }`
  - `pub enum Column { Standard(StandardColumn), Custom { kind: CustomFieldKind, fields: Vec<(Uuid /* event */, Uuid /* field */)> }, Event, SubmittedAt, ConsentAt, ConsentText, Spam }`
  - `pub enum Cell { Empty, Text(String), Phone(String), Date(NaiveDate), DateTime(NaiveDateTime), Number(serde_json::Number), Bool(bool) }` — `DateTime` is already converted to the zone; `Number` keeps the stored JSON number exactly.
  - `pub struct ExportTable { pub columns: Vec<Column>, pub headers: Vec<String>, pub rows: Vec<Vec<Cell>> }`
  - `pub fn build_table(req: &ExportRequest) -> ExportTable`
  - `pub fn parse_zone(input: Option<&str>) -> Tz`: a known IANA name, otherwise `Europe/Paris` (LEA-026).
- `export/labels.rs` (French, documented exception R-S5): the nine standard headers of LEA-023, `"Événement"`, `"Date d'envoi"`, `"Date du consentement"`, `"Texte du consentement"`, `"Spam"`, `YES = "Oui"`, `NO = "Non"`, `SHEET = "Contacts"`, `EVENT_SLUG_FALLBACK = "evenement"`, `fn time_header(base: &str, zone: Tz) -> String` (`"Date d'envoi (Europe/Paris)"`).

Implementation notes:
- Standard columns (LEA-023): for each of first name, last name, birth date, email, phone, address, the column(s) are present when `events.iter().any(|e| mode != Off)` or `exported.iter().any(|l| answered)`; the address group (street, postal code, city, country) is present when the address is asked or any of its four parts is answered.
- Custom columns (LEA-024): events sorted by `(starts_at, id)`; per event, its current `custom` fields in order (even when no lead answered them), then the deleted fields: walking the event's **exported** leads oldest first, each snapshot `field_id` that is not a current field and has a non-`null` value, in first-seen order (a deleted field that only spam leads answered appears only when spam is included). Header and kind: the current field's, or for a deleted field those of its most recent exported snapshot. In `ExportScope::Card`, a field joins the first existing custom column whose `fold(header) == fold(label)` and `kind` match and that holds no field of the same event; otherwise it opens a new column. Finally every header that equals an earlier header (exact string equality, standard and metadata headers included) gets `" (2)"`, `" (3)"`… in column order.
- Cells (LEA-025): a custom cell is the lead's snapshot whose `(event_id, field_id)` is in the column's `fields`, typed by the snapshot's own `kind`: `text`/`long_text`/`single_choice` → `Text`, `date` → `Date` (parse `YYYY-MM-DD`; unparsable → `Text`), `number` → `Number`, `checkbox` → `Bool`; `null` or no snapshot → `Empty`. Phone → `Phone(e164)`. Birth date → `Date`. Event → `Text(event title)`. Submitted/consent → `DateTime(instant.with_timezone(&zone).naive_local())`. Spam → `Bool`.
- No I/O, no `sqlx`, no `Utc::now()`.

- [ ] **Step 1: Write the failing tests** (inline in `table.rs`)

```rust
// spec: LEA-010, LEA-012, LEA-023
#[test] fn one_row_per_lead_oldest_first_spam_left_out() { /* 3 leads, one spam → 2 rows in submission order; include_spam → 3 rows, Spam cell Bool(true) */ }
// spec: LEA-023
#[test] fn standard_columns_are_the_asked_or_answered_ones() {
    /* event asks first name + email → Prénom, Email only; a lead answering phone while the event no longer asks it → Téléphone appears;
       address asked → Rue, Code postal, Ville, Pays together; nothing asked or answered → no standard column; order always FRM-017 */ }
// spec: LEA-011, LEA-024, FRM-023
#[test] fn deleted_fields_come_after_current_ones_with_their_last_label() {
    /* event fields [Formule]; leads hold snapshots of a deleted "Société" then (later lead) "Entreprise" for the same field id →
       columns Formule, Entreprise; the first lead's cell is filled, under the new header */ }
// spec: LEA-024, Review Focus 3
#[test] fn whole_card_merges_same_label_and_type_across_events_only() {
    /* A: "Entreprise" text + deleted field; B: "entreprise" text, "Entreprise" long_text, "Email" text →
       Entreprise (A+B), deleted field, Entreprise (2) long text, Email (2); a lead of B lands in the merged column;
       ExportScope::Event on B alone → no merge with A; two "Note" fields of the same event → Note, Note (2) */ }
// spec: LEA-025, FRM-022
#[test] fn cells_follow_the_type_recorded_with_the_answer() {
    /* a field changed from number to text: old lead Number(120), new lead Text("cent vingt"); null → Empty; field missing for an older lead → Empty;
       checkbox false → Bool(false); 12.5 stays Number "12.5" */ }
// spec: LEA-026, Review Focus 8
#[test] fn times_are_in_the_requested_zone() {
    /* 2027-03-28T00:59:59Z → 2027-03-28 01:59:59 and 01:00:00Z → 03:00:00 in Europe/Paris; America/New_York shifts accordingly;
       headers "Date d'envoi (Europe/Paris)", "Date du consentement (Europe/Paris)" */ }
// spec: LEA-026
#[test] fn unknown_zone_falls_back_to_paris() { /* parse_zone(Some("Mars/Olympus")), Some(""), None → Europe/Paris; Some("Asia/Tokyo") → Tokyo */ }
// spec: LEA-031
#[test] fn no_lead_still_gives_the_headers() { /* event asking email, no lead → headers Email + metadata, rows empty */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain export` · Expected: FAIL (compilation).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same command, then `cd backend && cargo test -p cartouche-domain` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(domain): export table with column planning, merge of custom fields and time zone"`

---

### Task 3: Domain — CSV, XLSX and JSON writers, file name

**Files:**
- Create: `backend/domain/src/export/{csv.rs, xlsx.rs, json.rs, file_name.rs}`
- Modify: `backend/domain/Cargo.toml` (`csv = "1"`, `rust_xlsxwriter`, dev-dependency `calamine`), `backend/domain/src/export/mod.rs`, `backend/domain/src/slug.rs`

**Rules:** LEA-007, LEA-008, LEA-009, LEA-022, LEA-027, LEA-028, LEA-029, LEA-030, LEA-031.

**Interfaces:**
- `#[derive(Deserialize)] #[serde(rename_all = "lowercase")] pub enum ExportFormat { Csv, Xlsx, Json }` (`ToSchema` under the `utoipa` feature) with `extension()` (`csv`/`xlsx`/`json`) and `content_type()` (`text/csv; charset=utf-8`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/json`).
- `pub struct ExportContext<'a> { pub card_id: Uuid, pub card_slug: &'a str, pub event: Option<&'a ExportEvent>, pub now: DateTime<Utc> }`
- `pub struct ExportFile { pub bytes: Vec<u8>, pub content_type: &'static str, pub file_name: String }` · `#[derive(Debug, thiserror::Error)] pub enum ExportError { #[error("xlsx: {0}")] Xlsx(String) }`
- `pub fn render(req: &ExportRequest, ctx: &ExportContext, format: ExportFormat) -> Result<ExportFile, ExportError>`
- `csv::write(table: &ExportTable) -> Vec<u8>`: BOM `EF BB BF`, `csv::WriterBuilder` with `Terminator::CRLF` and `QuoteStyle::Necessary`; `Date` → `%Y-%m-%d`, `DateTime` → `%Y-%m-%d %H:%M:%S`, `Number` → its JSON text, `Bool` → `Oui`/`Non`, `Phone` → as is; every `Text` cell **and every header** goes through `neutralize(text)`: prefix `'` when the first char is one of `= + - @ \t \r` (LEA-028); `Phone` and `Number` are never neutralized.
- `xlsx::write(table: &ExportTable) -> Result<Vec<u8>, ExportError>`: one worksheet `Contacts`; header row bold, `set_freeze_panes(1, 0)`; `Text` and `Phone` → `write_string` (never `write` with a string that could be read as a formula); `Date` → date cell `yyyy-mm-dd`; `DateTime` → date cell `yyyy-mm-dd hh:mm:ss`; `Number` → `write_number(as_f64)`; `Bool` → `write_boolean`; `Empty` → nothing; `save_to_buffer()`.
- `json::write(req, ctx) -> Vec<u8>`: the object of LEA-030, pretty-printed (2 spaces), UTF-8 without BOM; `exported_at` = `ctx.now`; instants `to_rfc3339_opts(SecondsFormat::Secs, true)` (`…Z`); `standard` always has the nine keys (`first_name`, `last_name`, `birth_date`, `email`, `phone`, `street`, `postal_code`, `city`, `country`); `custom` = the lead's snapshots as stored; `event` = `{id, title}` or `null` (card scope); leads oldest first, spam filtered like the table (`exported_leads`).
- `slug.rs`: `pub fn slug_form(text: &str, max_chars: usize) -> Option<String>`: the LNK-019 transformation of one string (accents removed, lowercase, other characters → hyphen, extra hyphens removed), cut to `max_chars` without a trailing hyphen; `None` when empty. `suggest_base` reuses it.
- `file_name::export_file_name(card_slug: &str, event_title: Option<&str>, today: NaiveDate, format: ExportFormat) -> String` (LEA-022): `contacts-{slug}-{slug_form(title, 40) or "evenement"}-{YYYY-MM-DD}.{ext}`, or `contacts-{slug}-{date}.{ext}`; `today = ctx.now.with_timezone(&req.zone).date_naive()`.

- [ ] **Step 1: Write the failing tests** (inline)

```rust
// spec: LEA-007, LEA-027
#[test] fn csv_is_rfc4180_with_bom() {
    /* bytes start with EF BB BF; lines end with \r\n; header row first; "Hébert, Fils" and a value with " and \n quoted per RFC 4180;
       2027-09-18 date, "2027-03-15 09:30:00", 12.5 → "12.5", true → "Oui", false → "Non", phone "+33612345678" unchanged;
       "Éloïse D’Aubigné-Müller" and "Zoé Lefèvre ✨" byte-exact */ }
// spec: LEA-028, Review Focus 2
#[test] fn csv_neutralizes_formulas_but_not_phone_or_numbers() {
    /* =HYPERLINK(...) → '=HYPERLINK(...); "-5 rue des Lilas" → "'-5 rue des Lilas"; "@x", "+x", "\tx", "\rx" prefixed;
       Phone("+33612345678") and Number(-3) unchanged; a custom header "=cmd" → "'=cmd" */ }
// spec: LEA-008, LEA-029
#[test] fn xlsx_has_typed_cells_and_no_formula() {
    /* read back with calamine: one sheet "Contacts"; header row = table headers; a Date cell is a date, a DateTime a date-time,
       a Number a float, a Bool a bool, "=1+1" a string; worksheet_formula("Contacts") holds no formula */ }
// spec: LEA-009, LEA-030
#[test] fn json_keeps_types_and_utc_instants() {
    /* parse: exported_at, card {id, slug}, event {id, title} (event scope) / null (card scope), include_spam;
       lead.submitted_at ends with "Z"; standard has the nine keys, null when unanswered, birth_date "1990-05-02";
       custom value 120 is a number, true a boolean, null stays null */ }
// spec: LEA-031
#[test] fn empty_exports_are_valid_files() { /* csv = BOM + header line; xlsx readable with the header row only; json leads: [] */ }
// spec: LEA-022
#[test] fn file_names() {
    /* ("alice-durand", Some("Salon du Mariage Clermont 2027"), 2027-03-15, Csv) → "contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.csv";
       card scope Xlsx → "contacts-alice-durand-2027-03-15.xlsx"; title "!!!" → "-evenement-"; a 60-character title is cut to 40 with no trailing hyphen */ }
// spec: LNK-019
#[test] fn slug_form_matches_the_suggestion() { /* slug_form("Éloïse D'Aubigné-Müller", 64) == suggest_base("Éloïse", "D'Aubigné-Müller") */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain export slug` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same command, then `cd backend && cargo test -p cartouche-domain && cargo clippy -p cartouche-domain --all-features -- -D warnings` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(domain): CSV, XLSX and JSON lead exports with file names"`

---

### Task 4: Export routes

**Files:**
- Create: `backend/server/src/routes/lead_exports.rs`, `backend/server/tests/lead_exports.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, routes/mod.rs, views.rs}`, `frontend/api-client/*` (generated)

**Rules:** LEA-005, LEA-006, LEA-012, LEA-021, LEA-026, LEA-032, LNK-008, ACC-017, FRM-023.

**Interfaces:**
- `#[derive(Deserialize, IntoParams)] pub struct ExportQuery { pub format: ExportFormat, #[serde(default)] pub include_spam: bool, pub tz: Option<String> }` read with `ApiQuery` (missing or unknown `format`, non-boolean `include_spam` → `400 invalid_request`).
- `GET /api/events/{id}/leads/export` (`export_event_leads`) and `GET /api/cards/{id}/leads/export` (`export_card_leads`), tag `leads`, `ApprovedUser`.
- Handler steps: load the card with `cards::find_for_owner` (its current slug) — for the event route, `events::find_for_owner` first, then its card; 404 when absent; load the scope's events (`events::list_for_card`, or the single event) and leads (`leads::list_for_event` / `leads::list_for_card`); map to `ExportEvent` / `ExportLead` (a `From` in `views.rs` or next to the route, no logic); `render(…)` with `zone = parse_zone(query.tz.as_deref())` and `now = state.clock.now()`; `ExportError` → `ApiError::Internal`.
- Response: `200`, body = bytes, headers `Content-Type` (`ExportFile::content_type`), `Content-Disposition: attachment; filename="<file_name>"`, `Cache-Control: no-store`. OpenAPI: one 200 response per content type (`content((Vec<u8> = "text/csv"), (Vec<u8> = "application/vnd…sheet"), (Vec<u8> = "application/json"))` or the closest utoipa 5 form), plus 400, 401, 403, 404, 500, 503 like the other lead routes.
- Nothing about the leads is logged (Global Constraints).

- [ ] **Step 1: Write the failing tests** (`tests/lead_exports.rs`, helpers from `tests/common/events.rs`)

```rust
// spec: LEA-006, LEA-021, LEA-032
#[sqlx::test] async fn event_csv_download(pool) {
    /* event with 2 leads + 1 spam → 200; content-type "text/csv; charset=utf-8"; content-disposition
       `attachment; filename="contacts-alice-durand-<title slug>-<date>.csv"`; cache-control "no-store"; BOM; 1 header + 2 rows */ }
// spec: LEA-012
#[sqlx::test] async fn spam_is_included_only_on_request(pool) { /* include_spam=true → 3 rows, last column "Oui" for the spam lead */ }
// spec: LEA-006, LEA-013, LEA-030
#[sqlx::test] async fn card_exports_in_xlsx_and_json(pool) {
    /* two events → xlsx content type + body starts with "PK"; json: event null, 2 leads from both events, card.slug */ }
// spec: ACC-017, Review Focus 1
#[sqlx::test] async fn exports_of_another_user_are_404(pool) {
    /* Bob on Alice's event and card, for csv, xlsx, json → 404 not_found, no content-disposition header; admin token on owner routes → 404 */ }
// spec: LNK-008
#[sqlx::test] async fn disabled_card_stays_exportable(pool) { /* owner-disabled and support-disabled → 200 */ }
// spec: LEA-005, Review Focus 11
#[sqlx::test] async fn deleted_lead_is_not_exported(pool) { /* DELETE /api/leads/{id} → csv and json no longer contain its email */ }
// spec: LEA-026
#[sqlx::test] async fn time_zone_parameter(pool) {
    /* tz=America/New_York → header "Date d'envoi (America/New_York)" and shifted time; tz=Nowhere/Land → "(Europe/Paris)";
       file-name date taken in the zone (clock at 2027-03-15T23:30:00Z: Paris → 2027-03-16, New York → 2027-03-15) */ }
// spec: LEA-006
#[sqlx::test] async fn format_is_required_and_checked(pool) { /* no format, format=pdf, include_spam=maybe → 400 invalid_request */ }
// spec: FRM-023, LEA-024
#[sqlx::test] async fn a_deleted_field_keeps_its_column(pool) { /* lead answers "Formule"; owner removes the field (PUT event) → csv still has "Formule" with the answer */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test lead_exports` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make openapi` (check `openapi.json` lists the two routes with their three content types); `make sqlx-prepare` if a query changed.
- [ ] **Step 4: Run and see them pass** — same command, then `make test-api` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend/api-client && git commit -m "feat(api): CSV, XLSX and JSON exports of an event's or a card's leads"`

---

### Task 5: Seed and e2e harness for leads

**Files:**
- Modify: `backend/server/src/test_support/seed.rs`, `backend/server/tests/test_support.rs`, `frontend/e2e/fixtures.ts`

**Rules:** FRM-023, FRM-008 (seed only; the behaviours are tested in Tasks 10 and 11).

**Interfaces:**
- `SeedLead` gains `deleted: &'static [SeedDeletedAnswer]` with `struct SeedDeletedAnswer { field_id: Uuid, label: &'static str, kind: CustomFieldKind, answer: SeedAnswer }`, appended after the snapshots of the current fields. Only Jean-Michel's lead ("Salon de Paris 2026") has one: field id `0198c8a1-0000-7000-8000-000000000005`, label "Entreprise", kind `text`, answer "Hébert & Fils" (R-S24). No lead, event or count changes.
- `seed_lead` builds the default consent text with `normalize(event.title)` (plan 3 Task 11 minor).
- `fixtures.ts`: `LeadView.event_title: string`; `api.cardLeads(subject, cardId): Promise<LeadView[]>` (`GET /api/cards/{id}/leads`); `export async function downloadedText(download: Download): Promise<string>` and `downloadedBytes(download): Promise<Buffer>` (read `await download.path()`).

- [ ] **Step 1: Write the failing tests** (inline in `seed.rs` and in `tests/test_support.rs`)

```rust
// spec: FRM-023
#[test] fn seeded_deleted_answers_are_not_fields_of_their_event() { /* every SeedDeletedAnswer.field_id is absent from its event's custom fields */ }
// spec: FRM-022, FRM-038
#[test] fn seeded_leads_answer_every_custom_field() { /* unchanged meaning: lead.custom.len() == event.custom.len() (deleted answers are separate) */ }
// spec: FRM-008
#[sqlx::test] async fn seeded_consent_texts_are_the_ones_a_submission_records(pool) {
    /* after base, cards, events: each seeded lead's consent_text == consent_text(event.consent_text normalized, card content, normalized title);
       extract the consent computation of seed_lead into a small fn and unit-test its custom-text branch with "Portes ouvertes de l'Atelier"'s text */ }
// spec: FRM-023
#[sqlx::test] async fn jean_michel_keeps_his_deleted_answer(pool) { /* GET /api/events/{paris}/leads as seed-alice → custom has "Entreprise" = "Hébert & Fils" */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features seed test_support` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare` if a query changed; `pnpm -C frontend -r typecheck`.
- [ ] **Step 4: Run and see them pass** — same commands, then `make e2e ARGS="-g 'EDI-020|ABU-00'"` (plan 3's lead tests still pass) · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend/e2e && git commit -m "test: seed a deleted-field answer and e2e helpers for leads and downloads"`

---

### Task 6: Support API — events and leads read-only, audited

**Files:**
- Create: `backend/server/src/db/admin_leads.rs`, `backend/server/src/routes/admin_leads.rs`, `backend/server/tests/admin_leads.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, db/mod.rs, routes/mod.rs, db/events.rs (make the row type and its mapping `pub(super)`), db/leads.rs (same)}`, `frontend/api-client/*` (generated)

**Rules:** ADM-001, ADM-007, ADM-008, ADM-012, ADM-016, ADM-018, ADM-019, ADM-020, ACC-017, LNK-008.

**Interfaces:**
- `db/admin_leads.rs` (header: documented exception, support reads only, called only from `/api/admin/*`):
  - `list_events_of_card(conn, card_id) -> Result<Option<Vec<EventWithCount>>, sqlx::Error>` (`None`: no such card), by start like the owner list;
  - `list_for_event(conn, event_id) -> Result<Option<LeadScope>, sqlx::Error>` and `list_for_card(conn, card_id) -> Result<Option<LeadScope>, sqlx::Error>`, with `pub struct LeadScope { pub card_id: Uuid, pub owner_id: Uuid, pub leads: Vec<Lead> }`, newest first, spam included.
- `routes/admin_leads.rs`:
  - `GET /api/admin/cards/{id}/events` → `AdminEventList { events: Vec<EventView> }` (`support_list_card_events`); not audited (ADM-016); `EventView::new` with the card's content from `admin_cards::find` (R-S25).
  - `GET /api/admin/events/{id}/leads` (`support_list_event_leads`) and `GET /api/admin/cards/{id}/leads` (`support_list_card_leads`) → `LeadList`. Steps: `begin`; read the scope (404 if `None`); `audit::record(&mut tx, AuditEntry { actor_user_id: admin.0.user.id, action: "leads.viewed", target_type: "event" | "card", target_id, metadata: json!({ "owner_id": scope.owner_id, "card_id": scope.card_id, "lead_count": scope.leads.len() }) })`; `commit`; only then build the response (ADM-019: fail-closed).
  - No other admin lead route (ADM-018).

- [ ] **Step 1: Write the failing tests** (`tests/admin_leads.rs`)

```rust
// spec: ADM-007, ADM-016
#[sqlx::test] async fn support_lists_a_cards_events(pool) { /* seed-admin → Alice's card events with lead_count; unknown card → 404; no audit row written */ }
// spec: ADM-007, ADM-008, ADM-019, Review Focus 4
#[sqlx::test] async fn viewing_an_events_leads_is_audited(pool) {
    /* response leads == owner's GET /api/events/{id}/leads (ids, order, spam flag); exactly one audit_log row: actor admin, action "leads.viewed",
       target_type "event", target_id event, metadata {owner_id, card_id, lead_count: 3}; a second request → a second row */ }
// spec: ADM-019
#[sqlx::test] async fn viewing_a_whole_card_is_audited_on_the_card(pool) { /* target_type "card", lead_count = leads of all its events */ }
// spec: ADM-019
#[sqlx::test] async fn own_leads_are_audited_too(pool) { /* the admin owns a card with a lead → still one row */ }
// spec: ADM-019, Review Focus 4
#[sqlx::test] async fn no_leads_without_an_audit_entry(pool) {
    /* `alter table audit_log add constraint audit_blocked check (action <> 'leads.viewed')` → 500 internal_error, body has no "leads" key and no email */ }
// spec: ADM-020
#[sqlx::test] async fn audit_metadata_holds_no_prospect_data(pool) { /* metadata keys exactly owner_id, card_id, lead_count */ }
// spec: ADM-001
#[sqlx::test] async fn non_admins_are_refused(pool) { /* seed-alice on the three routes → 403 forbidden */ }
// spec: ADM-012, ADM-018
#[sqlx::test] async fn support_cannot_change_or_export_leads(pool) {
    /* PUT /api/admin/leads/{id}/spam, DELETE /api/admin/leads/{id}, GET /api/admin/events/{id}/leads/export, GET /api/admin/cards/{id}/leads/export → 404 not_found;
       the admin on the owner routes PUT /api/leads/{alice lead}/spam and DELETE → 404 (ACC-017); the lead is unchanged */ }
// spec: LNK-008
#[sqlx::test] async fn support_disabled_card_leads_are_visible_to_support(pool) { /* 200 */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test admin_leads` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare`; `make openapi`.
- [ ] **Step 4: Run and see them pass** — same command, then `make test-api` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend/api-client && git commit -m "feat(api): read-only support views of events and leads, audited"`

---

### Task 7: Blocked slugs

**Files:**
- Create: `backend/server/migrations/0006_account_deletion.sql`, `backend/server/src/db/blocked_slugs.rs`, `backend/server/tests/blocked_slugs.rs`
- Modify: `backend/domain/src/slug.rs`, `backend/server/src/{db/mod.rs, db/public_cards.rs, routes/cards.rs, routes/slugs.rs, test_support/seed.rs (RESET_TABLES)}`, `backend/server/tests/migrations.rs` (if it lists tables or foreign keys)

**Rules:** LNK-015, LNK-031, LNK-032, LNK-033, LNK-022, LNK-023, ACC-024 (schema part).

**Interfaces:**
- Migration:

```sql
-- Slugs of deleted accounts, kept only as a hash, with no link to a person (LNK-015, LNK-031).
create table blocked_slugs (
    slug_hash bytea primary key check (octet_length(slug_hash) = 32)
);

-- Audit entries outlive the accounts they name (ACC-024): the actor stays as a bare identifier.
alter table audit_log drop constraint audit_log_actor_user_id_fkey;
```

  (Check the constraint name with `\d audit_log` on the dev database first; it is PostgreSQL's default `<table>_<column>_fkey`.)
- `db/blocked_slugs.rs` (header: global table, no owner by design, like `slugs.rs`):
  - `pub async fn block_all_of_owner(tx: &mut PgConnection, owner_id: Uuid) -> Result<u64, sqlx::Error>`: `insert into blocked_slugs (slug_hash) select sha256(convert_to(slug, 'UTF8')) from card_slugs where owner_id = $1 on conflict do nothing`;
  - `pub async fn is_blocked(conn: impl PgExecutor, slug: &str) -> Result<bool, sqlx::Error>`: `select exists (select 1 from blocked_slugs where slug_hash = sha256(convert_to($1, 'UTF8')))`.
- Domain: `decide_claim(existing: Option<&SlugRecord>, blocked: bool, owner_id: Uuid, card_id: Option<Uuid>)`: `blocked` → `Err(SlugClaimError::Taken)`; otherwise unchanged. All callers updated.
- `routes/cards.rs::claim_slug`: **first** `slugs::find_for_update` (waits for a concurrent deletion holding the row), **then** `blocked_slugs::is_blocked(&mut *tx, …)` in a new statement (sees the committed hashes), then `decide_claim` (LNK-032; comment the order). `routes/slugs.rs`: suggestion and availability pass `is_blocked` too (blocked → `taken`, skipped by the suggestion).
- `db/public_cards::resolve`: when no `card_slugs` row exists, `is_blocked(slug)` → `Some(Resolution::Deleted)` (public card `{"state":"inactive"}` → neutral page; vCard and event routes `410 card_inactive`), else `None` (404, LNK-023).
- `RESET_TABLES` gains `blocked_slugs`.

- [ ] **Step 1: Write the failing tests**

```rust
// spec: LNK-032 (slug.rs, inline)
#[test] fn a_blocked_slug_is_taken_for_everyone() { /* decide_claim(None, true, any owner, None / Some(card)) → Err(Taken); (None, false, …) → Ok(New) */ }
// spec: LNK-031 (tests/blocked_slugs.rs)
#[sqlx::test] async fn blocked_slugs_hold_only_the_sha256(pool) {
    /* block_all_of_owner for a user with slugs "alice-durand" (current), "alice" (former), "alice-ancien" (reserved) → 3 rows;
       each equals aws_lc_rs::digest::digest(&SHA256, slug.as_bytes()); the table has one column (information_schema) */ }
// spec: LNK-032
#[sqlx::test] async fn a_blocked_slug_cannot_be_claimed(pool) {
    /* insert the hash of "bob-martin" (no card_slugs row) → POST /api/cards slug bob-martin → 409 slug_taken; PUT a card's slug → 409;
       availability → "taken"; suggestion for Bob Martin → "bob-martin-2" */ }
// spec: LNK-032, Review Focus 5
#[sqlx::test] async fn a_claim_racing_a_deletion_never_gets_the_slug(pool) {
    /* tx A: lock Bob's user row, block_all_of_owner(bob), delete from users where id = bob (not committed);
       spawn Alice's POST /api/cards with slug "bob-martin" → still pending after 200 ms; commit A → Alice gets 409 slug_taken */ }
// spec: LNK-033, LNK-023
#[sqlx::test] async fn a_blocked_slug_shows_like_a_deleted_card(pool) {
    /* hash of "ancien-lien" only → GET /api/public/cards/ancien-lien → 200 {"state":"inactive"} (as for a deleted card); its vcard → 410 card_inactive;
       public event route → 410 card_inactive; a never-assigned slug → 404 not_found */ }
// spec: ACC-024
#[sqlx::test] async fn audit_actor_is_no_longer_a_foreign_key(pool) { /* insert an audit row with a random actor_user_id → ok */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test --workspace --all-features blocked decide_claim` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare`.
- [ ] **Step 4: Run and see them pass** — same command, then `make test-api` · Expected: PASS (the existing LNK-013, LNK-014, LNK-022, LNK-025 tests unchanged).
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(api): blocked slug hashes refused on claims and shown as deleted cards"`

---

### Task 8: Account deletion API

**Files:**
- Create: `backend/server/src/db/account.rs`, `backend/server/src/routes/account.rs`, `backend/server/tests/account_deletion.rs`, `backend/server/tests/common/failing_store.rs` (an `ObjectStore` that delegates to `InMemory` but fails `delete`/`delete_stream`)
- Modify: `backend/domain/src/user.rs`, `backend/server/src/{error.rs, app.rs, openapi.rs, db/mod.rs, routes/mod.rs, media/service.rs}`, `frontend/api-client/*` (generated)

**Rules:** ACC-018, ACC-021, ACC-022, ACC-023, ACC-024, ACC-001, ACC-004, LNK-015, LNK-016, LNK-033, MED-019.

**Interfaces:**
- Domain: `pub struct AdminAccountDeletion;` · `pub fn check_account_deletion(is_admin: bool) -> Result<(), AdminAccountDeletion>` (ACC-021).
- `ApiError::CannotDeleteAdmin` → `403 cannot_delete_admin`.
- `MediaService::with_store(store: Arc<dyn ObjectStore>, public_base: Url, serves_locally: bool) -> MediaService` under `#[cfg(any(test, feature = "test-support"))]`, for the failing store.
- `db/account.rs` (header: works on the caller's own user ID):
  - `card_ids(tx, user_id) -> Result<Vec<Uuid>, sqlx::Error>` (every card of the user, whatever its state);
  - `strip_slugs_from_audit(tx, user_id) -> Result<u64, sqlx::Error>`: `update audit_log set metadata = metadata - 'slug' where metadata->>'owner_id' = $1::text`;
  - `delete_user(tx, user_id) -> Result<bool, sqlx::Error>` (cascades: cards, card_slugs, media rows, events, leads).
- `DELETE /api/me` (`delete_me`, tag `account`, `CurrentUser`, any status): `check_account_deletion(current.is_admin)` → `CannotDeleteAdmin`; `begin`; `users::find_for_update` (`None` → 404); `card_ids`; `blocked_slugs::block_all_of_owner`; `strip_slugs_from_audit`; `delete_user`; then for each card `state.media.delete_card(id).await` — an error → `ApiError::Internal` and the transaction is dropped (rolled back); `commit`; `204` (ACC-022, R-S15). Log only the user ID and the number of cards.

- [ ] **Step 1: Write the failing tests** (`tests/account_deletion.rs`; domain test inline)

```rust
// spec: ACC-021 (user.rs)
#[test] fn administrators_cannot_delete_their_account() { /* true → Err; false → Ok */ }
// spec: ACC-018, ACC-022, LNK-015, LNK-016, MED-019
#[sqlx::test] async fn deleting_an_account_deletes_everything(pool) {
    /* Bob: card A with an uploaded avatar and a former slug, card B deleted earlier (reserved slug), an event with 2 leads → DELETE /api/me 204;
       no row of Bob in users, cards, card_slugs, media, events, leads; media.list_keys() has no key under his cards;
       blocked_slugs holds exactly the hashes of his 3 slugs; Alice's card, events, leads and files untouched */ }
// spec: ACC-021, ACC-004
#[sqlx::test] async fn every_status_can_delete_itself(pool) { /* pending, rejected, suspended users → 204 each */ }
// spec: ACC-021, Review Focus 10
#[sqlx::test] async fn a_current_admin_is_refused(pool) { /* seed-admin → 403 cannot_delete_admin; nothing deleted */ }
// spec: ACC-022, Review Focus 6
#[sqlx::test] async fn a_storage_failure_deletes_nothing(pool) {
    /* app with the failing store, Bob with media → 500 internal_error; users, cards, card_slugs, events, leads, media rows all still there,
       blocked_slugs empty; same app with a working store → 204 and everything gone */ }
// spec: ACC-024
#[sqlx::test] async fn audit_entries_survive_without_slugs(pool) {
    /* admin support-disables Bob's card and suspends then reactivates Bob → Bob deletes → the three rows remain;
       card.support_disabled metadata has owner_id and no slug; user.status_changed rows unchanged */ }
// spec: ACC-024, Review Focus 10
#[sqlx::test] async fn a_former_admin_with_audit_entries_can_delete(pool) {
    /* audit rows with actor = Carol; config without Carol in ADMIN_USER_IDS → 204; rows remain with actor_user_id = Carol's former id */ }
// spec: ACC-023, ACC-001
#[sqlx::test] async fn signing_in_again_creates_a_new_empty_account(pool) {
    /* after Bob's 204, GET /api/me with a token for the same sub → new id, status pending (approval mode), GET /api/cards → [] once approved */ }
// spec: LNK-033
#[sqlx::test] async fn the_deleted_accounts_links_are_neutral(pool) { /* GET /api/public/cards/bob-martin and his former slug → {"state":"inactive"}; their vcard → 410 card_inactive */ }
// spec: ACC-022
#[sqlx::test] async fn two_simultaneous_deletions_leave_no_account(pool) { /* join_all of two DELETE /api/me → both 204 (or 204 and 404), no users row for the sub at the end */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test --workspace --all-features --test account_deletion` and `cargo test -p cartouche-domain account_deletion` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare`; `make openapi`.
- [ ] **Step 4: Run and see them pass** — same commands, then `make test-api` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend/api-client && git commit -m "feat(api): delete one's account with all its data, files included"`

---

### Task 9: Web logic — search, answers, lead heading, export download

**Files:**
- Create: `frontend/web/src/lib/events/{lead-search.ts, lead-search.test.ts, lead-answers.ts, lead-answers.test.ts, lead-export.ts, lead-export.test.ts}`
- Modify: `frontend/web/src/lib/events/{leads.ts, leads.test.ts, lead-view.fixture.ts}`, `frontend/web/src/lib/api.ts` (+ `api.test.tsx`)

**Rules:** LEA-002, LEA-015, LEA-016, LEA-017, LEA-019, LEA-021, LEA-022, LEA-026.

**Interfaces:**
- `lead-search.ts`: `fold(text: string): string` (NFD, `\p{M}` removed, lowercase, trimmed) · `leadMatches(lead: LeadView, query: string): boolean` · `filterLeads(leads: LeadView[], query: string): LeadView[]` — words split on whitespace, every word must match a field of LEA-015 (`fold(word)` contained in `fold(value)`); a word matching `/^[0-9+.\-()]+$/` with a digit also matches when its digits without leading zeros are contained in `lead.answers.phone`'s digits (LEA-016); custom answers searched only for kinds `text`, `long_text`, `single_choice`.
- `leads.ts`: `leadHeading(lead): { kind: "name"; text: string } | { kind: "email"; text: string } | { kind: "unnamed" }` replaces `leadDisplayName` (LEA-017); the row shows the email line only for `kind === "name"`.
- `lead-answers.ts`: `type AnswerDisplay = { kind: "text"; text: string } | { kind: "yes" } | { kind: "no" } | { kind: "empty" }` · `displayAnswer(snapshot: AnswerSnapshot): AnswerDisplay` (date `YYYY-MM-DD` → `18/09/2027` with `Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" })`, number → `Intl.NumberFormat("fr-FR")` so `12.5` → `12,5`, checkbox → yes/no, `null` → empty) · `displayBirthDate(iso: string): string` (LEA-019). The component maps yes/no/empty to `fr.json` keys.
- `lead-export.ts`: `type ExportFormat = "csv" | "xlsx" | "json"` · `type ExportScope = { kind: "event"; id: string } | { kind: "card"; id: string }` · `exportPath(scope, format, includeSpam: boolean, zone: string): string` (`/api/events/{id}/leads/export?format=…&include_spam=…&tz=…`, values URL-encoded) · `fileNameFromDisposition(header: string | null): string | null` · `downloadExport(getToken, path): Promise<string>` (fetch with `authorization: Bearer`, `toApiError` when not ok, `blob()`, `URL.createObjectURL`, a temporary `<a download=name>` clicked then removed, `revokeObjectURL`; returns the file name).
- `api.ts`: `useDownloadExport(): (path: string) => Promise<string>` reporting failures to Sentry like `useUploadMedia`.

- [ ] **Step 1: Write the failing tests**

```ts
test("LEA-015 search ignores case and accents, every word must match", …);          // "eloise aubigne" finds Éloïse; "eloise zoe" finds nobody
test("LEA-015 search covers email, city and text custom answers but not dates or numbers", …);
test("LEA-016 a phone-like word matches the phone digits without leading zeros", …); // "0612", "06.12", "+33 6" → Éloïse; "0699" → none
test("LEA-015 an empty search keeps the whole list in order", …);
test("LEA-017 heading is the name, else the email, else unnamed", …);
test("LEA-019 answers read Oui/Non, French dates and numbers, empty", …);
test("LEA-021 LEA-026 export path carries format, spam option and zone", …);
test("LEA-022 file name read from Content-Disposition", …);                         // quoted and unquoted, absent → null
test("LEA-021 a refused download throws the ApiError", …);                           // 404 JSON body → ApiError code not_found
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/events src/lib/api` · Expected: FAIL.
- [ ] **Step 3: Implement** (update the callers of `leadDisplayName`).
- [ ] **Step 4: Run and see them pass** — same command, then `pnpm -C frontend -r typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): lead search, answer display and authenticated export download"`

---

### Task 10: Lead list with search, detail view and in-place updates

**Files:**
- Create: `frontend/web/src/components/events/{LeadDetail.tsx, LeadDetail.test.tsx}`
- Modify: `frontend/web/src/components/events/{LeadList.tsx, LeadList.test.tsx}`, `frontend/web/src/app/(app)/dashboard/cards/[id]/events/[eventId]/leads/{page.tsx, page.test.tsx}`, `frontend/web/messages/fr.json` (`leads.*`), `frontend/e2e/tests/leads.spec.ts`

**Rules:** LEA-002, LEA-003, LEA-004, LEA-005, LEA-014, LEA-015, LEA-016, LEA-017, LEA-018, LEA-019, LEA-020, EDI-020, ABU-003, ABU-004, ABU-009, ABU-010, FRM-023.

**Interfaces:**
- `type LeadActions = { setSpam(lead: LeadView, spam: boolean): Promise<LeadView>; remove(lead: LeadView): Promise<void> }`.
- `LeadList({ load, actions, showEvent, toolbar }: { load: () => Promise<LeadView[]>; actions: LeadActions | null; showEvent: boolean; toolbar?: ReactNode })`: loads once (named async function inside the effect, with a cancel flag — no uncommented void-async wrapper); search input (`leads-search`, label "Rechercher un contact") filtering with `filterLeads`; count of shown leads; `leads-no-match` message (LEA-015); each row (`lead-row-<id>`) shows `leadHeading`, the event title when `showEvent` (`lead-event-<id>`), date, email (only under a name heading), phone, spam badge, a "Voir" button (`lead-open-<id>`) and, when `actions`, the spam and delete buttons (existing test IDs kept). After a successful `setSpam` the row is replaced by the returned lead; after a successful `remove` the row is dropped; no reload follows (LEA-020, R-S21). Errors show `ErrorNotice` and leave the list as it was.
- `LeadDetail({ lead, zone, actions, onChange, onClose })`: dialog `lead-detail` with event title, submission date (`formatEventDate`), the answered standard fields (`displayBirthDate`, `phone_display`, address lines), every custom snapshot (`lead-detail-answer-<field_id>`, label as recorded, `displayAnswer`), consent date and text (`lead-detail-consent`), spam state; spam and delete buttons when `actions` (delete asks the existing confirmation, then closes the detail, LEA-020).
- The event leads page passes `load` = `GET /api/events/{id}/leads`, `actions` built with `api.PUT`/`api.DELETE` (returning the `LeadView` / nothing), `showEvent = false`.
- `fr.json` `leads`: `search`, `searchPlaceholder`, `count` (ICU plural), `noMatch` ("Aucun contact ne correspond à ta recherche."), `open` ("Voir"), `detail.*` (`title`, `event`, `submittedAt`, `consentAt`, `consentText`, `spam`, `notSpam`, `yes` "Oui", `no` "Non", `empty` "Non renseigné", `close`, the nine standard field labels, `address`).

- [ ] **Step 1: Write the failing unit tests**

```ts
test("LEA-015 typing in the search filters the rows and says when nothing matches", …);
test("LEA-017 a nameless lead shows its email once", …);
test("LEA-020 a spam toggle updates the row from the response without reloading", …);   // GET called once
test("LEA-020 a deleted row disappears even if nothing is reloaded", …);
test("LEA-003 LEA-018 the detail shows every answer, deleted fields and the consent text", …);
test("LEA-019 the detail reads Oui, Non, Non renseigné and French dates", …);
test("LEA-004 LEA-020 deleting from the detail asks, then closes it", …);
test("ADM-017 without actions there is no spam or delete button", …);
```

- [ ] **Step 2: Write the failing e2e tests** (`leads.spec.ts`, after `api.seedEvents()` and `loginAs("seed-alice")`; plan 3's three tests stay)

```ts
test("LEA-002 LEA-015 search by an accent-free name", …);          // Mariage: "eloise" → 1 row Éloïse; "zzz" → "Aucun contact ne correspond à ta recherche."; cleared → 3 rows
test("LEA-016 search by phone digits", …);                         // "0612" → Éloïse only
test("LEA-003 LEA-018 LEA-019 lead detail", …);                    // Éloïse: Date du mariage 18/09/2027, Nombre d'invités 120, Formule Prestige, Recevoir la brochure Oui, consent text; Zoé: Date du mariage "Non renseigné"
test("FRM-023 LEA-018 a deleted field stays in the detail", …);    // Salon de Paris 2026 → Jean-Michel → Entreprise "Hébert & Fils"
test("LEA-004 LEA-020 spam and delete from the detail view", …);   // Zoé: Marquer comme spam in the detail → badge in the list; Bot: delete from the detail → row gone, detail closed
test("LEA-005 a deleted lead is gone after reload and from the search", …);
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/events/Lead "src/app/(app)/dashboard/cards/[id]/events/[eventId]/leads"` then `make e2e ARGS="-g 'LEA-00|LEA-01|LEA-02|EDI-020|ABU-00|FRM-023'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): lead search, detail view and in-place updates"`

---

### Task 11: Whole-card view and exports in the dashboard

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/cards/[id]/leads/{page.tsx, page.test.tsx}`, `frontend/web/src/components/events/{ExportDialog.tsx, ExportDialog.test.tsx}`, `frontend/e2e/tests/exports.spec.ts`
- Modify: `frontend/web/src/app/(app)/dashboard/cards/[id]/events/[eventId]/leads/page.tsx`, `frontend/web/src/app/(app)/dashboard/cards/[id]/events/page.tsx` or `components/events/EventList.tsx` (link), `frontend/web/messages/fr.json`, `frontend/e2e/tests/leads.spec.ts`

**Rules:** LEA-001, LEA-006, LEA-007, LEA-008, LEA-009, LEA-011, LEA-012, LEA-013, LEA-021, LEA-022, LEA-023, LEA-024, LEA-031, EDI-010, LNK-008.

**Interfaces:**
- Card events page: a "Tous les contacts de la carte" link (`card-leads-link`) to `/dashboard/cards/{id}/leads` (LEA-013, EDI-010).
- Whole-card page (`AccountGate` → `CardScope`): header "Contacts — toute la carte" with the card name and a back link to the events; `LeadList` with `load` = `GET /api/cards/{id}/leads`, owner `actions`, `showEvent = true`, `toolbar` = the export button.
- `ExportDialog({ scope })`: button "Exporter" (`export-open`); dialog with the format radio (`export-format-csv|xlsx|json`, labels "CSV (Notion, tableurs)", "Excel (XLSX)", "JSON"), a hint that Excel users should pick XLSX (R-S7), the checkbox "Inclure les contacts marqués spam" (`export-include-spam`, unchecked), "Télécharger" (`export-download`) calling `useDownloadExport()(exportPath(scope, format, includeSpam, userTimeZone()))`; busy state; `ErrorNotice` on failure; the dialog closes on success.
- The event leads page gets the same `ExportDialog` (`scope = { kind: "event", id }`).

- [ ] **Step 1: Write the failing unit tests**

```ts
test("LEA-013 the whole-card page lists every event's leads with their event", …);
test("LEA-021 LEA-012 the export dialog downloads the chosen format, spam excluded unless checked", …); // path built with format, include_spam, tz
test("LEA-021 a failed export shows the error and keeps the dialog open", …);
test("EDI-010 the card's events page links to the whole-card view", …);
```

- [ ] **Step 2: Write the failing e2e tests** (`exports.spec.ts`, `api.seedEvents()`, `loginAs("seed-alice")`)

```ts
test("LEA-001 LEA-013 whole-card view", …);       // events page → Tous les contacts de la carte → 4 rows newest first (Bot, Zoé, Éloïse, Jean-Michel) with their event titles; search "hebert" → Jean-Michel
test("LEA-006 LEA-007 LEA-022 LEA-023 event CSV", …);
// Mariage → Exporter → CSV → Télécharger: suggestedFilename "contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.csv";
// bytes start with EF BB BF; first line exactly
// "Prénom,Nom,Email,Téléphone,Rue,Code postal,Ville,Pays,Date du mariage,Nombre d'invités,Formule,Recevoir la brochure,Événement,Date d'envoi (Europe/Paris),Date du consentement (Europe/Paris),Texte du consentement,Spam";
// 2 data rows, Éloïse first: "Éloïse,D’Aubigné-Müller,eloise@example.test,+33612345678,,,,,2027-09-18,120,Prestige,Oui,Salon du Mariage Clermont 2027,2027-03-15 09:30:00,…"; no "Bot"
test("LEA-012 spam leads only when asked", …);    // checkbox → 3 rows, Bot's Spam column "Oui"
test("LEA-008 LEA-009 XLSX and JSON", …);         // xlsx bytes start with "PK"; json: event.title, 2 leads, Éloïse custom "Nombre d'invités" value 120 (number), brochure true (boolean), submitted_at ends with "Z"
test("LEA-011 LEA-024 FRM-023 card export keeps the deleted field", …); // whole card CSV: header contains "Entreprise", Jean-Michel's row contains "Hébert & Fils"; file "contacts-alice-durand-2027-03-15.csv"
test("LEA-005 a deleted lead is not exported", …);
test("LNK-008 LEA-031 a disabled card with no lead exports its header row", …); // alice-archive whole-card CSV: BOM + header line only
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/events/ExportDialog "src/app/(app)/dashboard/cards/[id]/leads"` then `make e2e ARGS="-g 'LEA-0|EDI-010|LNK-008'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): whole-card lead view and CSV, XLSX and JSON exports"`

---

### Task 12: Support pages for events and leads

**Files:**
- Create: `frontend/web/src/app/(app)/support/cards/[id]/events/{page.tsx, page.test.tsx}`, `frontend/web/src/app/(app)/support/cards/[id]/events/[eventId]/leads/page.tsx`, `frontend/web/src/app/(app)/support/cards/[id]/leads/page.tsx`, `frontend/web/src/components/support/{SupportEventList.tsx, SupportEventList.test.tsx}`, `frontend/e2e/tests/support-leads.spec.ts`
- Modify: `frontend/web/src/components/support/{UserCards.tsx, UserCards.test.tsx}` (link `support-card-events-<slug>` "Événements"), `frontend/web/messages/fr.json` (`support.events.*`, `support.leads.*`)

**Rules:** ADM-001, ADM-007, ADM-016, ADM-017, ADM-018, LEA-013, LEA-015, LEA-018.

**Interfaces:**
- Every page: `AccountGate` → `SupportGuard` → `SupportLoader` (existing pattern).
- `SupportEventList({ cardId, events })`: rows (`support-event-row-<id>`) with title, start, end or "Sans fin", phase label, lead count (reuse the `events.*` formatters), a "Contacts" link (`support-event-leads-<id>`) to `/support/cards/{id}/events/{eventId}/leads`, and a "Tous les contacts de la carte" link (`support-card-leads`) to `/support/cards/{id}/leads`; no create, edit, end or delete control.
- Lead pages: the notice "Consultation en lecture seule, enregistrée dans le journal d'audit" (`support-leads-notice`, ADM-017) above `LeadList` with `actions = null`, no `toolbar` (no export, ADM-018); `load` = `GET /api/admin/events/{id}/leads` or `GET /api/admin/cards/{id}/leads`; the event page reads the event title from `GET /api/admin/cards/{id}/events` ("Événement introuvable" when absent).

- [ ] **Step 1: Write the failing unit tests**

```ts
test("ADM-016 the support event list is read-only and links to leads", …);
test("ADM-017 ADM-018 support lead pages show the notice and no action or export", …);
```

- [ ] **Step 2: Write the failing e2e tests** (`support-leads.spec.ts`, `api.seedEvents()`, `loginAs("seed-admin")`)

```ts
test("ADM-007 ADM-016 support sees a user's events", …);            // Support → Alice → alice-durand → Événements: Mariage with "3 contacts"; no edit button
test("ADM-007 ADM-017 ADM-018 support reads leads read-only", …);   // Mariage → Contacts: notice, 3 rows, search "zoe" → 1, detail opens with the consent text; no spam, delete or Exporter button
test("ADM-016 LEA-013 support whole-card view", …);                 // 4 rows with event titles
test("ADM-001 the support lead pages are for administrators only", …); // seed-alice on /support/cards/{id}/leads → "Accès réservé"
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/support "src/app/(app)/support"` then `make e2e ARGS="-g 'ADM-0'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands (plan 2's ADM e2e tests still pass) · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): read-only support views of a user's events and leads"`

---

### Task 13: "Mon compte" page and account deletion

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/account/{page.tsx, page.test.tsx}`, `frontend/web/src/app/(app)/account-deleted/{page.tsx, page.test.tsx}`, `frontend/web/src/components/account/{DeleteAccount.tsx, DeleteAccount.test.tsx}`, `frontend/web/src/lib/account/{deletion.ts, deletion.test.ts}`, `frontend/e2e/tests/account-deletion.spec.ts`
- Modify: `frontend/web/src/components/account/{AccountGate.tsx, AccountGate.test.tsx}`, `frontend/web/messages/fr.json` (`account.*`)

**Rules:** ACC-019, ACC-020, ACC-021, ACC-022, ACC-023, ACC-004, LNK-015, LNK-032, LNK-033.

**Interfaces:**
- `lib/account/deletion.ts`: `DELETION_WORD = "SUPPRIMER"` · `isDeletionConfirmed(input: string): boolean` (trimmed, case-insensitive, ACC-020).
- `AccountGate`: header link "Mon compte" (`account-link`) to `/dashboard/account`; the `pending`, `rejected` and `suspended` notices render `<DeleteAccount isAdmin={false} />` under their text (ACC-019, ACC-021).
- `DeleteAccount({ isAdmin })`: for an administrator, the explanation `delete-account-admin` ("Un administrateur ne peut pas supprimer son compte. Demande à l'opérateur de l'instance de te retirer de ADMIN_USER_IDS.") and no button; otherwise the button "Supprimer mon compte" (`delete-account-open`) opening a dialog with the consequences of ACC-020, the input (`delete-account-input`, label "Tape SUPPRIMER pour confirmer") and the confirm button (`delete-account-confirm`, disabled until `isDeletionConfirmed`); on confirm `api.DELETE("/api/me")`, then `router.replace("/account-deleted")` with nothing else sent; `ErrorNotice` on failure (`cannot_delete_admin` has its own message).
- `/dashboard/account` page: `AccountGate`, the email and display name from `useMe()`, then `<DeleteAccount isAdmin={me.is_admin} />`.
- `/account-deleted` page (not wrapped in `AccountGate`, still under the `(app)` layout for `useAuth`): calls `signOut()` once on mount, then shows "Ton compte a été supprimé" (`account-deleted`), a paragraph saying the identity-provider account still exists and is to be deleted there, and a link to `/`. It sends no `/api` request (ACC-023, Review Focus 9).

- [ ] **Step 1: Write the failing unit tests**

```ts
test("ACC-020 the confirmation word ignores case and spaces", …);
test("ACC-019 the header links to Mon compte", …);
test("ACC-020 the delete button waits for SUPPRIMER, then deletes and leaves", …);   // DELETE /api/me once, router.replace("/account-deleted")
test("ACC-021 an administrator gets an explanation instead of the button", …);
test("ACC-019 ACC-021 a pending account is offered the deletion", …);
test("ACC-023 the deleted page signs out without calling the API", …);              // signOut called once; fetch not called
```

- [ ] **Step 2: Write the failing e2e tests** (`account-deletion.spec.ts`; `api.reset()`, `api.seed("base")`, `api.seed("cards")` before each)

```ts
test("ACC-019 ACC-020 ACC-022 LNK-015 LNK-033 a user deletes their account", …);
// seed-bob → Mon compte → Supprimer mon compte → dialog text → confirm disabled → type " supprimer " → enabled → confirm →
// URL /account-deleted, "Ton compte a été supprimé"; /c/bob-martin → "Cette carte n'est plus active";
// admin token: GET /api/admin/users has no user with subject "seed-bob" (Review Focus 9)
test("LNK-032 a blocked slug cannot be taken by anyone", …);
// after Bob's deletion: seed-alice → new card, slug "bob-martin" → shown as taken, creation refused
test("ACC-023 signing in again gives a new pending account", …);   // loginAs("seed-bob") → "Ton compte est en attente de validation"; no card
test("ACC-021 a pending account can delete itself", …);             // seed-carol → pending screen → Supprimer mon compte → … → /account-deleted
test("ACC-021 an administrator cannot delete their account", …);    // seed-admin → Mon compte → explanation, no delete button
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/account src/lib/account "src/app/(app)/dashboard/account" "src/app/(app)/account-deleted"` then `make e2e ARGS="-g 'ACC-0|LNK-03'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands (plan 1's ACC e2e tests still pass) · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): account page and account deletion"`

---

### Task 14: Event editor asks before leaving unsaved changes

**Files:**
- Modify: `frontend/web/src/lib/events/{draft.ts, draft.test.ts}`, `frontend/web/src/components/events/{EventEditor.tsx, EventEditor.test.tsx}`, `frontend/web/messages/fr.json` (`events.editor.unsaved`, `events.editor.leaveConfirm`), `frontend/e2e/tests/events.spec.ts`

**Rules:** EDI-021, EDI-016.

**Interfaces:**
- `isEventDraftDirty(saved: EventDraft, draft: EventDraft, zone: string): boolean` — compares `draftToBody(saved, zone)` and `draftToBody(draft, zone)` as the server would see them (normalized strings, same rule as `isDirty` of `lib/cards/draft.ts`): undoing an edit makes it clean.
- `EventEditor`: same mechanism as `CardEditor` (EDI-016): a `beforeunload` listener while dirty; every link of the editor (back to the events, card editor) calls `confirmLeave` with `window.confirm(t("events.editor.leaveConfirm"))`; after a successful save (create or update) the saved draft is the new reference **before** any navigation, so the post-save redirect never asks.

- [ ] **Step 1: Write the failing tests**

```ts
test("EDI-021 equal event drafts are clean, any edit is dirty, undoing is clean", …);      // draft.test.ts
test("EDI-021 leaving the event editor with unsaved changes asks first", …);               // beforeunload prevented only when dirty
test("EDI-021 the back link asks only when there are unsaved changes", …);
test("EDI-021 after a save nothing is asked", …);
```

E2E (`events.spec.ts`): `test("EDI-021 leaving the event editor with unsaved changes asks first", …)` — edit the Mariage title, click the back link → a `dialog` event is raised and dismissed → still on the editor; save → back link → no dialog.

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/events/draft src/components/events/EventEditor` then `make e2e ARGS="-g EDI-021"` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same commands, then `make e2e ARGS="-g 'EDI-0|EVT-0'"` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): event editor asks before leaving unsaved changes"`

---

### Task 15: Skills and documentation

**Files:**
- Modify: `.claude/skills/change-api/SKILL.md`, `.claude/skills/dev-env/SKILL.md`, `.claude/skills/add-seed-scenario/SKILL.md`, `.claude/skills/run-tests/SKILL.md`, `.claude/skills/debug-failure/SKILL.md` (only if a download or audit tip fits), `CLAUDE.md`

**Rules:** none (documentation).

**Interfaces:**
- `change-api`: a route that answers a file (bytes, `Content-Type`, `Content-Disposition`, `Cache-Control: no-store`, OpenAPI content types, download on the web through `useDownloadExport`); a support read of user data (`AdminUser`, `db/admin_*.rs` exception header, unique `operation_id`, audit entry in the same transaction before answering, fail-closed, metadata without prospect data); a claim of a slug (`find_for_update` then `blocked_slugs::is_blocked`, in that order); account deletion touches every table that holds user data: a new user-data table must be covered by the cascade or by `db/account.rs`, and media by `delete_card`; new code `cannot_delete_admin`.
- `dev-env`: try exports locally (whole-card page of `alice-durand`, `tz` parameter), support views (`seed-admin` → Alice → card → Événements), account deletion (`seed-bob`; reseed with `make seed && make seed SCENARIO=cards` to get him back; blocked slugs survive a reseed, `POST /api/test/reset` empties them).
- `add-seed-scenario`: `SeedDeletedAnswer` for answers to fields deleted since; `RESET_TABLES` must list every new table (`blocked_slugs`).
- `run-tests`: downloads in e2e (`page.waitForEvent("download")`, `downloadedText`/`downloadedBytes`); XLSX checked in Rust with `calamine`; rules LEA/ACC/ADM/LNK of this plan and their test files.
- `CLAUDE.md`: repository map (`backend/domain/src/export/`, `src/lib/account`, `src/components/account`, whole-card and account pages, support event pages); the second exception to "No hard-coded interface text": the export labels in `backend/domain/src/export/labels.rs`, because the server writes the files; the `db/` exceptions list mentions `admin_leads.rs`, `blocked_slugs.rs`, `account.rs`.

- [ ] **Step 1: Write the updates** listed above, in English, following each file's current form.
- [ ] **Step 2: Check** — `node scripts/spec-lint.mjs` · Expected: exit 0.
- [ ] **Step 3: Commit** — `git add .claude CLAUDE.md && git commit -m "docs: skills and CLAUDE.md for leads, exports, support access and account deletion"`

---

### Task 16: Spec status, coverage and final check

**Files:**
- Modify: `spec/leads-exports.md`, `spec/account-auth.md`, `spec/admin-support.md`, `spec/card-links.md`, `spec/dashboard-editor.md`, `docs/superpowers/plans/2026-11-03-cartouche-plan-4-followups.md`

- [ ] **Step 1: Update the status lines**, exactly:
  - `leads-exports.md`: `> Status: implemented (plans 3 and 4)`
  - `account-auth.md`: `> Status: implemented (plans 1, 2 and 4)`
  - `admin-support.md`: `> Status: implemented (plans 1, 2 and 4)`
  - `card-links.md`: `> Status: implemented (plans 2, 3 and 4)`
  - `dashboard-editor.md`: `> Status: implemented (plans 2, 3 and 4)`
  - and remove the trailing "Plan 4." of ADM-007, ADM-008 and ADM-016 to ADM-020 (keep "Plan 2." on the plan 2 rules as they are).
- [ ] **Step 2: Check the coverage** — `node scripts/spec-lint.mjs --coverage` · Expected: exit 0; no LEA rule, no ACC-018 to ACC-024, no ADM-007, ADM-008, ADM-016 to ADM-020, no LNK-015, LNK-016, LNK-031 to LNK-033, no EDI-010 or EDI-021 in the uncited list. A remaining rule gets its test in the task that owns it before going on.
- [ ] **Step 3: Full check** — `make lint test` then `make e2e` · Expected: everything passes (`mobile` and `desktop` projects); `git status` clean except this task's files. Record any flaky test seen (plan 3's watch list) in the follow-ups file.
- [ ] **Step 4: Commit** — `git add spec docs && git commit -m "docs(spec): mark leads, exports, support access and account deletion as implemented"`
