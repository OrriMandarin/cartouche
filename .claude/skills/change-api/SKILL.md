---
name: change-api
description: Use when adding or changing a Cartouche API endpoint, database table or column: migration, db functions, domain logic, route with OpenAPI annotation, integration tests, generated client and frontend adaptation.
---

# Changer l'API

Précondition : la règle de spec existe (skill `update-spec`). Ordre à suivre, chaque étape avec son test (TDD : test qui échoue d'abord).

Dossiers : `apps/api/domain/` (`cartouche-domain`, logique pure), `apps/api/server/` (`cartouche-api`). Poste local : `source ~/.cargo/env`, `export PATH="$HOME/.local/bin:$PATH"`, base de dev lancée (`make dev-db`) et `DATABASE_URL` exporté pour `cargo test`.

1. **Migration SQLx** : `apps/api/server/migrations/NNNN_<nom>.sql` (prochain numéro après `ls apps/api/server/migrations`). Les migrations appliquées ne se modifient jamais : on en ajoute une. Elles s'appliquent au démarrage de l'API et dans `#[sqlx::test(migrations = "./migrations")]`.
2. **Nouvelles tables dans `RESET_TABLES`** (`apps/api/server/src/test_support/seed.rs`) : sinon `reset` ne les vide pas et les tests e2e se polluent. Une table qui référence une autre se met avant elle ou reste couverte par `truncate … cascade`.
3. **Fonctions `db/`** (`apps/api/server/src/db/<table>.rs`, déclarées dans `db/mod.rs`) : requêtes SQLx. **Toute lecture ou écriture de données utilisateur prend l'identifiant du propriétaire** et le met dans la clause `where` ; aucune fonction sans propriétaire sur des données utilisateur.
4. **Logique métier dans `cartouche-domain`** : règles, validation, normalisation (`normalize` : NFC + trim). Le handler ne contient aucune logique. Toute dépendance externe (horloge, jeton, stockage, e-mail) passe par un trait.
5. **Route** (`apps/api/server/src/routes/<nom>.rs`, déclarée dans `routes/mod.rs`) : le handler lit la requête, appelle le domaine et `db/`, formate la réponse. Annoter avec `#[utoipa::path(...)]` (méthode, `path`, `summary`, `description`, `tag`, `security(("bearer" = []))`, **toutes** les réponses y compris 401/403/500 avec `ErrorBody`) et dériver `ToSchema` sur les types. Les erreurs passent par `ApiError` (`src/error.rs`, forme `{"error":{"code","message","request_id"}}`) ; un nouveau code d'erreur = une nouvelle variante. Brancher ensuite la route dans `src/app.rs` et ajouter le handler à `paths(...)` dans `src/openapi.rs` (nouveaux schémas dans `components(schemas(...))`, nouveau tag dans `tags(...)`). Les routes `/api/test/*` ne sont **jamais** dans l'OpenAPI.
6. **Tests d'intégration** (`apps/api/server/tests/<sujet>.rs`, harnais `tests/common`) : `// spec: XXX-NNN` avant chaque test. Couvrir au minimum : cas nominal, 401 sans jeton, statut de compte non approuvé (403) si la route exige un compte approuvé, isolation entre propriétaires.
   ```bash
   cd apps/api && cargo test -p cartouche-api --all-features --test <fichier>
   ```
7. **Régénérer le contrat et le client** : `make openapi` (écrit `packages/api-client/openapi.json` puis `src/schema.d.ts`). Ne jamais éditer ces fichiers à la main ; commiter leur diff. Sans cela, le test `openapi_is_up_to_date` échoue (« OpenAPI drift »).
8. **Frontend** : utiliser les types générés de `@cartouche/api-client` via `apps/web/src/lib/api.ts` ; logique dans `apps/web/src/lib`, composants sans logique métier ; tout texte dans `apps/web/messages/fr.json` (aucun texte en dur). Tests vitest avec la règle dans le nom, et un test e2e (`e2e/tests/`) si un parcours utilisateur change.
9. **Vérifier** : `make lint test`, puis `make e2e` si l'interface est touchée.

Pièges : jamais de SQL construit par concaténation d'entrées ; normaliser (NFC + trim) toute chaîne reçue avant stockage ; ne rien mettre dans le jeton que la base doit relire (le statut est relu à chaque requête, ACC-005).
