---
name: debug-failure
description: Use when a Cartouche test (Rust, vitest or Playwright) fails, an API call returns an unexpected error, or a bug is reported and you need to reproduce and diagnose it before fixing.
---

# Diagnostiquer un échec

Règle de base : **reproduire par un test d'abord, corriger ensuite.** Si le bug révèle une règle manquante ou fausse, passer par `update-spec` avant de coder.

## 1. Écrire un test qui reproduit

Au plus bas niveau qui montre le défaut : domaine (`cartouche-domain`), intégration (`apps/api/server/tests/`), composant (vitest), puis e2e seulement si le défaut est dans l'enchaînement navigateur + API. Le citer avec sa règle (`// spec: XXX-NNN` ou `XXX-NNN` dans le nom). Le voir échouer **pour la bonne raison**. Commandes : skill `run-tests`.

## 2. Suivre une requête de bout en bout

Toute réponse de l'API porte `x-request-id` ; en cas d'erreur il est aussi dans le corps : `{"error":{"code","message","request_id"}}`. Le même identifiant figure dans **chaque ligne de log** de la requête.

```bash
curl -si localhost:8080/api/me -H 'x-request-id: debug-1'      # un identifiant à soi (1 à 64 caractères [A-Za-z0-9-])
docker compose -f compose.test.yml logs api | grep <request_id>    # stack de test (logs JSON)
```

En dev (`make api`), les logs sont lisibles dans le terminal de l'API : chercher le même identifiant. Dans le navigateur, l'identifiant d'une erreur API est aussi dans l'onglet Réseau (en-tête de réponse) et dans le tag Sentry `request_id`.
Le `code` d'erreur dit déjà beaucoup : `token_invalid` / `token_expired` (401), `auth_unavailable` (503), `account_pending|rejected|suspended` (403), `internal_error` (500, détail uniquement dans les logs).

## 3. Échec Playwright

Les artefacts d'un test en échec sont dans `e2e/test-results/<dossier-du-test>/` : `trace.zip`, capture d'écran, vidéo, `api-logs.txt` (pièce jointe `api-logs` : logs de l'API pendant le test, avec les `request_id`).

```bash
ls e2e/test-results/*/
pnpm --filter e2e exec playwright show-trace test-results/<dossier-du-test>/trace.zip   # chemin relatif à e2e/ (pnpm exec s'exécute dans e2e/)
pnpm --filter e2e report                                   # rapport HTML (e2e/playwright-report)
cat e2e/test-results/<dossier-du-test>/api-logs.txt | grep <request_id>
```

Lire d'abord `api-logs.txt` (la requête en erreur et son `request_id`), puis la trace (état du DOM, requêtes réseau, console). Si le test ne trouve pas `api-logs.txt` : la stack de test est-elle bien lancée (`docker compose -f compose.test.yml ps`) ?
Relancer un seul test : `make e2e ARGS="-g <titre ou règle>"`. Si la stack garde un état douteux : `make e2e-down` puis `make e2e`.

## 4. Échec Rust / vitest

- Rust : `cd apps/api && cargo test -p cartouche-api --all-features --test <fichier> <nom> -- --nocapture`, avec `DATABASE_URL` exporté (voir `run-tests`). `RUST_BACKTRACE=1` pour la pile.
- Vitest : `pnpm --filter web test <fichier>` ; ajouter `--reporter=verbose` si besoin.

## 5. Corriger, puis élargir

Une cause identifiée (pas un symptôme), le correctif minimal, le test reproducteur passe, puis `make lint test` (et `make e2e` si le parcours navigateur est touché).

## Escalade

- Agent `debugger` d'abord (reproduit, diagnostique, corrige).
- **Si deux tentatives échouent** (le test passe puis casse ailleurs, cause non établie, comportement non déterministe, plusieurs couches en jeu) : passer à `debugger-deep`, en lui donnant le test reproducteur, les `request_id` et ce qui a déjà été essayé.
- Contradiction avec la spec ou changement de comportement nécessaire : s'arrêter et le signaler au porteur du projet.
