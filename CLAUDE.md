# Cartouche — consignes pour les agents

Cartouche est une application open source de carte de visite numérique (backend Rust, frontend Next.js). Ce fichier est lu en premier par tous les agents : il décrit le dépôt, les commandes, le cycle de travail et les règles de qualité. **Langues** : ce fichier, le corps des agents, `spec/` et les textes d'interface sont en français, avec les accents. Le code, les commentaires, les identifiants et les messages de commit sont en **anglais**.

## Carte du dépôt

| Chemin | Contenu |
|---|---|
| `spec/` | **Référence produit** : règles numérotées (`XXX-NNN`), un fichier par sujet. Voir `spec/README.md`. |
| `docs/superpowers/` | Design initial (figé) et plans de réalisation. |
| `apps/api/` | Workspace Rust. `domain/` (crate `cartouche-domain`) : logique métier pure. `server/` (crate `cartouche-api`) : Axum, `config`, `auth/`, `db/` (requêtes SQLx), `routes/`, `test_support/` (feature `test-support`), `migrations/`, `tests/` (intégration). |
| `apps/web/` | Next.js : `src/app/` (pages), `src/components/`, `src/lib/` (logique : auth, `api.ts`, profil de build), `messages/fr.json` (textes d'interface). |
| `packages/api-client/` | Client TypeScript **généré** depuis l'OpenAPI (`openapi.json`, `schema.d.ts` commités ; ne pas éditer à la main). |
| `e2e/` | Tests Playwright (`fixtures.ts`, `tests/*.spec.ts`). |
| `scripts/` | `spec-lint.mjs` (vérificateur de la spec), `check-prod-guard.sh`. |
| `.claude/agents/` | Agents du projet. `.claude/skills/` : skills du projet. |
| `compose.dev.yml`, `compose.test.yml` | Base de dev ; stack complète (db, api, web) pour les tests e2e. |

## Commandes (`make`)

| Commande | Effet |
|---|---|
| `make setup` | Installe les dépendances (pnpm + `cargo fetch`). |
| `make dev-db` | Démarre PostgreSQL de dev (port 54320). |
| `make api` / `make web` | Lance l'API (8080, avec `test-support`) / le site (3000). |
| `make seed [SCENARIO=base]` | Alimente la base avec un scénario de données. |
| `make test` | `test-api` + `test-web` + `spec-lint-test` (tests du vérificateur) + `spec-lint`. |
| `make lint` | `cargo fmt --check`, `clippy -D warnings`, lint et typecheck pnpm. |
| `make openapi` | Régénère `openapi.json` puis le client TypeScript. |
| `make spec-lint [ARGS=--coverage]` | `node scripts/spec-lint.mjs` ; `ARGS=--coverage` liste les règles sans test. |
| `make e2e [ARGS="-g ACC-004"]` | Monte la stack de test et lance Playwright. `make e2e-down` l'arrête. |

Sans fichier `.env`, tout fonctionne en local **sans Clerk** (fournisseur d'authentification de test, JWKS servi par l'API). Voir `.env.example`.

Note pour le poste local de développement : `pnpm` est dans `~/.local/bin` (Node 25 n'a pas Corepack) et `cargo` s'obtient avec `source ~/.cargo/env`. En cas de « command not found », exporter `PATH="$HOME/.local/bin:$PATH"` et sourcer `~/.cargo/env` avant de lancer `make`.

## Cycle de travail obligatoire

1. **Spec d'abord.** `planner` met à jour `spec/` (nouvelle règle, règle modifiée) et vérifie qu'aucune règle existante n'est contredite. Toute contradiction ou changement de comportement est signalé au porteur du projet **avant** de coder.
2. **Plan de tâches** : petites tâches, chacune avec ses tests et les identifiants de règles concernés.
3. **`builder` implémente en TDD** : un test qui échoue, le code minimal, le test qui passe, un commit par tâche.
4. **`task-reviewer`** relit chaque tâche terminée. Rien ne passe à la suite tant que le verdict n'est pas `APPROVED`.
5. **`make test`**, puis **`make e2e`**, doivent passer.
6. **`feature-reviewer`** relit la fonctionnalité complète en fin de parcours.
7. **Un bug part toujours d'un test qui le reproduit.** `debugger` d'abord ; si deux tentatives échouent, `debugger-deep`. Si le bug révèle une règle manquante ou fausse, on corrige la spec d'abord (étape 1).

## Règles de qualité

- **Aucune logique métier dans les handlers ni dans les composants** : elle va dans `cartouche-domain` (Rust) ou dans `apps/web/src/lib` (TypeScript). Un handler lit la requête, appelle le domaine et `db/`, formate la réponse.
- **Toute dépendance externe passe derrière un trait ou une interface** (horloge, vérification de jeton, stockage, e-mail, Clerk…), pour pouvoir la remplacer dans les tests.
- **Chaque requête utilisateur est filtrée par propriétaire dans `db/`** : aucune fonction de lecture ou d'écriture de données utilisateur sans l'identifiant du propriétaire.
- **Les tests citent leurs règles** : `// spec: ACC-004` avant un test Rust ; `ACC-004` dans le nom d'un test TypeScript. `node scripts/spec-lint.mjs --coverage` signale les règles sans test.
- **Aucun texte d'interface en dur** : tout passe par `apps/web/messages/fr.json`.
- Le code de test (`test-support`, adaptateur d'authentification `test`) ne doit jamais être présent dans un build de production.
- Ne jamais éditer à la main les fichiers générés (`openapi.json`, `schema.d.ts`) : `make openapi`.
- Code lisible, noms explicites, pas de code mort ; ne pas ajouter de fonctionnalité hors de la tâche.

## Déboguer

- Chaque réponse de l'API porte un en-tête `x-request-id`, repris dans le champ `error.request_id` des erreurs JSON (`{"error":{"code","message","request_id"}}`) et dans **chaque ligne de log** de la requête.
- Les logs de l'API sont en JSON : `docker compose -f compose.test.yml logs api | grep <request_id>`.
- Un test e2e en échec laisse ses artefacts dans `e2e/test-results/` : `trace.zip` (à ouvrir avec `pnpm --filter e2e exec playwright show-trace <chemin>`), capture d'écran, vidéo et pièce jointe `api-logs` (logs de l'API pendant le test, avec les `request_id`).
- Reproduire d'abord par un test, ensuite seulement corriger.

## Agents (`.claude/agents/`)

| Agent | Quand l'utiliser | Modèle |
|---|---|---|
| `explorer` | Chercher et résumer dans le code ou la spec, en lecture seule. | Haiku 5.5 |
| `planner` | Transformer une demande en mise à jour de la spec et en plan de tâches (n'écrit que dans `spec/` et `docs/`). | Opus 5.5, high |
| `builder` | Implémenter une tâche du plan, avec ses tests. | Sonnet 5.5, medium |
| `task-reviewer` | Relire une tâche terminée (plan, spec, tests, lisibilité). | Sonnet 5.5, high |
| `feature-reviewer` | Relire une fonctionnalité ou une correction de bout en bout. | Opus 5.5, high |
| `debugger` | Reproduire, diagnostiquer et corriger un bug. | Sonnet 5.5, high |
| `debugger-deep` | Bug complexe, ou quand `debugger` a échoué deux fois. | Opus 5.5, high |

## Skills (`.claude/skills/`)

| Skill | Quand l'utiliser |
|---|---|
| `dev-env` | Démarrer la base, l'API et le site en local ; seeder ; réinitialiser ; passer de l'adaptateur `test` à Clerk ; piloter l'horloge de test. |
| `run-tests` | Lancer un test ciblé, les tests d'une règle (`XXX-NNN`) ou la suite complète avant de conclure. |
| `debug-failure` | Diagnostiquer un échec : test reproducteur, `x-request-id`, logs de l'API, trace Playwright, escalade vers `debugger-deep`. |
| `update-spec` | Ajouter ou modifier une règle de `spec/` sans contradiction, avant de coder. |
| `change-api` | Modifier l'API : migration, `db/`, domaine, route et OpenAPI, tests, client généré, frontend. |
| `add-seed-scenario` | Ajouter un scénario de données pour `make seed` et Playwright. |

La skill « ajouter un template de carte » viendra avec le plan 2, en même temps que le contrat des templates.
