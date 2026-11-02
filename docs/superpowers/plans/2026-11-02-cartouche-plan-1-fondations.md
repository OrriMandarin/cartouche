# Cartouche — Plan 1 : Fondations — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser le socle complet et testable de Cartouche : monorepo, spec, agents, backend Rust avec authentification générique + fournisseur de test verrouillé hors production, comptes avec validation par un administrateur, frontend Next.js avec module d'authentification à 3 adaptateurs, environnement de test seedé, tests de bout en bout, CI et skills.

**Architecture:** Workspace Cargo (`apps/api`) en deux crates : `cartouche-domain` (règles pures, sans I/O) et `cartouche-api` (Axum, SQLx, auth, routes). Le frontend `apps/web` (Next.js App Router) consomme l'API via un client TypeScript généré depuis l'OpenAPI (`packages/api-client`). Les tests de bout en bout (`e2e/`) tournent sur la stack complète lancée par `compose.test.yml`, avec le fournisseur de test et des scénarios de données.

**Tech Stack:** Rust (stable, édition 2024), Axum 0.8, SQLx 0.8 (Postgres), jsonwebtoken, utoipa, tracing, sentry · PostgreSQL 17 · Node 24 LTS (ou plus récent), pnpm, Next.js ≥ 15 (App Router), React 19, TypeScript strict, Tailwind, shadcn/ui, next-intl, @clerk/nextjs, oidc-client-ts, openapi-typescript + openapi-fetch, Vitest, Testing Library, Playwright · Docker Compose · GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-02-cartouche-design.md` (le document de design validé). À partir de la tâche 2, la référence vivante est `spec/`.

---

## Découpage du projet en plans

Le design couvre un produit entier. Chaque plan livre un logiciel qui fonctionne et se teste seul :

| Plan | Contenu | Dépend de |
|---|---|---|
| **1. Fondations** (ce document) | Monorepo, spec, agents, auth, comptes + validation admin, environnement de test, e2e, CI, skills | — |
| 2. Cartes & page publique | Slugs et redirections, CRUD des cartes, stockage des médias, contrat des templates, thème, template Classique simple, éditeur + aperçu, vCard, QR code, OpenGraph, désactivation (propriétaire et support) | 1 |
| 3. Événements & formulaire | Événements, chevauchement ≤ 3, code d'accès, limite par appareil, anti-abus, formulaire, consentement, enregistrement des contacts | 2 |
| 4. Contacts & exports | Liste, détail, spam, suppression, exports CSV/XLSX/JSON, vue support avec audit, suppression de compte | 3 |
| 5. Production & auto-hébergement | Compose de production, bloc Caddy, Dockerfiles finaux, sauvegarde locale, guide Clerk, pages CGU/confidentialité, doc d'installation | 1 (peut avancer en parallèle de 2–4) |
| 6. Intégration du design | Designs Claude Design : landing, dashboard, Classique, thèmes, formulaire | 2–4 + designs fournis par le porteur |

Les plans 2 à 6 seront écrits au moment de les attaquer, à partir de `spec/` et du code existant.

## Global Constraints

- Licence MIT (fichier `LICENSE` existant, à ne pas modifier).
- Code, identifiants, commentaires et messages de commit en **anglais**. Textes de l'interface en **français**, tous via next-intl (`apps/web/messages/fr.json`), aucun texte en dur dans les composants.
- UTF-8 partout ; toute chaîne saisie ou reçue d'un jeton est normalisée en **NFC** et `trim()` avant stockage.
- `APP_ENV` ∈ {`development`, `test`, `production`} ; **absent ou invalide ⇒ `production`**.
- Émetteur de test : constante `TEST_ISSUER = "cartouche-test-issuer"`. L'API refuse de démarrer si `APP_ENV=production` et `AUTH_ISSUER == TEST_ISSUER`.
- Tout le code de test côté API (routes `/api/test/*`, binaire de seed, horloge pilotable par HTTP) est derrière la feature Cargo **`test-support`**, désactivée par défaut. Les routes `/api/test/*` ne sont montées que si la feature est compilée **et** `APP_ENV` ∈ {`development`, `test`}.
- Profil de build du frontend : `CARTOUCHE_BUILD_PROFILE` ∈ {`development`, `test`, `production`}, **défaut `production`**. L'adaptateur d'auth `test` est interdit si le profil est `production` (le build échoue).
- Erreurs JSON de l'API, toujours de la forme `{"error":{"code":"<snake_case>","message":"<texte>","request_id":"<id>"}}`.
- En-tête `x-request-id` : repris de la requête s'il fait 1 à 64 caractères `[A-Za-z0-9-]`, sinon généré (UUID v7) ; toujours renvoyé dans la réponse et présent dans chaque ligne de log de la requête.
- Logs de l'API en JSON (`tracing-subscriber` json) quand `APP_ENV` ≠ `development`, lisibles (pretty) en `development`.
- Sentry désactivé si `SENTRY_DSN` (API) / `NEXT_PUBLIC_SENTRY_DSN` (web) est absent.
- Identifiants de règles de spec : `XXX-NNN` (préfixe de 3 lettres du fichier, numéro sur 3 chiffres). Tout test qui vérifie une règle cite son identifiant (dans le nom du test côté TS, en commentaire `// spec: XXX-NNN` côté Rust).
- Ports : dev → Postgres `54320`, API `8080`, web `3000` ; stack de test (`compose.test.yml`) → Postgres `15432`, API `18080`, web `13000`.
- Comptes de la stack de test : `ADMIN_USER_IDS=seed-admin`, `SIGNUP_MODE=approval`.

## Review Focus

1. **Le fournisseur d'identité ne répond pas** (panne Clerk, DNS, lenteur) → l'API répond `503 auth_unavailable` en moins de 6 s, jamais une 500 ni une requête bloquée. Testé dans la tâche 6.
2. **Jeton expiré, pas encore valide, d'un autre émetteur, ou avec un `kid` inconnu** → `401` avec un code distinct (`token_expired` / `token_invalid`), avec une tolérance d'horloge de 60 s. Testé dans la tâche 6.
3. **Première visite d'un nouvel utilisateur : le dashboard lance plusieurs requêtes en parallèle** → un seul compte créé, aucune erreur 500 de doublon. Testé dans la tâche 7.
4. **`ADMIN_USER_IDS` mal formé** (`" a , b,, "`, chaîne vide) → les espaces sont retirés, les entrées vides ignorées ; une liste vide signifie aucun administrateur. Testé dans la tâche 4.
5. **Un utilisateur suspendu pendant qu'il est connecté** → sa requête suivante est refusée immédiatement (le statut est relu en base à chaque requête, jamais mis en cache dans le jeton). Testé dans les tâches 7 et 15.

---

## Structure des fichiers

```
.editorconfig  .gitignore  .gitattributes  Makefile  README.md  CLAUDE.md
package.json  pnpm-workspace.yaml  rust-toolchain.toml  .env.example
compose.dev.yml  compose.test.yml
scripts/spec-lint.mjs  scripts/spec-lint.test.mjs  scripts/check-prod-guard.sh
spec/README.md  spec/glossary.md  spec/<sujet>.md (13 fichiers)
.claude/agents/*.md (7)  .claude/skills/*/SKILL.md (6)
.github/workflows/ci.yml

