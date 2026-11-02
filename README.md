# Cartouche

Cartouche est une application open source de carte de visite numérique : créez votre carte, partagez-la par lien ou QR code, et gardez le contrôle de vos informations.

## Prérequis

- Docker (avec Docker Compose)
- Rust (toolchain stable, installée via [rustup](https://rustup.rs))
- Node.js ≥ 24
- pnpm (via Corepack : `corepack enable`)

## Démarrage rapide

```bash
make setup    # installe les dépendances (pnpm + cargo fetch)
make dev-db   # démarre PostgreSQL en local (port 54320)
make api      # lance l'API Rust sur http://localhost:8080
make web      # lance le site Next.js sur http://localhost:3000
```

Par défaut, le développement local fonctionne sans Clerk, avec le fournisseur d'authentification de test. Pour surcharger la configuration, copiez `.env.example` en `.env`.

Les autres commandes utiles (`make test`, `make lint`, `make e2e`, `make seed`, `make openapi`) sont définies dans le `Makefile`.

## Documentation

- Spécification : [`spec/README.md`](spec/README.md)
- Conventions de contribution et consignes pour les agents : [`CLAUDE.md`](CLAUDE.md)

## Licence

MIT, voir [`LICENSE`](LICENSE).
