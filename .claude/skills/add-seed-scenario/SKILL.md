---
name: add-seed-scenario
description: Use when a Cartouche test or demo needs a new named dataset (seed scenario) loadable with make seed or from Playwright via api.seed('<name>').
---

# Add a seed scenario

Scenarios live in `backend/server/src/test_support/seed.rs` (feature `test-support`, never in production). A scenario is a function `fn(&PgPool) -> BoxFuture<Result<SeedReport, sqlx::Error>>` registered in `SCENARIOS`. The `base` scenario is the model to copy; `cards` (cards of Alice, Bob and Dan in various states, without media) shows how to fill `cards`.

## Steps

1. **Write the function** next to `base`: `async fn <name>(pool: &PgPool) -> Result<SeedReport, sqlx::Error>`. It assumes a database freshly emptied by `reset`, but must remain replayable: use `insert … on conflict … do update` like `base`.
2. **Register it** in the constant:
   ```rust
   pub const SCENARIOS: &[(&str, Scenario)] = &[
       ("base", |pool| Box::pin(base(pool))),
       ("<name>", |pool| Box::pin(<name>(pool))),
   ];
   ```
3. **Tables**: any new table touched by the scenario must appear in `RESET_TABLES` (same file), otherwise `reset` does not empty it.
4. **Extend `SeedReport`** if the tests need created identifiers. It is `SeedReport { users, cards }` (`base` returns `cards` empty) and is returned as is by `POST /api/test/seed`; in Playwright, `api.seed("<name>")` returns it (`const { cards } = await api.seed("cards")`), and the `SeededUser`/`SeededCard` interfaces in `frontend/e2e/fixtures.ts` follow.
5. **Test**: an integration test in `backend/server/tests/test_support.rs` (cited by its `// spec: …` rule if there is one) that loads the scenario and checks its content, plus the inline test in `seed.rs` if the logic is non-trivial.

## Conventions

- Subjects (`sub`) as `seed-<first name or role>` (`seed-admin`, `seed-alice`…), issuer `TEST_ISSUER`. `seed-admin` is the administrator of the test stack (`ADMIN_USER_IDS=seed-admin`).
- Realistic data **with accents and apostrophes** (`Carole Lefèvre`, `Érin D'Aubigné-Müller`) to exercise UTF-8 and NFC; pass strings through `normalize(...)` like `base`. Addresses in `@example.test`.
- A scenario **completes** `base` or replaces it entirely: say so in a comment. The e2e tests always start from `base` (fixture `freshState`).
- No scenario data must be able to exist in production: everything stays behind `test-support`.

## Using it

```bash
make dev-db && make seed SCENARIO=<name>                             # locally
cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list   # check that it is listed
curl -s -X POST localhost:8080/api/test/seed -H 'content-type: application/json' -d '{"scenario":"<name>"}'
```

In Playwright (`frontend/e2e/tests/*.spec.ts`), the `freshState` fixture has already done `reset` + `seed('base')` before each test; to load another scenario:

```ts
test("XXX-NNN: …", async ({ api, page, loginAs }) => {
  await api.reset();
  await api.seed("<name>");
  await loginAs("seed-alice");
  // …
});
```

An unknown name answers `unknown_scenario`. See also `dev-env` (reset) and `run-tests`.