apps/api/Cargo.toml                          workspace
apps/api/Dockerfile                          multi-étapes, cargo-chef, ARG FEATURES=""
apps/api/domain/src/lib.rs                   pub mod clock; pub mod text; pub mod user;
apps/api/domain/src/clock.rs                 Clock, SystemClock, ManualClock
apps/api/domain/src/text.rs                  normalize()
apps/api/domain/src/user.rs                  UserStatus, SignupMode, initial_status, check_transition
apps/api/server/src/main.rs                  démarrage : config → validate → migrations → serve
apps/api/server/src/lib.rs                   re-exports pour les tests d'intégration
apps/api/server/src/config.rs                AppEnv, Config, AuthConfig, Config::from_vars
apps/api/server/src/startup.rs               validate(), StartupError, TEST_ISSUER
apps/api/server/src/telemetry.rs             init tracing + sentry, couche request-id
apps/api/server/src/error.rs                 ApiError → réponse JSON
apps/api/server/src/state.rs                 AppState
apps/api/server/src/app.rs                   build_router(), OpenAPI
apps/api/server/src/auth/mod.rs
apps/api/server/src/auth/verifier.rs         TokenVerifier, JwtVerifier, VerifiedClaims, AuthError
apps/api/server/src/auth/keys.rs             KeySource, JwksKeySource, StaticKeySource
apps/api/server/src/auth/extract.rs          CurrentUser, ApprovedUser, AdminUser
apps/api/server/src/db/mod.rs
apps/api/server/src/db/users.rs              User, upsert_on_login, find_by_id, list_by_status, set_status
apps/api/server/src/db/audit.rs              AuditEntry, record
apps/api/server/src/routes/health.rs
apps/api/server/src/routes/me.rs
apps/api/server/src/routes/admin_users.rs
apps/api/server/src/test_support/mod.rs      #[cfg(feature = "test-support")]
apps/api/server/src/test_support/issuer.rs   clés de test, signature de jetons, JWKS
apps/api/server/src/test_support/routes.rs   /api/test/*
apps/api/server/src/test_support/seed.rs     scénarios
apps/api/server/src/bin/cartouche-seed.rs    required-features = ["test-support"]
apps/api/server/test-keys/                   paire de clés ES256 de test (README : jamais en prod)
apps/api/server/migrations/0001_users.sql
apps/api/server/migrations/0002_audit_log.sql
apps/api/server/tests/*.rs                   tests d'intégration (sqlx::test)

packages/api-client/openapi.json             généré, commité
packages/api-client/src/schema.d.ts          généré, commité
packages/api-client/src/index.ts             createApiClient, ApiError

apps/web/next.config.ts  apps/web/Dockerfile  apps/web/vitest.config.ts
apps/web/messages/fr.json
apps/web/src/i18n/request.ts
apps/web/src/lib/build-profile.ts            resolveBuildConfig()
apps/web/src/lib/auth/types.ts               AuthState, AuthContextValue
apps/web/src/lib/auth/context.tsx            AuthContext, useAuth()
apps/web/src/lib/auth/AuthProvider.tsx       choisit l'adaptateur
apps/web/src/lib/auth/adapters/{clerk,oidc,test}.tsx
apps/web/src/lib/api.ts                      useApi()
apps/web/src/components/TestModeBanner.tsx
apps/web/src/components/account/AccountGate.tsx
apps/web/src/components/support/UserModerationTable.tsx
apps/web/src/app/layout.tsx  page.tsx  login/page.tsx  dashboard/page.tsx  support/page.tsx

e2e/package.json  e2e/playwright.config.ts  e2e/global-setup.ts
e2e/fixtures.ts  e2e/tests/account.spec.ts  e2e/tests/support.spec.ts
```

---

### Task 1 : Squelette du monorepo et outillage

**Files:**
- Create: `.editorconfig`, `.gitignore`, `.gitattributes`, `rust-toolchain.toml`, `package.json`, `pnpm-workspace.yaml`, `Makefile`, `compose.dev.yml`, `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: les cibles `make` utilisées par toutes les tâches suivantes et par les skills : `setup`, `dev-db`, `api`, `web`, `seed`, `test`, `test-api`, `test-web`, `lint`, `openapi`, `spec-lint`, `e2e`, `e2e-down`.

- [ ] **Step 1 : Installer l'outillage local** (absent de la machine au moment de la rédaction)

Run: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && corepack enable && corepack prepare pnpm@latest --activate`
Expected: `cargo --version` et `pnpm --version` répondent.

- [ ] **Step 2 : Créer les fichiers racine**
  - `rust-toolchain.toml` : `channel = "stable"`, composants `rustfmt`, `clippy`.
  - `pnpm-workspace.yaml` : `packages: ["apps/web", "packages/*", "e2e"]`.
  - `package.json` racine : `"private": true`, `"packageManager": "pnpm@<version installée>"`, `"engines": {"node": ">=24"}`, script `"spec-lint": "node scripts/spec-lint.mjs"`.
  - `.gitattributes` : `* text=auto eol=lf`.
  - `.gitignore` : `target/`, `node_modules/`, `.next/`, `e2e/test-results/`, `e2e/playwright-report/`, `.env`, `.env.local`.
  - `compose.dev.yml` : un service `postgres` (image `postgres:17`, utilisateur/mot de passe/base `cartouche`, port `54320:5432`, volume nommé `cartouche-dev-db`, healthcheck `pg_isready`).
  - `.env.example` : toutes les variables du plan, commentées en français (`APP_ENV`, `DATABASE_URL`, `BIND_ADDR`, `PUBLIC_BASE_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, `ADMIN_USER_IDS`, `SIGNUP_MODE`, `SENTRY_DSN`, `CARTOUCHE_BUILD_PROFILE`, `NEXT_PUBLIC_AUTH_PROVIDER`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_OIDC_AUTHORITY`, `NEXT_PUBLIC_OIDC_CLIENT_ID`, `API_INTERNAL_URL`, `NEXT_PUBLIC_SENTRY_DSN`), avec des valeurs de développement qui fonctionnent sans Clerk.

- [ ] **Step 3 : Écrire le `Makefile`**

Cibles (les recettes des cibles API/web/e2e pointent vers des fichiers créés plus tard ; elles doivent juste être correctes) :
  - `setup` : `pnpm install && cargo fetch --manifest-path apps/api/Cargo.toml`
  - `dev-db` : `docker compose -f compose.dev.yml up -d --wait`
  - `api` : `cd apps/api && APP_ENV=development cargo run -p cartouche-api --features test-support`
  - `web` : `pnpm --filter web dev`
  - `seed` : `cd apps/api && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- seed $(or $(SCENARIO),base)`
  - `test` : `test-api test-web spec-lint`
  - `test-api` : `cd apps/api && cargo test --workspace --all-features`
  - `test-web` : `pnpm --filter web test && pnpm --filter @cartouche/api-client test`
  - `lint` : `cargo fmt --check`, `cargo clippy --workspace --all-features -- -D warnings`, `pnpm -r lint`, `pnpm -r typecheck`
  - `openapi` : `cd apps/api && UPDATE_OPENAPI=1 cargo test -p cartouche-api --test openapi && pnpm --filter @cartouche/api-client generate`
  - `spec-lint` : `node scripts/spec-lint.mjs`
  - `e2e` : `docker compose -f compose.test.yml up -d --build --wait && pnpm --filter e2e test $(ARGS)`
  - `e2e-down` : `docker compose -f compose.test.yml down -v`

- [ ] **Step 4 : Mettre à jour `README.md`** : nom du projet, pitch en une phrase (français), prérequis (Docker, Rust, Node ≥ 24, pnpm), démarrage rapide (`make setup`, `make dev-db`, `make api`, `make web`), lien vers `spec/README.md` et `CLAUDE.md`.

- [ ] **Step 5 : Vérifier**

Run: `make dev-db && docker compose -f compose.dev.yml ps`
Expected: `postgres` à l'état `healthy`.

- [ ] **Step 6 : Commit**

```bash
git add -A && git commit -m "chore: scaffold monorepo tooling"
```

---

### Task 2 : Dossier `spec/` et vérificateur de spec

**Files:**
- Create: `spec/README.md`, `spec/glossary.md`, les 13 fichiers de sujet listés en section 9 du design, `scripts/spec-lint.mjs`, `scripts/spec-lint.test.mjs`

**Interfaces:**
- Produces:
  - format d'une règle : une ligne de liste `- **XXX-NNN** — <texte>` ; règles regroupées sous des titres `##` ;
  - dans `spec/README.md`, un tableau `| Fichier | Préfixe | Sujet |` que lit le vérificateur ;
  - `node scripts/spec-lint.mjs [--coverage]` : code de sortie 0 si la spec est valide.

- [ ] **Step 1 : Écrire les tests du vérificateur** (`node:test`, sur des dossiers de fixtures temporaires)

```js
test('rejects a duplicate rule id', ...)            // deux "- **EVT-001**" → exit 1, message contient "EVT-001"
test('rejects an id whose prefix does not match its file', ...) // "- **FRM-001**" dans events.md (préfixe EVT) → exit 1
test('rejects a prefix missing from the README table', ...)
test('rejects a test citing an unknown rule', ...)  // "ACC-999" dans un *.spec.ts ou un tests/*.rs → exit 1
test('accepts a valid spec and reports uncovered rules with --coverage', ...) // exit 0, stdout liste les règles non citées
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `node --test scripts/spec-lint.test.mjs`
Expected : FAIL (le module n'existe pas).

- [ ] **Step 3 : Implémenter `scripts/spec-lint.mjs`**
  - Fonction exportée `lint({ specDir, codeDirs, coverage }) -> { errors: string[], uncovered: string[] }`, plus un point d'entrée CLI.
  - Les fichiers de test analysés sont `**/*.{test,spec}.{ts,tsx}`, `**/tests/**/*.rs` et `**/src/**/*.rs` (pour les tests unitaires en ligne), en ignorant `node_modules`, `target` et `.next`. Toute occurrence de `[A-Z]{3}-\d{3}` est considérée comme une citation.
  - Node pur, sans dépendance.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run: `node --test scripts/spec-lint.test.mjs`
Expected : PASS.

- [ ] **Step 5 : Écrire la spec**
  - `spec/README.md` : le rôle de la spec (elle fait foi), le format des règles, le tableau des préfixes, la procédure de modification (une fonctionnalité ou une correction commence par la spec ; on vérifie les contradictions ; un changement de comportement est signalé au porteur), et la convention de citation dans les tests.
  - `spec/glossary.md` : la section 4 du design.
  - **Les sujets des plans 2 à 6** sont transcrits du design (sections 5, 6 et 7.5), une règle par comportement vérifiable. Chaque fichier s'ouvre sur la ligne `> Statut : spécifié, non implémenté (plan N)`.
  - **`account-auth.md` et `admin-support.md`** contiennent au minimum les règles suivantes, avec ces identifiants exacts (le texte peut être reformulé, mais pas le sens). Les règles de `admin-support.md` sur la consultation des cartes et des contacts et sur la désactivation de carte prennent les numéros suivants (ADM-006 et au-delà), avec la mention « plan 2 » ou « plan 4 ».

```
ACC-001 — Un compte Cartouche est créé à la première requête authentifiée ; il est identifié par le couple (émetteur `iss`, sujet `sub`) du jeton.
ACC-002 — Statut initial selon SIGNUP_MODE : `approval` → `pending` ; `open` → `approved` ; `closed` → refus `403 signup_closed`, aucun compte créé. Un administrateur est toujours créé `approved`, quel que soit le mode.
ACC-003 — Est administrateur l'utilisateur dont le `sub` figure dans ADMIN_USER_IDS (liste séparée par des virgules, espaces ignorés, entrées vides ignorées). C'est évalué à chaque requête, jamais stocké.
ACC-004 — Seul un compte `approved` peut utiliser les fonctions du tableau de bord. Un compte `pending`, `rejected` ou `suspended` reçoit `403` avec le code `account_pending`, `account_rejected` ou `account_suspended`, et l'interface affiche un écran dédié. `GET /api/me` reste accessible quel que soit le statut.
ACC-005 — Le statut est relu en base à chaque requête : une suspension ou une validation prend effet à la requête suivante.
ACC-006 — L'email et le nom d'affichage sont repris des claims `email` et `name` du jeton à chaque requête où ils sont présents, normalisés en NFC et sans espaces en début et fin.
ACC-007 — Sans jeton, ou avec un jeton invalide (signature, émetteur, audience si configurée, `kid` inconnu) → `401 token_invalid` ; jeton expiré → `401 token_expired` (tolérance de 60 s) ; fournisseur de clés injoignable → `503 auth_unavailable` en moins de 6 s.
ACC-008 — Le fournisseur d'authentification de test ne peut pas fonctionner en production : routes de test absentes du binaire de production ; `APP_ENV` absent ⇒ `production` ; démarrage refusé si `APP_ENV=production` et que l'émetteur est l'émetteur de test ; build web refusé si l'adaptateur de test est demandé avec le profil `production`.
ACC-009 — En `development` et en `test`, l'interface affiche en permanence un bandeau « MODE TEST ».
ADM-001 — La page de support et les routes `/api/admin/*` sont réservées aux administrateurs ; un non-administrateur reçoit `403 forbidden` et l'interface affiche « Accès réservé ».
ADM-002 — La page de support liste les utilisateurs filtrables par statut et affiche bien en évidence le nombre de comptes `pending`.
ADM-003 — Transitions de statut autorisées : `pending → approved | rejected`, `rejected → approved`, `approved → suspended`, `suspended → approved`. Toute autre transition → `409 invalid_transition`.
ADM-004 — Un administrateur ne peut pas changer le statut d'un autre administrateur, ni le sien → `403 cannot_moderate_admin`.
ADM-005 — Chaque action d'un administrateur est inscrite au journal d'audit : acteur, action, type et identifiant de la cible, métadonnées (ancien et nouveau statut), horodatage.
```

- [ ] **Step 6 : Vérifier la spec**

Run: `node scripts/spec-lint.mjs`
Expected : exit 0.

- [ ] **Step 7 : Commit**

```bash
git add spec scripts && git commit -m "docs(spec): initial product spec and spec linter"
```

---

### Task 3 : `CLAUDE.md` et agents du projet

**Files:**
- Create: `CLAUDE.md`, `.claude/agents/{explorer,planner,builder,task-reviewer,feature-reviewer,debugger,debugger-deep}.md`

**Interfaces:**
- Produces : les noms d'agents utilisés dans `CLAUDE.md` et dans les skills.

- [ ] **Step 1 : Écrire `CLAUDE.md`** (en français, concis), avec :
  - la carte du dépôt ;
  - les commandes `make` ;
  - le cycle de travail obligatoire :
    1. `planner` met à jour `spec/` et vérifie les contradictions ;
    2. plan de tâches ;
    3. `builder` en TDD ;
    4. `task-reviewer` après chaque tâche ;
    5. `make test`, puis `make e2e` ;
    6. `feature-reviewer` en fin de fonctionnalité ;
    7. un bug part toujours d'un test qui le reproduit (`debugger`, puis `debugger-deep` si le premier échoue deux fois) ;
  - les règles de qualité :
    - aucune logique métier dans les handlers ni dans les composants (elle va dans `cartouche-domain` ou dans `apps/web/src/lib`) ;
    - toute dépendance externe passe derrière un trait ou une interface ;
    - chaque requête utilisateur est filtrée par propriétaire dans `db/` ;
    - les tests citent leurs règles ;
    - aucun texte d'interface en dur ;
  - comment déboguer : `request_id`, logs JSON, artefacts Playwright ;
  - la liste des agents et des skills.

- [ ] **Step 2 : Écrire les 7 agents.** Frontmatter : `name`, `description` (quand l'utiliser), `model`, `effort` et `tools`. Le corps donne le rôle, ce que l'agent doit lire en premier (`CLAUDE.md`, les fichiers `spec/` concernés), ce qu'il produit et ce qu'il ne doit pas faire.

| name | model | effort | tools |
|---|---|---|---|
| explorer | claude-haiku-5-5 | — | Read, Grep, Glob, Bash (lecture seule) |
| planner | claude-opus-5-5 | high | Read, Grep, Glob, Bash, Edit, Write (`spec/` et `docs/` seulement) |
| builder | claude-sonnet-5-5 | medium | tous |
| task-reviewer | claude-sonnet-5-5 | high | Read, Grep, Glob, Bash |
| feature-reviewer | claude-opus-5-5 | high | Read, Grep, Glob, Bash |
| debugger | claude-sonnet-5-5 | high | tous |
| debugger-deep | claude-opus-5-5 | high | tous |

Les deux relecteurs rendent un verdict `APPROVED` / `CHANGES_REQUESTED`, avec des constats classés par gravité. `feature-reviewer` vérifie en plus que `make test`, `make e2e` et `node scripts/spec-lint.mjs --coverage` passent, et que chaque règle nouvelle ou modifiée est citée par au moins un test.

- [ ] **Step 3 : Commit**

```bash
git add CLAUDE.md .claude/agents && git commit -m "chore: add CLAUDE.md and project agents"
```

---

### Task 4 : Crate domaine et configuration de l'API

**Files:**
- Create: `apps/api/Cargo.toml`, `apps/api/domain/{Cargo.toml,src/lib.rs,src/clock.rs,src/text.rs,src/user.rs}`, `apps/api/server/{Cargo.toml,src/lib.rs,src/config.rs,src/startup.rs}`

**Interfaces:**
- Produces (`cartouche_domain`) :
  - `trait Clock: Send + Sync { fn now(&self) -> DateTime<Utc>; }` ;
  - `struct SystemClock` ;
  - `struct ManualClock`, une horloge figée pour les tests unitaires et d'intégration : `new(DateTime<Utc>)`, `set(&self, DateTime<Utc>)` et `advance(&self, Duration)` (via un `RwLock` interne) ;
  - `struct OverridableClock`, pour les environnements `development` et `test` : `new()`, `set(&self, Option<DateTime<Utc>>)`. `now()` renvoie la valeur forcée si elle existe, sinon `Utc::now()`. Le temps continue donc d'avancer tant que personne ne le fige ;
  - `fn normalize(input: &str) -> String` (NFC + trim, crate `unicode-normalization`) ;
  - `enum UserStatus { Pending, Approved, Rejected, Suspended }`, avec `as_str()` → `"pending"`…, `FromStr`, et `serde` en snake_case ;
  - `enum SignupMode { Approval, Open, Closed }`, avec `FromStr` (`"approval"|"open"|"closed"`) ;
  - `struct SignupClosed;` · `fn initial_status(mode: SignupMode, is_admin: bool) -> Result<UserStatus, SignupClosed>` ;
  - `struct InvalidTransition { from: UserStatus, to: UserStatus }` · `fn check_transition(from: UserStatus, to: UserStatus) -> Result<(), InvalidTransition>`.
- Produces (`cartouche_api`) :
  - `enum AppEnv { Development, Test, Production }`, avec `AppEnv::parse(Option<&str>) -> AppEnv` ;
  - `struct AuthConfig { issuer: String, jwks_url: Url, audience: Option<String> }` ;
  - `struct Config { app_env, database_url: String, bind_addr: SocketAddr, public_base_url: Url, auth: AuthConfig, admin_user_ids: HashSet<String>, signup_mode: SignupMode, sentry_dsn: Option<String> }` ;
  - `Config::from_vars(get: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError>`, et `Config::from_env()` qui l'appelle avec `std::env::var` ;
  - `pub const TEST_ISSUER: &str = "cartouche-test-issuer";` · `enum StartupError { TestIssuerInProduction }` · `fn validate(config: &Config) -> Result<(), StartupError>` ;
  - `pub const TEST_SUPPORT_COMPILED: bool = cfg!(feature = "test-support");` ;
  - `fn test_routes_enabled(config: &Config) -> bool` (vrai seulement si la feature est compilée **et** `app_env` ≠ `Production`).

Les defaults de `Config::from_vars` sont : `BIND_ADDR=0.0.0.0:8080` et `SIGNUP_MODE=approval`. `DATABASE_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL` et `PUBLIC_BASE_URL` sont obligatoires ; s'il en manque une, `ConfigError::Missing(name)`.

- [ ] **Step 1 : Écrire les tests unitaires du domaine** (dans `user.rs`, `text.rs` et `clock.rs`)

```rust
// spec: ACC-002
#[test] fn approval_mode_starts_pending() { assert_eq!(initial_status(SignupMode::Approval, false), Ok(UserStatus::Pending)); }
#[test] fn open_mode_starts_approved()    { assert_eq!(initial_status(SignupMode::Open, false), Ok(UserStatus::Approved)); }
#[test] fn closed_mode_refuses()          { assert_eq!(initial_status(SignupMode::Closed, false), Err(SignupClosed)); }
#[test] fn admin_always_approved()        { for m in [Approval, Open, Closed] { assert_eq!(initial_status(m, true), Ok(UserStatus::Approved)); } }
// spec: ADM-003 — tableau exhaustif des 16 couples (from, to) : exactement 5 sont Ok
#[test] fn only_allowed_transitions_pass() { ... }
#[test] fn normalize_composes_and_trims() { assert_eq!(normalize("  E\u{0301}loi\u{0308}se "), "Éloïse"); }
#[test] fn manual_clock_advances() { ... }
#[test] fn overridable_clock_follows_system_time_until_set() { /* sans valeur forcée → proche de Utc::now() ; set(Some(t)) → t ; set(None) → de nouveau l'heure système */ }
```

- [ ] **Step 2 : Écrire les tests de configuration** (dans `config.rs` et `startup.rs`)

```rust
#[test] fn missing_app_env_means_production()  { assert_eq!(AppEnv::parse(None), AppEnv::Production); }
#[test] fn invalid_app_env_means_production()  { assert_eq!(AppEnv::parse(Some("dev")), AppEnv::Production); }
// spec: ACC-003
#[test] fn admin_ids_are_trimmed_and_empty_entries_dropped() {
    let c = Config::from_vars(vars(&[("ADMIN_USER_IDS", " a , b,, ")])).unwrap();
    assert_eq!(c.admin_user_ids, HashSet::from(["a".into(), "b".into()]));
}
#[test] fn empty_admin_ids_means_no_admin() { ... }
#[test] fn missing_database_url_is_an_error() { ... }
// spec: ACC-008
#[test] fn test_issuer_in_production_refuses_to_start() { ... validate(&c) == Err(StartupError::TestIssuerInProduction) }
#[test] fn test_issuer_in_test_env_is_allowed() { ... }
#[test] fn test_routes_disabled_in_production_even_if_compiled() { ... }
```

- [ ] **Step 3 : Lancer les tests et vérifier qu'ils échouent**

Run: `cd apps/api && cargo test --workspace`
Expected : erreurs de compilation (symboles absents).

- [ ] **Step 4 : Implémenter les signatures ci-dessus.** `cartouche-domain` ne dépend que de `chrono`, `serde`, `thiserror` et `unicode-normalization`, sans aucune dépendance d'I/O. `cartouche-api` déclare `[features] test-support = []` (pas dans `default`).

- [ ] **Step 5 : Lancer les tests et vérifier qu'ils passent**

Run: `cd apps/api && cargo test --workspace --all-features`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/api && git commit -m "feat(api): domain crate and configuration with production-safe defaults"
```

