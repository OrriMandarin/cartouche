---
name: add-seed-scenario
description: Use when a Cartouche test or demo needs a new named dataset (seed scenario) loadable with make seed or from Playwright via api.seed('<name>').
---

# Ajouter un scénario de données

Les scénarios vivent dans `backend/server/src/test_support/seed.rs` (feature `test-support`, jamais en production). Un scénario est une fonction `fn(&PgPool) -> BoxFuture<Result<SeedReport, sqlx::Error>>` enregistrée dans `SCENARIOS`. Le scénario `base` est le modèle à copier.

## Étapes

1. **Écrire la fonction** à côté de `base` : `async fn <nom>(pool: &PgPool) -> Result<SeedReport, sqlx::Error>`. Elle suppose une base fraîchement vidée par `reset`, mais doit rester rejouable : utiliser `insert … on conflict … do update` comme `base`.
2. **L'enregistrer** dans la constante :
   ```rust
   pub const SCENARIOS: &[(&str, Scenario)] = &[
       ("base", |pool| Box::pin(base(pool))),
       ("<nom>", |pool| Box::pin(<nom>(pool))),
   ];
   ```
3. **Tables** : toute nouvelle table touchée par le scénario doit figurer dans `RESET_TABLES` (même fichier), sinon `reset` ne la vide pas.
4. **Étendre `SeedReport`** si les tests ont besoin d'identifiants créés (il est renvoyé tel quel par `POST /api/test/seed`) ; l'interface `SeededUser` de `frontend/e2e/fixtures.ts` suit.
5. **Test** : un test d'intégration dans `backend/server/tests/test_support.rs` (cité par sa règle `// spec: …` s'il y en a une) qui charge le scénario et vérifie son contenu, plus le test en ligne de `seed.rs` si la logique est non triviale.

## Conventions

- Sujets (`sub`) en `seed-<prénom ou rôle>` (`seed-admin`, `seed-alice`…), émetteur `TEST_ISSUER`. `seed-admin` est l'administrateur de la stack de test (`ADMIN_USER_IDS=seed-admin`).
- Données réalistes **avec accents et apostrophes** (`Carole Lefèvre`, `Érin D'Aubigné-Müller`) pour exercer UTF-8 et NFC ; passer les chaînes par `normalize(...)` comme `base`. Adresses en `@example.test`.
- Un scénario **complète** `base` ou le remplace entièrement : le dire dans un commentaire. Les tests e2e partent toujours de `base` (fixture `freshState`).
- Aucune donnée de scénario ne doit pouvoir exister en production : tout reste derrière `test-support`.

## L'utiliser

```bash
make dev-db && make seed SCENARIO=<nom>                              # en local
cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list   # vérifier qu'il est listé
curl -s -X POST localhost:8080/api/test/seed -H 'content-type: application/json' -d '{"scenario":"<nom>"}'
```

Dans Playwright (`frontend/e2e/tests/*.spec.ts`), la fixture `freshState` a déjà fait `reset` + `seed('base')` avant chaque test ; pour charger un autre scénario :

```ts
test("XXX-NNN : …", async ({ api, page, loginAs }) => {
  await api.reset();
  await api.seed("<nom>");
  await loginAs("seed-alice");
  // …
});
```

Un nom inconnu répond `unknown_scenario`. Voir aussi `dev-env` (réinitialiser) et `run-tests`.
