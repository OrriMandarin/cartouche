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
- **e2e** : Docker démarré ; `make e2e` construit et lance la stack de test (ports 15432/18080/13000). Ne pas lancer deux `make e2e` en parallèle (base partagée).

## Un test ciblé

```bash
# Rust : fichier tests/<fichier>.rs, filtre sur le nom du test
cd apps/api && cargo test -p cartouche-api --all-features --test account approved_user
cd apps/api && cargo test -p cartouche-domain                      # logique métier pure
cd apps/api && cargo test -p cartouche-api --all-features --lib    # tests en ligne de src/

# Web (vitest) : motif de fichier, ou -t pour filtrer sur le nom du test
pnpm --filter web test AccountGate
pnpm --filter web test -t ACC-004
pnpm --filter @cartouche/api-client test

# e2e (Playwright) : ARGS est transmis à `playwright test`
make e2e ARGS="-g ACC-004"
make e2e ARGS="tests/account.spec.ts --project=desktop"
```

N'écrivez pas `pnpm --filter web test -- <motif>` : le `--` est transmis tel quel à vitest et le filtre est ignoré (toute la suite tourne).

## Les tests d'une règle

Un test cite sa règle (`// spec: ACC-004` en Rust, `ACC-004` dans le nom en TypeScript).

```bash
grep -rn "ACC-004" apps e2e --include='*.rs' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.next
```

Lancer ensuite chaque fichier trouvé (Rust : `--test <fichier sans .rs>` pour `apps/api/server/tests/<fichier>.rs`, ou `--lib` pour `src/` ; web : `pnpm --filter web test <fichier>` ; e2e : `make e2e ARGS="-g ACC-004"`). Une règle sans test apparaît avec `node scripts/spec-lint.mjs --coverage`.

## La suite complète (avant de conclure une tâche)

```bash
make lint test e2e              # lint, tests unitaires + intégration + spec-lint, puis Playwright
node scripts/spec-lint.mjs --coverage   # règles sans test : à lire, pas bloquant
make e2e-down                   # arrête la stack de test quand on a fini
```

`make test` = `test-api` + `test-web` + `spec-lint-test` + `spec-lint`. Ne jamais annoncer « ça passe » sans avoir vu la sortie de ces commandes.
Un échec : voir la skill `debug-failure`.