---

### Task 5 : Serveur HTTP, `request_id`, erreurs, télémétrie, base de données

**Files:**
- Create: `apps/api/server/src/{main.rs,telemetry.rs,error.rs,state.rs,app.rs,routes/health.rs,db/mod.rs}`, `apps/api/server/migrations/0001_users.sql`, `apps/api/server/migrations/0002_audit_log.sql`, `apps/api/server/tests/common/mod.rs`, `apps/api/server/tests/health.rs`

**Interfaces:**
- Consumes : `Config`, `validate`, `Clock` (tâche 4).
- Produces :
  - `struct AppState { db: PgPool, config: Arc<Config>, clock: Arc<dyn Clock> }`. La tâche 6 y ajoute `verifier: Arc<dyn TokenVerifier>`, et la tâche 9 `test_clock: Option<Arc<OverridableClock>>` (sous `cfg(feature = "test-support")`) ;
  - `fn build_router(state: AppState) -> Router` ;
  - `enum ApiError` avec `code() -> &'static str`, `status() -> StatusCode` et `impl IntoResponse`, qui lit le `request_id` dans les extensions de la requête ;
  - `struct RequestId(pub String)`, inséré dans les extensions par la couche request-id ;
  - `tests/common/mod.rs` : `async fn test_app(pool: PgPool) -> TestApp` et `TestApp::request(method, path, Option<token>, Option<json>) -> TestResponse { status, headers, json }`. Ce harnais sert à tous les tests d'intégration suivants. Il utilise une `ManualClock`, et un `StaticKeySource` dès que la tâche 6 existe.
