---
name: run-tests
description: Use when you need to run Cartouche tests: one test, the tests of a spec rule (XXX-NNN), a single package, or the full suite before concluding a task.
---

# Lancer les tests

Poste local : `export PATH="$HOME/.local/bin:$PATH"` et `source ~/.cargo/env` si besoin.

## Prérequis

- **Rust (intégration)** : les tests `#[sqlx::test]` ont besoin de la base de dev et de `DATABASE_URL`.
  ```bash
  make dev-db
  export DATABASE_URL=postgres://cartouche:cartouche@localhost:54320/cartouche
  ```
  `make test-api` / `make test` utilisent le `DATABASE_URL` par défaut du `Makefile` ; pour un `cargo test` direct, l'exporter.
- **Rust : toujours `--all-features`** (certains tests utilisent la sonde `test-support`, p. ex. `/api/test/approved-check`).
- **e2e** : Docker démarré ; les tests tournent dans le fuseau `Europe/Paris` et la langue `fr-FR` (`frontend/e2e/playwright.config.ts`), donc les heures affichées et saisies dans les tests d'événements sont des heures de Paris (une assertion de date doit en tenir compte) ; `make e2e` construit et lance la stack de test (ports 15432/18080/13000). Ne pas lancer deux `make e2e` en parallèle (base partagée).

## Un test ciblé

```bash
# Rust : fichier tests/<fichier>.rs, filtre sur le nom du test
cd backend && cargo test -p cartouche-api --all-features --test account approved_user
cd backend && cargo test -p cartouche-domain                      # logique métier pure
cd backend && cargo test -p cartouche-api --all-features --lib    # tests en ligne de src/

# Web (vitest) : motif de fichier, ou -t pour filtrer sur le nom du test
pnpm -C frontend --filter web test AccountGate
pnpm -C frontend --filter web test -t ACC-004
pnpm -C frontend --filter @cartouche/api-client test

# e2e (Playwright) : ARGS est transmis à `playwright test`
make e2e ARGS="-g ACC-004"
make e2e ARGS="tests/account.spec.ts --project=desktop"
```

N'écrivez pas `pnpm -C frontend --filter web test -- <motif>` : le `--` est transmis tel quel à vitest et le filtre est ignoré (toute la suite tourne).

## Les tests d'une règle

Un test cite sa règle (`// spec: ACC-004` en Rust, `ACC-004` dans le nom en TypeScript).

```bash
grep -rn "ACC-004" backend frontend --include='*.rs' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.next
```

Lancer ensuite chaque fichier trouvé (Rust : `--test <fichier sans .rs>` pour `backend/server/tests/<fichier>.rs`, ou `--lib` pour `src/` ; web : `pnpm -C frontend --filter web test <fichier>` ; e2e : `make e2e ARGS="-g ACC-004"`). Une règle sans test apparaît avec `node scripts/spec-lint.mjs --coverage`.

## Les tests des événements et des contacts

Règles : `EVT-*` (`spec/events.md`), `FRM-*` (`spec/event-form.md`), `ABU-*` (`spec/anti-abuse.md`), `LEA-*` (`spec/leads-exports.md`, contacts).

| Sujet | Rust (`backend/server/tests/`, `--test <fichier>`) | Web (vitest, motif de fichier) | e2e (`make e2e ARGS=…`) |
|---|---|---|---|
| Événements du propriétaire (création, durée, simultanés, code) | `events`, `db_events` ; domaine : `cargo test -p cartouche-domain` | `src/lib/events`, `src/components/events` (`EventEditor`, `EventList`) | `tests/events.spec.ts` |
| Contacts (liste, spam, suppression) | `leads`, `db_events` | `LeadList`, `src/lib/events/leads` | `tests/leads.spec.ts` |
| Page publique, formulaire, envoi | `public_events`, `public_cards`, `leads_submit` | `src/lib/event-form`, `src/components/event-form` (`LeadForm`, `EventFormPage`), `src/lib/public-event.test.ts` | `tests/event-form.spec.ts`, `tests/public-page.spec.ts` (`-g TPL-003`) |
| Limite par IP, adresse retenue, champ piège | `client_ip`, `leads_submit`, `public_events` ; fenêtre glissante : `cargo test -p cartouche-domain` | | `tests/event-form.spec.ts` (`-g ABU-`) |
| Adresses signées de médias (MED-023, MED-024) | `media` ; signature : `cargo test -p cartouche-api --all-features --lib` | | |

Ces tests dépendent de l'horloge : en Rust le harnais (`tests/common/`) fournit une horloge figée (`ManualClock`) et `request_from(ip, …)` pour fixer l'adresse du client ; en e2e, `api.seedEvents()` fige l'horloge à `EVENTS_NOW` (2027-03-15 10:00 UTC) **avant** toute connexion. Un test d'événements qui échoue avec un jeton expiré a oublié cet ordre (voir `add-seed-scenario`). Les tests de concurrence (`join_all`) vivent dans `tests/events.rs` (événements simultanés) et `tests/leads_submit.rs` (double envoi).

## La suite complète (avant de conclure une tâche)

```bash
make lint test e2e              # lint, tests unitaires + intégration + spec-lint, puis Playwright : obligatoire avant chaque push (la CI ne lance l'e2e que sur main)
node scripts/spec-lint.mjs --coverage   # règles sans test : à lire, pas bloquant
make e2e-down                   # arrête la stack de test quand on a fini
```

`make test` = `test-api` + `test-web` + `spec-lint-test` + `spec-lint`. Ne jamais annoncer « ça passe » sans avoir vu la sortie de ces commandes.
Un échec : voir la skill `debug-failure`.
