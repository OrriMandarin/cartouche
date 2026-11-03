---
name: dev-env
description: Use when you need to start, reset or inspect the local Cartouche development environment (database, API, web), seed test data, switch the web auth provider between test and Clerk, or freeze/move the API clock.
---

# Environnement de développement local

Sans fichier `.env`, tout fonctionne **sans Clerk** : jetons de test, JWKS servi par l'API. Les valeurs par défaut sont dans le `Makefile` (surchargées par un `.env` racine, voir `.env.example`, sans guillemets).

Poste local : `export PATH="$HOME/.local/bin:$PATH"` (pnpm) et `source ~/.cargo/env` (cargo) si « command not found ».

## Démarrer (trois terminaux, dans cet ordre)

```bash
make setup     # une fois : pnpm install + cargo fetch
make dev-db    # PostgreSQL de dev, port 54320
make api       # API sur :8080, feature test-support, migrations appliquées au démarrage
make web       # site sur :3000
```

Vérifier : `curl -s localhost:8080/api/health` doit répondre `{"status":"ok","db":"ok"}`.

## Données

```bash
make seed                      # scénario « base » (administrateur + un utilisateur par statut)
make seed SCENARIO=<nom>       # autre scénario
cd apps/api && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list    # liste des scénarios
cd apps/api && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- reset   # vide les tables
curl -s -X POST localhost:8080/api/test/reset              # même chose, via l'API qui tourne
```

Le binaire de seed refuse de tourner si `APP_ENV` n'est pas `development` ou `test`.
Repartir de zéro : `docker compose -f compose.dev.yml down -v && make dev-db`.

## Se connecter en local (adaptateur `test`)

Le site propose un panneau de connexion de test sur `/login` (utilisateurs `seed-admin`, `seed-alice`, …). Pour un jeton à la main :

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/test/token -H 'content-type: application/json' \
  -d '{"subject":"seed-alice"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s localhost:8080/api/me -H "authorization: Bearer $TOKEN"
```

Le corps accepte aussi `email`, `name`, `expires_in_secs` (max 86400).

## Piloter l'horloge de l'API

```bash
curl -s -X POST localhost:8080/api/test/clock -H 'content-type: application/json' -d '{"now":"2026-03-01T10:00:00Z"}'   # gèle l'horloge
curl -s -X POST localhost:8080/api/test/clock -H 'content-type: application/json' -d '{"now":null}'                       # revient à l'heure réelle
```

`now` est obligatoire (date RFC 3339 ou `null`). Les jetons émis après avoir gelé l'horloge sont datés de cet instant.

## Passer de l'adaptateur `test` à Clerk (ou OIDC)

Mettre ces variables dans le `.env` racine (le `Makefile` les exporte), puis relancer `make api` et `make web` :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_AUTH_PROVIDER` | `clerk` (ou `oidc`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | clés de l'instance Clerk de développement |
| `AUTH_ISSUER` | émetteur (`iss`) des jetons Clerk, ex. `https://<instance>.clerk.accounts.dev` |
| `AUTH_JWKS_URL` | `<AUTH_ISSUER>/.well-known/jwks.json` |
| `AUTH_AUDIENCE` | optionnel |
| `ADMIN_USER_IDS` | `sub` Clerk des administrateurs (séparés par des virgules) |

Pour OIDC : `NEXT_PUBLIC_OIDC_AUTHORITY` et `NEXT_PUBLIC_OIDC_CLIENT_ID` à la place des clés Clerk. Pour revenir au test : retirer ces lignes du `.env`.
Un build `CARTOUCHE_BUILD_PROFILE=production` refuse l'adaptateur `test` (ACC-008) ; ne jamais contourner.

## Ports

Dev : Postgres 54320, API 8080, web 3000. Stack de test (`make e2e`) : 15432, 18080, 13000. Les deux peuvent tourner ensemble.