- Migrations :
  - `users(id uuid primary key default gen_random_uuid(), issuer text not null, subject text not null, email text, display_name text, status text not null check (status in ('pending','approved','rejected','suspended')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (issuer, subject))` ;
  - `audit_log(id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references users(id), action text not null, target_type text not null, target_id uuid not null, metadata jsonb not null default '{}', created_at timestamptz not null default now())`, avec un index sur `(target_type, target_id)`.

- [ ] **Step 1 : Écrire les tests d'intégration** (`tests/health.rs`, `#[sqlx::test(migrations = "./migrations")]`)

```rust
#[sqlx::test] async fn health_reports_ok_with_db(pool: PgPool) { /* GET /api/health → 200, json == {"status":"ok","db":"ok"} */ }
#[sqlx::test] async fn request_id_is_echoed_when_valid(pool: PgPool) { /* x-request-id: abc-123 → réponse x-request-id == "abc-123" */ }
#[sqlx::test] async fn request_id_is_generated_when_invalid(pool: PgPool) { /* x-request-id: "bad id!" → réponse contient un UUID différent */ }
#[sqlx::test] async fn unknown_route_returns_json_error_with_request_id(pool: PgPool) {
    /* GET /api/nope → 404, json.error.code == "not_found", json.error.request_id == header x-request-id */
}
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `make dev-db && cd apps/api && DATABASE_URL=postgres://cartouche:cartouche@localhost:54320/cartouche cargo test -p cartouche-api --test health`
Expected : FAIL (compilation).

- [ ] **Step 3 : Implémenter.**
  - Couche request-id : `tower-http` `SetRequestIdLayer` avec un `MakeRequestId` personnalisé, qui valide l'en-tête entrant selon la règle des Global Constraints, puis `PropagateRequestIdLayer`.
  - `TraceLayer` : un span par requête avec `request_id`, `method`, `path`, puis `status` et `latency_ms`.
  - `telemetry::init(config)` choisit le format des logs selon `app_env`, puis initialise Sentry si un DSN est présent, avec le tag `request_id` sur le scope de la requête.
  - `main.rs` enchaîne :
    1. `Config::from_env()` ;
    2. `validate()` : en cas d'erreur, log `error` et `std::process::exit(1)` ;
    3. log `info` de démarrage avec `app_env`, `auth_issuer`, `test_support_compiled` et `test_routes_enabled` ;
    4. connexion au pool ;
    5. `sqlx::migrate!()` ;
    6. serve.
  - Le fallback renvoie `ApiError::NotFound`.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run: `cd apps/api && cargo test -p cartouche-api --test health`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api && git commit -m "feat(api): http server with request ids, json errors, telemetry, migrations"
```

---

### Task 6 : Vérification des jetons (JWT / JWKS)

**Files:**
- Create: `apps/api/server/src/auth/{mod.rs,verifier.rs,keys.rs}`, `apps/api/server/tests/auth_verifier.rs`

**Interfaces:**
- Produces :
  - `struct VerifiedClaims { issuer: String, subject: String, email: Option<String>, name: Option<String> }` ;
  - `enum AuthError { Missing, Invalid, Expired, Unavailable }`, convertie en `ApiError` : `token_invalid`/401 (pour `Missing` et `Invalid`), `token_expired`/401, `auth_unavailable`/503 ;
  - `#[async_trait] trait TokenVerifier: Send + Sync { async fn verify(&self, token: &str) -> Result<VerifiedClaims, AuthError>; }` ;
  - `#[async_trait] trait KeySource: Send + Sync { async fn key(&self, kid: &str) -> Result<Option<DecodingKey>, KeySourceError>; }` ;
  - `struct JwksKeySource`, avec `new(url: Url, client: reqwest::Client, ttl: Duration)` : cache en mémoire, rechargé quand le `kid` est inconnu (au plus une fois toutes les 30 s) ou quand le TTL est dépassé (1 h), avec un timeout HTTP de 5 s ;
  - `struct StaticKeySource` avec `new(Vec<(String, DecodingKey)>)`, plus une variante `failing()` qui renvoie toujours `KeySourceError` ;
  - `struct JwtVerifier<K: KeySource>` avec `new(auth: &AuthConfig, keys: K, clock: Arc<dyn Clock>)`. Il accepte RS256 et ES256, vérifie `iss` == `auth.issuer` et `aud` si `auth.audience` est défini, avec une tolérance de 60 s sur `exp`/`nbf` mesurée avec `clock.now()` et non l'heure système. Il lit les claims optionnels `email` et `name`.
- Test helper (dans `tests/common`) : `fn sign_test_token(claims: serde_json::Value) -> String`, qui signe avec la clé ES256 de test de `apps/api/server/test-keys/` (créée dans cette tâche avec `openssl ecparam -name prime256v1 -genkey`, plus un `README.md` « test only, never trusted in production »). Le `kid` est toujours `"cartouche-test-1"`, et le `StaticKeySource` du harnais expose cette même clé. L'émetteur de test de la tâche 9 réutilise ce fichier de clé (via `include_str!`) : un jeton signé dans les tests d'intégration et un jeton émis par `/api/test/token` sont interchangeables.

- [ ] **Step 1 : Écrire les tests** (`tests/auth_verifier.rs`, sans base de données)

```rust
// spec: ACC-007
#[tokio::test] async fn valid_token_yields_claims() { /* iss=TEST_ISSUER, sub="u1", email, name → Ok(claims) */ }
#[tokio::test] async fn expired_token_is_rejected_after_leeway() { /* exp = now-61s → Err(Expired) ; exp = now-30s → Ok */ }
#[tokio::test] async fn not_yet_valid_token_is_rejected() { /* nbf = now+120s → Err(Invalid) */ }
#[tokio::test] async fn wrong_issuer_is_rejected() { ... Err(Invalid) }
#[tokio::test] async fn wrong_audience_is_rejected_when_configured() { ... }
#[tokio::test] async fn audience_is_ignored_when_not_configured() { ... }
#[tokio::test] async fn unknown_kid_is_rejected() { ... Err(Invalid) }
#[tokio::test] async fn garbage_token_is_rejected() { ... Err(Invalid) }
#[tokio::test] async fn key_source_failure_is_unavailable() { /* StaticKeySource::failing() → Err(Unavailable) */ }
#[tokio::test] async fn jwks_endpoint_timeout_is_unavailable_within_6s() {
    /* JwksKeySource vers un serveur TCP local qui accepte la connexion sans jamais répondre ;
       tokio::time::timeout(6s, verify) → Ok(Err(Unavailable)) */
}
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `cd apps/api && cargo test -p cartouche-api --test auth_verifier`
Expected : FAIL.

- [ ] **Step 3 : Implémenter** avec `jsonwebtoken` (validation `iss`/`aud`/leeway faite à la main, avec `clock.now()`, pour rester testable) et `reqwest` (rustls).

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run: `cd apps/api && cargo test -p cartouche-api --test auth_verifier`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api && git commit -m "feat(api): provider-agnostic JWT verification with JWKS cache"
```

