# Cartouche

Cartouche est une application open source de carte de visite numérique. Un tag NFC ou un QR code ouvre la page publique d'une carte : photo, coordonnées, liens et bouton « enregistrer le contact ». Lors d'un salon ou d'un événement, la même page propose un formulaire pour laisser ses coordonnées. Le propriétaire gère ses cartes, ses événements et ses contacts depuis un tableau de bord.

## Organisation du dépôt

Le backend et le frontend vivent chacun dans leur dossier, avec leurs propres outils. La racine ne contient que ce qui concerne tout le projet.

```
cartouche/
├── backend/            Tout le Rust (workspace Cargo)
│   ├── domain/         crate cartouche-domain : logique métier pure, sans I/O
│   ├── server/         crate cartouche-api : API Axum, accès Postgres (SQLx), migrations, tests d'intégration
│   ├── .sqlx/          cache des requêtes SQL vérifiées à la compilation (généré, commité)
│   └── Dockerfile
├── frontend/           Tout le TypeScript (workspace pnpm)
│   ├── web/            site Next.js : page publique, tableau de bord, support
│   ├── api-client/     client TypeScript généré depuis l'OpenAPI de l'API
│   └── e2e/            tests de bout en bout Playwright, sur la stack complète
├── spec/               spécification produit : la référence, une règle numérotée par comportement
├── docs/               design initial et plans de réalisation
├── scripts/            vérificateur de la spec, garde-fou de l'image de production
├── Makefile            point d'entrée unique pour toutes les commandes
├── compose.dev.yml     Postgres de développement
└── compose.test.yml    stack complète (Postgres, API, web) pour les tests e2e
```

Le contrat entre les deux mondes est l'OpenAPI : l'API la publie, `frontend/api-client` en génère les types TypeScript, et la CI échoue si les deux divergent.

## Prérequis

- Docker (avec Docker Compose)
- Rust stable, installé via [rustup](https://rustup.rs) (la version est fixée par `backend/rust-toolchain.toml`)
- Node.js ≥ 24 et pnpm (`corepack enable`, ou une installation directe de pnpm)

## Démarrage rapide

```bash
make setup    # dépendances : pnpm (frontend/), cargo fetch, sqlx-cli
make dev-db   # PostgreSQL local (port 54320)
make api      # API Rust sur http://localhost:8080
make web      # site Next.js sur http://localhost:3000
make seed     # données de démonstration (un administrateur et un utilisateur par statut)
```

En local, tout fonctionne **sans Clerk** : un fournisseur d'authentification de test, servi par l'API, permet de se connecter en un clic avec les utilisateurs de démonstration. Pour surcharger la configuration, copiez `.env.example` en `.env`.

## Commandes utiles

| Commande | Effet |
|---|---|
| `make test` | Tests Rust, vérification des requêtes SQL, tests web, vérification de la spec. |
| `make lint` | `cargo fmt`, `clippy`, lint et typecheck TypeScript. |
| `make e2e` | Monte la stack de test dans Docker et lance Playwright. |
| `make openapi` | Régénère le contrat OpenAPI et le client TypeScript. |
| `make sqlx-prepare` | Régénère le cache `backend/.sqlx/` après un changement de requête ou de migration. |

La liste complète est dans le `Makefile` et dans [`CLAUDE.md`](CLAUDE.md).

## Documentation

- Spécification : [`spec/README.md`](spec/README.md)
- Conventions de contribution et consignes pour les agents : [`CLAUDE.md`](CLAUDE.md)

## Licence

MIT, voir [`LICENSE`](LICENSE).
