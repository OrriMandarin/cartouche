---
name: dev-env
description: Use when you need to start, reset or inspect the local Cartouche development environment (database, API, web), seed test data, switch the web auth provider between test and Clerk, or freeze/move the API clock.
---

# Environnement de développement local

Sans fichier `.env`, tout fonctionne **sans Clerk** : jetons de test, JWKS servi par l'API. Les valeurs par défaut sont dans le `Makefile` (surchargées par un `.env` racine, voir `.env.example`, sans guillemets).

Deux variables de l'API concernent les événements ; sans `.env`, les défauts s'appliquent :

| Variable | Défaut | Effet |
|---|---|---|
| `MAX_SIMULTANEOUS_EVENTS` | `3` (entier ≥ 1) | nombre maximal d'événements en cours en même temps sur une même carte (EVT-019) ; au-delà, `409 too_many_simultaneous_events` |
| `TRUSTED_PROXY_HOPS` | `1` (entier de 0 à 10) | nombre de reverse proxies de confiance devant l'API : la limite par IP (ABU-008) retient la n-ième adresse de `X-Forwarded-For` en partant de la droite. `1` derrière Caddy ; `0` quand l'API est jointe directement, auquel cas l'en-tête est ignoré et c'est l'adresse de la connexion qui compte |

Une valeur invalide empêche l'API de démarrer. Les ajouter au `.env` (décommenter dans `.env.example`) puis relancer `make api`.

Poste local : `export PATH="$HOME/.local/bin:$PATH"` (pnpm) et `source ~/.cargo/env` (cargo) si « command not found ».

## Démarrer (trois terminaux, dans cet ordre)

```bash
make setup     # une fois : pnpm install (frontend/), cargo fetch, sqlx-cli
make dev-db    # PostgreSQL de dev, port 54320
make api       # API sur :8080, feature test-support, migrations appliquées au démarrage
make web       # site sur :3000
```

Vérifier : `curl -s localhost:8080/api/health` doit répondre `{"status":"ok","db":"ok"}`.

## Médias

Par défaut (`MEDIA_STORAGE=local`), l'API écrit les médias des cartes dans `MEDIA_LOCAL_DIR` et les sert elle-même sous `/media/*`. Le `Makefile` fixe `MEDIA_LOCAL_DIR` à `.data/media` à la racine du dépôt (ignoré par git) : supprimer ce dossier pour repartir sans média. `make e2e` écrit dans `/data/media` du conteneur de l'API (perdu à `make e2e-down`). Le mode `s3` (`MEDIA_S3_*`, `MEDIA_PUBLIC_BASE_URL`) est documenté dans `.env.example`.

## Données

```bash
make seed                      # scénario « base » (administrateur + un utilisateur par statut)
make seed SCENARIO=<nom>       # autre scénario (par exemple « cards » : cartes de démonstration)
cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list    # liste des scénarios
cd backend && APP_ENV=development DATABASE_URL=postgres://cartouche:cartouche@localhost:54320/cartouche \
  cargo run -p cartouche-api --features test-support --bin cartouche-seed -- reset   # vide les tables (APP_ENV et DATABASE_URL obligatoires hors `make`)
curl -s -X POST localhost:8080/api/test/reset              # même chose, via l'API qui tourne (sans variables à exporter)
```

Le binaire de seed refuse de tourner si `APP_ENV` n'est pas `development` ou `test`.
Repartir de zéro : `docker compose -f compose.dev.yml down -v && make dev-db`.

### Les événements en local

Le scénario `events` complète `cards`, qui complète `base` : `make seed SCENARIO=events` **seul échoue** (cartes et utilisateurs introuvables). Charger les trois dans l'ordre :

```bash
make seed && make seed SCENARIO=cards && make seed SCENARIO=events
```

Les dates du scénario sont relatives à l'heure du chargement (T0) : le « Salon du Mariage », les « Portes ouvertes » et la « Démonstration en boutique » de `alice-durand` sont en cours, l'« Atelier découverte » a fini il y a 10 minutes (envois encore acceptés), la « Foire de Lyon » est à venir. Se connecter en `seed-alice` pour les voir dans le tableau de bord (page événements de la carte, liste des contacts).

Ouvrir un formulaire prospect : `http://localhost:3000/c/alice-durand/e/<id de l'événement>`, ou cliquer son bouton sur `http://localhost:3000/c/alice-durand`. Les identifiants sont fixes : les « Portes ouvertes de l'Atelier » sont `0198c8a2-0000-7000-8000-000000000002` et demandent le code d'accès **Château** (casse, espaces et accents sans importance). Au-delà de 120 envois en 10 minutes, ou de 30 codes faux, depuis la même adresse, l'API répond `429` avec `Retry-After` ; en local l'adresse est celle de la connexion (`TRUSTED_PROXY_HOPS=1` sans `X-Forwarded-For` retombe dessus). `POST /api/test/reset` remet les compteurs à zéro, mais vide aussi la base.

**Voir un événement commencer ou finir** : figer l'horloge de l'API, charger les scénarios **par l'API** (l'horloge qu'elle utilise est la figée, alors que `make seed` date à l'heure réelle), puis la déplacer :

```bash
api() { curl -s -X POST "localhost:8080/api/test/$1" -H 'content-type: application/json' -d "$2"; }
api reset '{}'; api clock '{"now":"2027-03-15T10:00:00Z"}'
api seed '{"scenario":"base"}'; api seed '{"scenario":"cards"}'; api seed '{"scenario":"events"}'
api clock '{"now":"2027-03-15T12:30:00Z"}'    # la « Démonstration » (fin à T0+2 h) est terminée, plus de bouton au rendu suivant
api clock '{"now":null}'                       # retour à l'heure réelle
```

Un jeton de connexion signé avant de déplacer l'horloge peut être expiré pour la nouvelle heure : se reconnecter (`/login`) après chaque changement. Voir « Piloter l'horloge de l'API » plus bas. Pour les tests Playwright, `api.seedEvents()` fait tout cela (voir `add-seed-scenario`).

## Se connecter en local (adaptateur `test`)

Le site propose un panneau de connexion de test sur `/login` (utilisateurs `seed-admin`, `seed-alice`, …) ; un visiteur déjà connecté qui ouvre `/login` est redirigé vers `/dashboard`. Pour un jeton à la main :

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

`now` est obligatoire (date RFC 3339 ou `null`). Les jetons émis après avoir gelé l'horloge sont datés de cet instant ; **figer l'horloge avant de signer un jeton**, sinon il est expiré (ou pas encore valide) pour la nouvelle heure. Elle pilote aussi les périodes d'événements, la grâce d'envoi de 15 minutes, la limite par IP et la validité des adresses signées de médias.

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