---

### Task 7 : Comptes utilisateurs et `GET /api/me`

**Files:**
- Create: `apps/api/server/src/db/users.rs`, `apps/api/server/src/auth/extract.rs`, `apps/api/server/src/routes/me.rs`, `apps/api/server/tests/account.rs`

**Interfaces:**
- Consumes : `TokenVerifier`, `initial_status`, `normalize`, `AppState`.
- Produces :
  - `struct User { id: Uuid, issuer: String, subject: String, email: Option<String>, display_name: Option<String>, status: UserStatus, created_at: DateTime<Utc> }` ;
  - `db::users::upsert_on_login(pool, claims: &VerifiedClaims, status_if_new: UserStatus) -> Result<User>` : un seul `INSERT … ON CONFLICT (issuer, subject) DO UPDATE SET email = coalesce(excluded.email, users.email), display_name = coalesce(excluded.display_name, users.display_name), updated_at = now() RETURNING *`. Le statut d'un compte existant n'est jamais modifié ;
  - `db::users::exists(pool, issuer, subject) -> Result<bool>` ;
  - `db::users::find_by_id(pool, id) -> Result<Option<User>>` ;
  - les extracteurs Axum :
    - `CurrentUser { user: User, is_admin: bool }`, pour tout statut. En mode `closed`, un nouveau non-administrateur reçoit `403 signup_closed` sans création de compte ;
    - `ApprovedUser(pub CurrentUser)`, qui renvoie `403 account_pending|account_rejected|account_suspended` si le compte n'est pas `approved` ;
    - `AdminUser(pub CurrentUser)`, qui renvoie `403 forbidden` si `!is_admin` ;
  - `GET /api/me` → `MeResponse { id: Uuid, email: Option<String>, display_name: Option<String>, status: UserStatus, is_admin: bool }` (utilise `CurrentUser`) ;
  - pour tester `ApprovedUser` avant que les routes du plan 2 existent : une route `GET /api/me/approved-check` qui renvoie `204`, compilée seulement avec `test-support`.

- [ ] **Step 1 : Écrire les tests d'intégration** (`tests/account.rs`, avec le harnais de la tâche 5 et `sign_test_token`)

```rust
// spec: ACC-001, ACC-002
#[sqlx::test] async fn first_request_creates_pending_account(pool) { /* GET /api/me → 200, status "pending", is_admin false ; 1 ligne en base */ }
#[sqlx::test] async fn open_mode_creates_approved_account(pool) { ... }
#[sqlx::test] async fn closed_mode_refuses_new_user_without_creating_row(pool) { /* 403 signup_closed ; 0 ligne */ }
#[sqlx::test] async fn closed_mode_still_lets_existing_user_in(pool) { ... }
// spec: ACC-003
#[sqlx::test] async fn admin_is_created_approved_and_flagged(pool) { /* sub ∈ ADMIN_USER_IDS → status approved, is_admin true */ }
#[sqlx::test] async fn admin_flag_follows_config_not_db(pool) { /* même utilisateur, config sans lui → is_admin false */ }
// spec: ACC-006
#[sqlx::test] async fn claims_are_normalized_and_refreshed(pool) {
    /* name "  Carole Lefe\u{0300}vre " → display_name "Carole Lefèvre" ; une 2e requête avec un nouvel email met l'email à jour ; une requête sans claim email le conserve */
}
// spec: ACC-001 (Review Focus 3)
#[sqlx::test] async fn concurrent_first_requests_create_one_account(pool) { /* 10 GET /api/me en parallèle (join_all) → tous 200, même id, 1 ligne */ }
// spec: ACC-004
#[sqlx::test] async fn pending_user_is_blocked_from_approved_routes(pool) { /* GET /api/me/approved-check → 403 account_pending */ }
// spec: ACC-005 (Review Focus 5)
#[sqlx::test] async fn suspension_applies_on_next_request(pool) { /* approved → 204 ; UPDATE status='suspended' ; même jeton → 403 account_suspended */ }
// spec: ACC-007
#[sqlx::test] async fn missing_token_is_401(pool) { ... token_invalid }
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `cd apps/api && cargo test -p cartouche-api --all-features --test account`
Expected : FAIL.

- [ ] **Step 3 : Implémenter.** L'extracteur `CurrentUser` enchaîne :
  1. lecture de `Authorization: Bearer` ;
  2. `verify` ;
  3. `is_admin = config.admin_user_ids.contains(&claims.subject)` ;
  4. si le mode est `closed`, que l'utilisateur n'est pas administrateur et que `!exists` → `signup_closed` ;
  5. `upsert_on_login(claims normalisés, initial_status(...))`.

  Ajoute `tracing::Span::current().record("user_id", …)`.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run: `cd apps/api && cargo test -p cartouche-api --all-features --test account`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api && git commit -m "feat(api): user accounts with signup modes and status gating"
```

---

### Task 8 : Routes de support (administration des comptes) et journal d'audit

**Files:**
- Create: `apps/api/server/src/db/audit.rs`, `apps/api/server/src/routes/admin_users.rs`, `apps/api/server/tests/admin_users.rs`
- Modify: `apps/api/server/src/db/users.rs` (ajouter `list_by_status` et `set_status`)

**Interfaces:**
- Consumes : `AdminUser`, `check_transition`.
- Produces :
  - `struct AuditEntry { actor_user_id: Uuid, action: &'static str, target_type: &'static str, target_id: Uuid, metadata: serde_json::Value }` · `db::audit::record(tx: &mut PgConnection, entry: AuditEntry) -> Result<()>` ;
  - `db::users::list_by_status(pool, Option<UserStatus>) -> Result<Vec<User>>` (tri par `created_at` décroissant) ;
  - `db::users::count_by_status(pool) -> Result<HashMap<UserStatus, i64>>` ;
  - `db::users::set_status(tx, id, UserStatus) -> Result<User>` ;
  - `GET /api/admin/users?status=<status>` → `AdminUserList { users: Vec<AdminUserView>, counts: StatusCounts { pending, approved, rejected, suspended } }` ;
  - `AdminUserView { id, email, display_name, subject, status, is_admin, created_at }` ;
  - `POST /api/admin/users/{id}/status` avec le corps `{ "status": "<status>" }` → `AdminUserView`. Erreurs : `404 not_found`, `409 invalid_transition`, `403 cannot_moderate_admin`. Le changement de statut et l'écriture d'audit (action `user.status_changed`, metadata `{"from":…,"to":…}`) se font dans **une même transaction**.

- [ ] **Step 1 : Écrire les tests d'intégration**

```rust
// spec: ADM-001
#[sqlx::test] async fn non_admin_gets_403_forbidden(pool) { ... }
// spec: ADM-002
#[sqlx::test] async fn admin_lists_users_filtered_with_counts(pool) { /* 2 pending, 1 approved → ?status=pending renvoie 2 utilisateurs ; counts.pending == 2 */ }
// spec: ADM-003
#[sqlx::test] async fn admin_approves_pending_user(pool) { /* → 200 status approved ; l'utilisateur passe /api/me/approved-check */ }
#[sqlx::test] async fn forbidden_transition_is_409(pool) { /* pending → suspended → 409 invalid_transition, statut inchangé */ }
#[sqlx::test] async fn unknown_user_is_404(pool) { ... }
// spec: ADM-004
#[sqlx::test] async fn admin_cannot_moderate_an_admin(pool) { ... 403 cannot_moderate_admin }
// spec: ADM-005
#[sqlx::test] async fn status_change_writes_audit_entry(pool) { /* 1 ligne audit_log : actor = admin, action "user.status_changed", metadata {from:"pending",to:"approved"} */ }
#[sqlx::test] async fn failed_change_writes_no_audit_entry(pool) { ... }
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Run: `cd apps/api && cargo test -p cartouche-api --all-features --test admin_users` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent.** Même commande · Expected : PASS.
- [ ] **Step 5 : Commit**

```bash
git add apps/api && git commit -m "feat(api): admin user moderation with audit log"
```

---

### Task 9 : Support de test (`test-support`) : émetteur, horloge, seed

**Files:**
- Create: `apps/api/server/src/test_support/{mod.rs,issuer.rs,routes.rs,seed.rs}`, `apps/api/server/src/bin/cartouche-seed.rs`, `apps/api/server/tests/test_support.rs`
- Modify: `apps/api/server/src/app.rs` (monter les routes si `test_routes_enabled`), `apps/api/server/src/main.rs` (en `development`/`test`, l'horloge de l'état est une `Arc<OverridableClock>`, partagée avec les routes de test ; en `production`, une `SystemClock`), `apps/api/server/Cargo.toml` (`[[bin]] name = "cartouche-seed", required-features = ["test-support"]`)

**Interfaces:**
- Produces (tout est sous `#[cfg(feature = "test-support")]`) :
  - `GET /api/test/jwks.json` : le JWKS de la clé ES256 de test (`kid = "cartouche-test-1"`) ;
  - `POST /api/test/token` avec le corps `{ subject: String, email?: String, name?: String, expires_in_secs?: u64 }` (défaut 3600) → `{ token: String }`, avec `iss = TEST_ISSUER`, signé par la clé de test, `iat` et `exp` pris sur l'horloge de l'état ;
  - `POST /api/test/reset` : `TRUNCATE audit_log, users RESTART IDENTITY CASCADE` (la liste des tables grandira dans les plans suivants ; garde-la dans une seule constante `RESET_TABLES`) → `204` ;
  - `POST /api/test/seed` avec le corps `{ scenario: String }` → `{ users: [{ subject, status }] }`, ou `404 unknown_scenario` ;
  - `POST /api/test/clock` avec le corps `{ now: RFC3339 | null }` : appelle `OverridableClock::set` (une valeur fige l'horloge, `null` la remet sur l'heure système) → `{ now }` ;
  - `seed::SCENARIOS: &[(&str, fn(&PgPool) -> BoxFuture<Result<SeedReport>>)]`. Scénario `base` :

