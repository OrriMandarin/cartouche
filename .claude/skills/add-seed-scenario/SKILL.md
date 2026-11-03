---
name: add-seed-scenario
description: Use when a Cartouche test or demo needs a new named dataset (seed scenario) loadable with make seed or from Playwright via api.seed('<name>').
---

# Add a seed scenario

Scenarios live in `backend/server/src/test_support/seed.rs` (feature `test-support`, never in production). A scenario is a function `fn(&PgPool, DateTime<Utc>) -> BoxFuture<Result<SeedReport, sqlx::Error>>` (type `Scenario`) registered in `SCENARIOS`. The second parameter is **the time of the API's clock**: a scenario dates what it creates relative to it (an event "started two hours ago"), so that the data stays consistent when the test clock is frozen (`POST /api/test/clock`). The `base` scenario is the model to copy; `cards` (cards of Alice, Bob and Dan in various states, without media) shows how to fill `cards`, and `events` (Alice's events and leads, see below) how to date relative to `now`.

| Scenario | Contents | Depends on |
|---|---|---|
| `base` | `seed-admin` and one user per status | nothing |
| `cards` | cards `alice-durand`, `alice-archive`, `bob-martin`, `dan-moreau`, former slugs | `base` (the owners) |
| `events` | eight events and four leads, dates relative to T0 (table below) | `cards` (the cards, by their slug), hence `base` |

**A scenario that extends another one fails (`RowNotFound`) if the previous one is not loaded first.** So `make seed SCENARIO=events` alone is not enough: see "Using it".

## Steps

1. **Write the function** next to `base`: `async fn <name>(pool: &PgPool, now: DateTime<Utc>) -> Result<SeedReport, sqlx::Error>` (`base` does not need the time and only takes the pool). A scenario's dates are `now + TimeDelta::minutes(…)`, never `Utc::now()`. It assumes a database freshly emptied by `reset`, but must remain replayable: use `insert … on conflict … do update` like `base`.
2. **Register it** in the constant:
   ```rust
   pub const SCENARIOS: &[(&str, Scenario)] = &[
       ("base", |pool, _| Box::pin(base(pool))),
       ("<name>", |pool, now| Box::pin(<name>(pool, now))),
   ];
   ```
3. **Tables**: any new table touched by the scenario must appear in `RESET_TABLES` (same file), otherwise `reset` does not empty it.
4. **Extend `SeedReport`** if the tests need created identifiers. It is `SeedReport { users, cards, events }`; each scenario returns only its own rows (`base` the `users`, `cards` the `cards`, `events` the `events`, the other lists empty). It is returned as is by `POST /api/test/seed` and printed by `cartouche-seed`; in Playwright, `api.seed("<name>")` returns it (`const { cards } = await api.seed("cards")`), and the `SeededUser`/`SeededCard`/`SeededEvent` interfaces in `frontend/e2e/fixtures.ts` follow. Fixed identifiers (`uuid::uuid!`) make the scenario replayable and the tests deterministic.
5. **Test**: an integration test in `backend/server/tests/test_support.rs` (cited by its `// spec: …` rule if there is one) that loads the scenario and checks its content, plus the inline test in `seed.rs` if the logic is non-trivial.

## The `events` scenario

Dates relative to T0, the time of the API's clock when the scenario is loaded. All the cards are those of `cards`.

| Event (card) | Start / end (relative to T0) | Specifics |
|---|---|---|
| Salon du Mariage Clermont 2027 (`alice-durand`) | −2 h / +6 h | in progress, 4 custom fields (date, number, single choice, checkbox), 3 leads including one spam |
| Portes ouvertes de l'Atelier (`alice-durand`) | −1 h / no end | in progress, access code "Château", 2 submissions per device, custom consent |
| Démonstration en boutique (`alice-durand`) | −5 min / +2 h | in progress (the third concurrent one: the limit is reached) |
| Atelier découverte (`alice-durand`) | −3 h / −10 min | ended 10 min ago, still accepts submissions (15-min grace period) |
| Foire de Lyon (`alice-durand`) | +10 d / +12 d | upcoming |
| Salon de Paris 2026 (`alice-durand`) | −40 d / −38 d | past, 1 lead |
| Événement archivé (`alice-archive`) | −1 h / +1 h | card disabled by its owner |
| Salon bloqué (`bob-martin`) | −1 h / +1 h | card disabled by support |

The accents, typographic apostrophes and emojis of the leads ("Éloïse D’Aubigné-Müller", "Zoé Lefèvre ✨") check UTF-8 end to end. **Freeze the clock before loading**: the dates are only right relative to the loading time.

## Conventions

- Subjects (`sub`) as `seed-<first name or role>` (`seed-admin`, `seed-alice`…), issuer `TEST_ISSUER`. `seed-admin` is the administrator of the test stack (`ADMIN_USER_IDS=seed-admin`).
- Realistic data **with accents and apostrophes** (`Carole Lefèvre`, `Érin D'Aubigné-Müller`) to exercise UTF-8 and NFC; pass strings through `normalize(...)` like `base`. Addresses in `@example.test`.
- A scenario **completes** `base` or replaces it entirely: say so in a comment. The e2e tests always start from `base` (fixture `freshState`).
- No scenario data must be able to exist in production: everything stays behind `test-support`.

## Using it

```bash
make dev-db && make seed SCENARIO=<name>                             # locally, for a scenario that depends on nothing
# a scenario that extends others is loaded in order, for example the events:
make seed && make seed SCENARIO=cards && make seed SCENARIO=events   # base, then cards, then events
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

For events, do not chain the calls by hand: `api.seedEvents()` does `reset`, **freezes the clock at `EVENTS_NOW`** (`frontend/e2e/env.ts`, 2027-03-15T10:00:00Z), then loads `base`, `cards`, `events` in order and returns the three reports merged. The identifiers are then read from the report (`const { events } = await api.seedEvents()`).

```ts
test("EVT-005 …", async ({ api, page, loginAs }) => {
  const { events } = await api.seedEvents();   // clock frozen in 2027, before any sign-in
  await loginAs("seed-alice");                 // the token is signed at the frozen time
  // …
});
```

**Mandatory order: `api.setClock` (or `seedEvents`) before `loginAs` and before `api.token`.** A token signed at the real time is expired for a clock in 2027. The `freshState` fixture releases the clock (`setClock(null)`) before each test. An unknown name answers `unknown_scenario`. See also `dev-env` (reset) and `run-tests`.