| subject | name | email | status |
|---|---|---|---|
| seed-admin | Ada Admin | ada@example.test | approved |
| seed-alice | Alice Durand | alice@example.test | approved |
| seed-bob | Bob Martin | bob@example.test | approved |
| seed-carol | Carole Lefèvre | carole@example.test | pending |
| seed-dan | Dan Moreau | dan@example.test | suspended |
| seed-erin | Érin D'Aubigné-Müller | erin@example.test | rejected |

    Tous avec `issuer = TEST_ISSUER`.
  - Binaire `cartouche-seed <reset | seed <scenario> | list>`, qui lit `DATABASE_URL` et appelle les mêmes fonctions que les routes ;
  - `TestApp` (tâche 5) gagne `TestApp::seed(name)`.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: ACC-008
#[sqlx::test] async fn token_from_test_issuer_authenticates(pool) { /* POST /api/test/token {subject:"x"} → GET /api/me avec ce jeton → 200 */ }
#[sqlx::test] async fn jwks_exposes_test_key(pool) { /* keys[0].kid == "cartouche-test-1" */ }
#[sqlx::test] async fn seed_base_creates_expected_users(pool) { /* 6 utilisateurs avec les statuts du tableau */ }
#[sqlx::test] async fn reset_empties_tables(pool) { ... }
#[sqlx::test] async fn unknown_scenario_is_404(pool) { ... }
#[sqlx::test] async fn clock_controls_token_expiry(pool) { /* token expires_in 60 ; POST clock now+10min → /api/me → 401 token_expired */ }
#[sqlx::test] async fn test_routes_absent_in_production_env(pool) { /* app construite avec APP_ENV=production → POST /api/test/token → 404 */ }
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Run: `cd apps/api && cargo test -p cartouche-api --all-features --test test_support` · Expected : FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent.** Même commande · Expected : PASS. Puis `cargo build -p cartouche-api` (**sans** feature) doit compiler, et `cargo build -p cartouche-api --bin cartouche-seed` doit échouer avec « requires the features: test-support ».
- [ ] **Step 5 : Commit**

```bash
git add apps/api && git commit -m "feat(api): feature-gated test issuer, controllable clock and seed scenarios"
```

---

### Task 10 : Contrat OpenAPI et client TypeScript généré

**Files:**
- Create: `apps/api/server/tests/openapi.rs`, `packages/api-client/{package.json,tsconfig.json,src/index.ts,src/index.test.ts,openapi.json,src/schema.d.ts}`
- Modify: `apps/api/server/src/app.rs`, les routes (annotations `#[utoipa::path]` et `ToSchema`)

**Interfaces:**
- Produces :
  - `GET /api/openapi.json`. Les routes `/api/test/*` en sont **exclues** : le contrat public ne les mentionne pas ;
  - package `@cartouche/api-client` avec les scripts `generate` (`openapi-typescript openapi.json -o src/schema.d.ts`), `test` (vitest) et `typecheck` ;
  - `export type { paths, components } from './schema'` ;
  - `export class ApiError extends Error { status: number; code: string; requestId: string | null }` ;
  - `export function createApiClient(opts: { baseUrl: string; getToken: () => Promise<string | null> }): Client<paths>` (openapi-fetch). Un middleware ajoute `Authorization: Bearer` si un jeton existe et un `x-request-id` (UUID v4) à chaque requête. Pour toute réponse non 2xx, il lève une `ApiError` construite depuis le corps `error` ; si le corps n'est pas du JSON, `code = "unknown"` et `requestId` vient de l'en-tête.

- [ ] **Step 1 : Écrire le test de dérive du contrat** (`tests/openapi.rs`)

```rust
#[test] fn openapi_is_up_to_date() {
    // génère le document ; si UPDATE_OPENAPI=1, écrit ../../../packages/api-client/openapi.json et réussit ;
    // sinon, compare au fichier commité et échoue avec : "OpenAPI drift: run `make openapi`"
}
#[test] fn openapi_excludes_test_routes() { /* aucune clé de paths ne commence par /api/test */ }
```

- [ ] **Step 2 : Écrire les tests du client** (`src/index.test.ts`, fetch mocké)

```ts
test('adds bearer token and request id', ...)        // l'en-tête Authorization vaut "Bearer t", x-request-id correspond à un UUID
test('omits Authorization when no token', ...)
test('throws ApiError with code and requestId from error body', ...) // 403 {error:{code:"account_pending",request_id:"r1"}} → code "account_pending", requestId "r1"
test('falls back to header request id on non-JSON error', ...)
```

- [ ] **Step 3 : Lancer les tests et vérifier qu'ils échouent.** Run: `cd apps/api && cargo test -p cartouche-api --test openapi` et `pnpm --filter @cartouche/api-client test` · Expected : FAIL.
- [ ] **Step 4 : Implémenter**, puis lancer `make openapi` pour produire `openapi.json` et `schema.d.ts`.
- [ ] **Step 5 : Lancer les tests et vérifier qu'ils passent.** Mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit**

```bash
git add apps/api packages/api-client && git commit -m "feat: OpenAPI contract and generated TypeScript client"
```

---

### Task 11 : Squelette Next.js, i18n, profil de build

**Files:**
- Create: `apps/web/{package.json,next.config.ts,tsconfig.json,vitest.config.ts,vitest.setup.ts,eslint.config.mjs,postcss.config.mjs,components.json}`, `apps/web/messages/fr.json`, `apps/web/src/i18n/request.ts`, `apps/web/src/lib/build-profile.ts`, `apps/web/src/lib/build-profile.test.ts`, `apps/web/src/components/TestModeBanner.tsx`, `apps/web/src/components/TestModeBanner.test.tsx`, `apps/web/src/app/{layout.tsx,page.tsx,globals.css}`

**Interfaces:**
- Produces :
  - `type BuildProfile = 'development' | 'test' | 'production'` · `type AuthProviderName = 'clerk' | 'oidc' | 'test'` ;
  - `resolveBuildConfig(env: { profile?: string; authProvider?: string }): { profile: BuildProfile; authProvider: AuthProviderName }`, avec ces règles :
    - profil absent ou inconnu ⇒ `production` ;
    - fournisseur absent ⇒ `clerk` ;
    - fournisseur inconnu ⇒ erreur ;
    - `test` + `production` ⇒ erreur `"The test auth provider cannot be used with the production build profile"` ;
  - `next.config.ts` appelle `resolveBuildConfig({ profile: process.env.CARTOUCHE_BUILD_PROFILE, authProvider: process.env.NEXT_PUBLIC_AUTH_PROVIDER })` au chargement : le build échoue si c'est invalide. La valeur résolue est exposée via `env: { NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE }`. Il active `output: 'standalone'`, ajoute une réécriture `/api/:path*` → `${API_INTERNAL_URL}/api/:path*`, et applique le plugin next-intl ;
  - `<TestModeBanner />` : rend `t('testMode.banner')` (« MODE TEST — données fictives ») si le profil vaut `development` ou `test`, rien sinon ;
  - page `/` : un titre et une accroche tirés de `fr.json`, et un lien « Se connecter » vers `/login`. C'est un contenu provisoire, la landing réelle vient au plan 6.
  - shadcn/ui initialisé (`components.json`, `src/components/ui/`), avec les composants `button`, `card`, `table`, `badge`, `tabs` et `alert`.
  - Sentry : `@sentry/nextjs` est initialisé seulement si `NEXT_PUBLIC_SENTRY_DSN` est défini. Dans la tâche 12, `useApi()` capture chaque `ApiError` dans Sentry avec son `requestId` en tag (`request_id`). Le package `@cartouche/api-client` reste sans dépendance à Sentry, pour relier une erreur frontend aux logs de l'API.

- [ ] **Step 1 : Écrire les tests**

```ts
// build-profile.test.ts — spec: ACC-008
test('defaults to production profile and clerk provider', ...)
test('unknown profile falls back to production', ...)
test('rejects test provider with production profile', ...)  // toThrow(/cannot be used with the production build profile/)
test('allows test provider with test and development profiles', ...)
test('rejects unknown provider', ...)
// TestModeBanner.test.tsx — spec: ACC-009
test('ACC-009: shows banner in test profile', ...)
test('ACC-009: hides banner in production profile', ...)
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Run: `pnpm --filter web test` · Expected : FAIL.
- [ ] **Step 3 : Implémenter.** Scripts `dev`, `build`, `start`, `test` (vitest run), `lint`, `typecheck` (`tsc --noEmit`).
- [ ] **Step 4 : Vérifier**

Run: `pnpm --filter web test && CARTOUCHE_BUILD_PROFILE=production NEXT_PUBLIC_AUTH_PROVIDER=test pnpm --filter web build`
Expected : les tests passent ; le build **échoue** avec le message ci-dessus. Puis `CARTOUCHE_BUILD_PROFILE=test NEXT_PUBLIC_AUTH_PROVIDER=test pnpm --filter web build` réussit.

- [ ] **Step 5 : Commit**

```bash
git add apps/web pnpm-lock.yaml && git commit -m "feat(web): Next.js skeleton with i18n and guarded build profile"
```

---

### Task 12 : Module d'authentification du frontend (Clerk, OIDC, test)

**Files:**
- Create: `apps/web/src/lib/auth/{types.ts,context.tsx,AuthProvider.tsx,adapters/clerk.tsx,adapters/oidc.tsx,adapters/test.tsx}`, `apps/web/src/lib/auth/adapters/test.test.tsx`, `apps/web/src/lib/auth/AuthProvider.test.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/auth/callback/page.tsx`
- Modify: `apps/web/src/app/layout.tsx` (envelopper dans `<AuthProvider>`)

**Interfaces:**
- Consumes : `resolveBuildConfig`, `createApiClient`.
- Produces :
  - `interface AuthUser { subject: string; email?: string; name?: string }` ;
  - `interface AuthContextValue { status: 'loading' | 'signed-in' | 'signed-out'; user: AuthUser | null; getToken(): Promise<string | null>; signIn(opts?: { subject?: string }): Promise<void>; signOut(): Promise<void> }` ;
  - `useAuth(): AuthContextValue` (lève une erreur hors du provider) ;
  - `<AuthProvider>` : choisit `ClerkAuthAdapter`, `OidcAuthAdapter` ou `TestAuthAdapter` selon `NEXT_PUBLIC_AUTH_PROVIDER`. Chaque adaptateur est un composant qui remplit `AuthContext`. Les adaptateurs non choisis sont chargés par `next/dynamic` ; l'adaptateur de test est importé derrière la condition `process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE !== 'production'`, pour qu'il soit éliminé du bundle de production ;
  - `TestAuthAdapter` : jeton stocké dans `sessionStorage['cartouche.test.token']`, sujet dans `sessionStorage['cartouche.test.subject']`. `signIn({ subject })` appelle `POST /api/test/token` (avec email et nom si le sujet fait partie du scénario `base`) ;
  - `ClerkAuthAdapter` : `ClerkProvider` + `useAuth` / `useUser` de `@clerk/nextjs`. `getToken()` renvoie le jeton de session ; `signIn()` redirige vers `/login`, qui affiche `<SignIn />` ;
  - `OidcAuthAdapter` : `UserManager` d'oidc-client-ts (Authorization Code + PKCE ; authority et client_id lus dans les variables d'environnement ; `redirect_uri` = `/auth/callback`). `getToken()` renvoie l'`access_token` ;
  - `useApi()` dans `src/lib/api.ts` : un `createApiClient({ baseUrl: '', getToken })` mémorisé ;
  - `/login` : selon l'adaptateur, `<SignIn/>` de Clerk, une redirection OIDC, ou en test un bouton par utilisateur du scénario `base` (`data-testid="login-as-<subject>"`) plus un champ « sujet libre ».

- [ ] **Step 1 : Écrire les tests**

```ts
// adapters/test.test.tsx
test('signIn stores token from /api/test/token and exposes user', ...) // fetch mocké → status 'signed-in', getToken() === 'tok'
test('signOut clears session storage', ...)
test('restores session from sessionStorage on mount', ...)
// AuthProvider.test.tsx
test('useAuth outside provider throws', ...)
test('selects test adapter when NEXT_PUBLIC_AUTH_PROVIDER=test', ...)
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Run: `pnpm --filter web test` · Expected : FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**, puis contrôler l'élimination du code de test : `CARTOUCHE_BUILD_PROFILE=production NEXT_PUBLIC_AUTH_PROVIDER=clerk NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_x pnpm --filter web build && ! grep -r "cartouche.test.token" apps/web/.next/static` · Expected : la commande réussit (aucune trace de l'adaptateur de test dans le bundle client).
- [ ] **Step 5 : Commit**

```bash
git add apps/web && git commit -m "feat(web): pluggable auth module with clerk, oidc and test adapters"
```

---

### Task 13 : Écrans de compte et page de support

**Files:**
- Create: `apps/web/src/components/account/AccountGate.tsx`, `apps/web/src/components/account/AccountGate.test.tsx`, `apps/web/src/components/support/UserModerationTable.tsx`, `apps/web/src/components/support/UserModerationTable.test.tsx`, `apps/web/src/lib/moderation.ts`, `apps/web/src/lib/moderation.test.ts`, `apps/web/src/app/dashboard/page.tsx`, `apps/web/src/app/support/page.tsx`
- Modify: `apps/web/messages/fr.json`

**Interfaces:**
- Consumes : `useAuth`, `useApi`, les types `MeResponse` et `AdminUserList` du client généré.
- Produces :
  - `allowedTargets(status: UserStatus): UserStatus[]` dans `src/lib/moderation.ts` : le miroir de ADM-003 côté interface, qui décide des boutons affichés (`pending → [approved, rejected]`…). Le serveur reste la référence ;
  - `<AccountGate>{children}</AccountGate>` : charge `GET /api/me`, puis affiche selon le résultat :
    - un squelette pendant le chargement ;
    - `signed-out` → redirection vers `/login` ;
    - `pending` → `data-testid="account-pending"` ;
    - `rejected` → `account-rejected` ;
    - `suspended` → `account-suspended` ;
    - `403 signup_closed` → `signup-closed` ;
    - `approved` → `children`.

    En cas d'erreur, il affiche le message avec le `requestId` (`data-testid="error-request-id"`). Il expose `me` via un contexte `useMe()` ;
  - `/dashboard` : `<AccountGate>`, puis un état vide « Aucune carte pour l'instant » (`data-testid="dashboard-empty"`) et, si `me.is_admin`, un lien vers `/support` (`data-testid="nav-support"`) ;
  - `/support` : `<AccountGate>`. Si `!me.is_admin`, il affiche « Accès réservé » (`data-testid="support-forbidden"`). Sinon :
    - des onglets par statut avec un badge de compteur (`data-testid="count-pending"`) ;
    - `<UserModerationTable>` : une ligne par utilisateur (`data-testid="user-row-<subject>"`) et des boutons d'action `data-testid="set-status-<subject>-<status>"`, uniquement pour `allowedTargets`. Les administrateurs n'ont aucune action. Après une action réussie, la liste et les compteurs se rechargent ; après une erreur, le message s'affiche avec le `requestId`.

- [ ] **Step 1 : Écrire les tests**

```ts
// moderation.test.ts — spec: ADM-003
test('ADM-003: allowed targets mirror server transitions', ...) // les 4 statuts → listes exactes
// AccountGate.test.tsx — spec: ACC-004
test.each(['pending','rejected','suspended'])('ACC-004: shows %s notice and hides children', ...)
test('ACC-004: renders children when approved', ...)
test('shows signup-closed notice on 403 signup_closed', ...)
test('shows request id on unexpected error', ...)
// UserModerationTable.test.tsx — spec: ADM-002, ADM-004
test('ADM-004: admins have no action buttons', ...)
test('ADM-002: approve calls API then reloads', ...)
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Run: `pnpm --filter web test` · Expected : FAIL.
- [ ] **Step 3 : Implémenter.** Tous les textes passent par `fr.json`, sous les clés `account.*` et `support.*`.
- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent.** Même commande · Expected : PASS.
- [ ] **Step 5 : Commit**

```bash
git add apps/web && git commit -m "feat(web): account status screens and support moderation page"
```

---

### Task 14 : Stack de test conteneurisée et Dockerfiles

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`, `compose.test.yml`, `scripts/check-prod-guard.sh`

**Interfaces:**
- Produces :
  - `apps/api/Dockerfile`, en plusieurs étapes : `cargo-chef` (planner → cook → build), puis une image d'exécution `debian:bookworm-slim` (ca-certificates, utilisateur non root). L'argument `ARG FEATURES=""` est passé en `--features "$FEATURES"` s'il est non vide. Le binaire seed est copié seulement si `FEATURES` contient `test-support`. Les migrations sont embarquées par `sqlx::migrate!` ;
  - `apps/web/Dockerfile`, en plusieurs étapes : install pnpm, puis build avec `ARG CARTOUCHE_BUILD_PROFILE=production` et `ARG NEXT_PUBLIC_AUTH_PROVIDER=clerk`, puis exécution de `.next/standalone` (utilisateur non root) ;
  - `compose.test.yml` :
    - `postgres` sur `15432` ;
    - `api` construit avec `FEATURES=test-support`, `APP_ENV=test`, `AUTH_ISSUER=cartouche-test-issuer`, `AUTH_JWKS_URL=http://localhost:8080/api/test/jwks.json` (l'API récupère son propre JWKS), `ADMIN_USER_IDS=seed-admin`, `SIGNUP_MODE=approval`, `PUBLIC_BASE_URL=http://localhost:13000`, et le port `18080:8080` ;
    - `web` construit avec `CARTOUCHE_BUILD_PROFILE=test` et `NEXT_PUBLIC_AUTH_PROVIDER=test`, `API_INTERNAL_URL=http://api:8080`, et le port `13000:3000` ;
    - des healthchecks partout (`/api/health` pour `api`) ;
  - `scripts/check-prod-guard.sh` :
    1. construit l'image API **sans** feature ;
    2. vérifie que `docker run` avec `APP_ENV=production AUTH_ISSUER=cartouche-test-issuer` sort avec un code non nul en moins de 20 s, et que ses logs contiennent `TestIssuerInProduction` ;
    3. démarre l'image avec `APP_ENV=test` et un émetteur quelconque, puis vérifie que `POST /api/test/token` renvoie `404` (routes absentes du binaire) ;
    4. sort avec 0 si tout est conforme.

- [ ] **Step 1 : Écrire les Dockerfiles et `compose.test.yml`.**
- [ ] **Step 2 : Vérifier la stack**

Run: `docker compose -f compose.test.yml up -d --build --wait && curl -s localhost:18080/api/health && curl -s -X POST localhost:18080/api/test/seed -H 'content-type: application/json' -d '{"scenario":"base"}'`
Expected : `{"status":"ok","db":"ok"}`, puis la liste des 6 utilisateurs.

- [ ] **Step 3 : Vérifier la garde de production**

Run: `bash scripts/check-prod-guard.sh`
Expected : exit 0, avec le message `prod guard OK`.

- [ ] **Step 4 : Commit**

```bash
git add apps/api/Dockerfile apps/web/Dockerfile .dockerignore compose.test.yml scripts/check-prod-guard.sh && git commit -m "build: docker images, test stack and production guard check"
```

---

### Task 15 : Harnais Playwright et parcours de compte

**Files:**
- Create: `e2e/{package.json,tsconfig.json,playwright.config.ts,global-setup.ts,fixtures.ts}`, `e2e/tests/account.spec.ts`, `e2e/tests/support.spec.ts`

**Interfaces:**
- Consumes : la stack `compose.test.yml` (web `http://localhost:13000`, API `http://localhost:18080`).
- Produces (pour tous les tests e2e des plans suivants) :
  - `playwright.config.ts` :
    - `baseURL` http://localhost:13000 ;
    - projets `mobile` (`devices['iPhone 14']`) et `desktop` (`devices['Desktop Chrome']`) ;
    - `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'` ;
    - `workers: 1` (une seule base partagée), `retries: 0` en local et 1 en CI ;
  - `global-setup.ts` : attend `/api/health` ;
  - `fixtures.ts`, qui exporte `test` et `expect` étendus avec :
    - `api` : un `APIRequestContext` vers l'API, avec `reset()`, `seed(scenario)`, `setClock(iso | null)` et `token(subject)` ;
    - `loginAs(subject)` : récupère un jeton et l'injecte via `page.addInitScript` dans `sessionStorage` (`cartouche.test.token` et `cartouche.test.subject`), avant la navigation ;
    - un fixture automatique `freshState` : `reset()` + `seed('base')` + `setClock(null)` avant chaque test ;
    - un fixture automatique `apiLogs` : note l'heure de début ; si le test échoue, lance `docker compose -f ../compose.test.yml logs api --since <début> --no-color` et attache le résultat (`testInfo.attach('api-logs', …)`).
  - Package `e2e` avec les scripts `test` (`playwright test`) et `report` (`playwright show-report`).

- [ ] **Step 1 : Écrire les tests de bout en bout**

```ts
// account.spec.ts
test('ACC-009: test mode banner is visible', ...)
test('ACC-004: pending user sees pending notice', async ({ page, loginAs }) => { await loginAs('seed-carol'); await page.goto('/dashboard'); await expect(page.getByTestId('account-pending')).toBeVisible(); })
test('ACC-004: suspended user sees suspended notice', ...)
test('ACC-004: approved user sees empty dashboard without support link', ...) // seed-alice : dashboard-empty visible, nav-support absent
test('ACC-001: brand-new subject lands on pending notice', ...) // loginAs('new-visitor-1')
test('ACC-001: login page lets a seed user sign in', ...) // /login → clic login-as-seed-alice → /dashboard
// support.spec.ts
test('ADM-001: non-admin sees access restricted', ...) // seed-alice → /support → support-forbidden
test('ADM-002: admin sees pending count', ...) // seed-admin → count-pending contient "1"
test('ADM-003: admin approves a pending user who then reaches the dashboard', ...) // clic set-status-seed-carol-approved → la ligne passe à "Validé" ; puis loginAs('seed-carol') → dashboard-empty
test('ACC-005: suspension takes effect on next load', ...) // admin suspend seed-alice ; puis seed-alice recharge /dashboard → account-suspended
```

- [ ] **Step 2 : Lancer les tests**

Run: `make e2e`
Expected : tous les tests passent, sur les projets `mobile` et `desktop`.

- [ ] **Step 3 : Vérifier le diagnostic en cas d'échec.** Casse volontairement une assertion, relance `make e2e ARGS="tests/account.spec.ts"`, puis vérifie que `e2e/test-results/` contient `trace.zip`, une capture d'écran, une vidéo et la pièce jointe `api-logs` (dans laquelle le `request_id` apparaît). Annule la modification.

- [ ] **Step 4 : Commit**

```bash
git add e2e pnpm-lock.yaml && git commit -m "test(e2e): playwright harness with seeded state and account flows"
```

---

### Task 16 : Intégration continue

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces : les jobs (sur `push` et `pull_request`) suivants :
  1. `spec` : `node --test scripts/spec-lint.test.mjs`, puis `node scripts/spec-lint.mjs` ;
  2. `api` : un service `postgres:17` ; `cargo fmt --check` ; `cargo clippy --workspace --all-features -- -D warnings` ; `cargo test --workspace --all-features` (avec `DATABASE_URL` vers le service, ce qui inclut le test de dérive OpenAPI) ; `cargo build -p cartouche-api` sans feature. Cache via `Swatinem/rust-cache` ;
  3. `web` : `pnpm install --frozen-lockfile`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`. Ensuite, le build avec `CARTOUCHE_BUILD_PROFILE=production NEXT_PUBLIC_AUTH_PROVIDER=test` **doit échouer** (étape inversée), et le build avec le profil de production et l'adaptateur `clerk` doit réussir ;
  4. `e2e` (après `api` et `web`) : `docker compose -f compose.test.yml up -d --build --wait`, installation des navigateurs Playwright, `pnpm --filter e2e test`. En cas d'échec, upload de `e2e/test-results` et `e2e/playwright-report` comme artefacts ;
  5. `prod-guard` : `bash scripts/check-prod-guard.sh`, puis le build de l'image web de production.

- [ ] **Step 1 : Écrire le workflow.**
- [ ] **Step 2 : Vérifier la syntaxe** : `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` · Expected : aucune erreur.
- [ ] **Step 3 : Commit**

```bash
git add .github && git commit -m "ci: spec, api, web, e2e and production guard jobs"
```

---

### Task 17 : Skills du projet

**Files:**
- Create: `.claude/skills/{dev-env,run-tests,debug-failure,update-spec,change-api,add-seed-scenario}/SKILL.md`
- Modify: `CLAUDE.md` (section « Skills »)

**Interfaces:**
- Consumes : les cibles `make`, les routes `/api/test/*`, les fixtures e2e, `spec-lint`.

- [ ] **Step 1 : Écrire chaque skill.** Frontmatter `name` + `description` (« Use when… », pour qu'un agent la déclenche au bon moment), puis un corps court avec les commandes exactes :
  - `dev-env` : démarrer la base de dev, l'API et le web ; seeder ; réinitialiser ; passer de l'adaptateur `test` à Clerk (variables à changer) ; piloter l'horloge (`curl -X POST localhost:8080/api/test/clock …`).
  - `run-tests` : tests ciblés (`cargo test -p cartouche-api --all-features --test <fichier> <nom>`, `pnpm --filter web test -- <motif>`, `make e2e ARGS="-g ACC-004"`) ; tests d'une règle (`grep -rn "ACC-004" apps e2e`, puis lancer les fichiers trouvés) ; la suite complète avant de conclure (`make lint test e2e`, puis `node scripts/spec-lint.mjs --coverage`).
  - `debug-failure` : la démarche de diagnostic. Écrire un test qui reproduit ; lire `x-request-id` dans l'erreur ; `docker compose -f compose.test.yml logs api | grep <request_id>` ; ouvrir une trace Playwright (`pnpm --filter e2e exec playwright show-trace <chemin>`) ; lire la pièce jointe `api-logs` ; quand passer à `debugger-deep`.
  - `update-spec` : trouver le bon fichier (tableau de `spec/README.md`) ; prendre le prochain numéro libre du préfixe ; chercher les règles liées (`grep` sur les mots-clés et les identifiants cités) ; signaler au porteur toute contradiction ou tout changement de comportement avant de coder ; lancer `node scripts/spec-lint.mjs`.
  - `change-api` : l'ordre à suivre. Migration SQLx (`apps/api/server/migrations/NNNN_<nom>.sql`) ; fonctions `db/` filtrées par propriétaire ; logique dans `cartouche-domain` ; route avec `#[utoipa::path]` ; tests d'intégration ; `make openapi` ; adaptation du frontend ; ajout des nouvelles tables à `RESET_TABLES`.
  - `add-seed-scenario` : où déclarer le scénario dans `seed.rs` ; conventions (sujets `seed-*`, données avec accents) ; l'exposer à Playwright via `api.seed('<nom>')`.
  - La skill « ajouter un template de carte » du design (section 10.2) sera écrite dans le plan 2, en même temps que le contrat des templates.
- [ ] **Step 2 : Vérifier** que chaque commande citée existe : relire chaque skill et lancer au moins `make test` et `make e2e ARGS="-g ACC-004"`.
- [ ] **Step 3 : Commit**

```bash
git add .claude/skills CLAUDE.md && git commit -m "chore: project skills for dev env, tests, debugging, spec and api changes"
```

---

### Task 18 : Vérification finale du plan 1

- [ ] **Step 1 : Lancer toute la chaîne**

Run: `make lint && make test && make e2e && bash scripts/check-prod-guard.sh && node scripts/spec-lint.mjs --coverage`
Expected : tout passe. Dans le rapport de couverture, ACC-001 à ACC-009 et ADM-001 à ADM-005 sont **toutes citées**. Les règles non couvertes appartiennent seulement aux plans 2 à 6.

- [ ] **Step 2 : Mettre à jour le statut** en tête de `spec/account-auth.md` (« implémenté (plan 1) »), et de `spec/admin-support.md` (« partiellement implémenté : ADM-001 à ADM-005 (plan 1) »).

- [ ] **Step 3 : Commit**

```bash
git add spec && git commit -m "docs(spec): mark account and support rules implemented"
```
