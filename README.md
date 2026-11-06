# Cartouche

Cartouche is an open-source digital business card application. An NFC tag or a QR code opens a card's public page: photo, contact details, links and a "save contact" button. At a trade show or an event, the same page offers a form where visitors can leave their contact details. The owner manages their cards, events and leads from a dashboard.

The user interface is currently in French; the code, documentation and spec are in English.

## Repository layout

The backend and the frontend each live in their own folder, with their own tooling. The root only holds what concerns the whole project.

```
cartouche/
├── backend/            All the Rust code (Cargo workspace)
│   ├── domain/         crate cartouche-domain: pure business logic, no I/O
│   ├── server/         crate cartouche-api: Axum API, Postgres access (SQLx), migrations, integration tests
│   ├── .sqlx/          cache of SQL queries checked at compile time (generated, committed)
│   └── Dockerfile
├── frontend/           All the TypeScript code (pnpm workspace)
│   ├── web/            Next.js site: public page, dashboard, support
│   ├── api-client/     TypeScript client generated from the API's OpenAPI document
│   └── e2e/            Playwright end-to-end tests, on the full stack
├── spec/               product specification: the reference, one numbered rule per behavior
├── docs/               initial design and implementation plans (historical, in French)
├── scripts/            spec linter, production image guard
├── Makefile            single entry point for every command
├── docker/garage/      configuration and init script of Garage, the S3 storage of the dev and test stacks
├── compose.dev.yml     development Postgres and Garage (S3 media storage)
└── compose.test.yml    full stack (Postgres, Garage, API, web) for the e2e tests
```

OpenAPI is the contract between the two sides: the API publishes it, `frontend/api-client` generates the TypeScript types from it, and CI fails if the two diverge.

## Prerequisites

- Docker (with Docker Compose)
- Stable Rust, installed through [rustup](https://rustup.rs) (the version is pinned by `backend/rust-toolchain.toml`)
- Node.js ≥ 24 and pnpm (`corepack enable`, or a direct pnpm install)
- ffmpeg and ffprobe (header videos are transcoded by the API): `brew install ffmpeg` on macOS, `apt install ffmpeg` on Debian or Ubuntu

## Quick start

```bash
make setup    # dependencies: pnpm (frontend/), cargo fetch, sqlx-cli
make dev-db   # local PostgreSQL (port 54320, or DEV_DB_PORT) and Garage, the S3 media storage (ports 3900, 3902, 3903)
make api      # Rust API on http://localhost:8080
make web      # Next.js site on http://localhost:3000
make seed     # demo data (one administrator and one user per status)
```

Locally, everything works **without Clerk**: a test authentication provider, served by the API, lets you sign in with one click as any of the demo users. To override the configuration, copy `.env.example` to `.env`.

## Useful commands

| Command | Effect |
|---|---|
| `make test` | Rust tests, SQL query check, web tests, spec check. |
| `make lint` | `cargo fmt`, `clippy`, TypeScript lint and typecheck. |
| `make e2e` | Starts the test stack in Docker and runs Playwright. |
| `make openapi` | Regenerates the OpenAPI contract and the TypeScript client. |
| `make sqlx-prepare` | Regenerates the `backend/.sqlx/` cache after a query or migration change. |

The full list is in the `Makefile` and in [`CLAUDE.md`](CLAUDE.md).

## Documentation

- Specification: [`spec/README.md`](spec/README.md)
- Contribution conventions and instructions for agents: [`CLAUDE.md`](CLAUDE.md)
- Initial design and implementation plans (historical, in French, no longer updated): [`docs/superpowers/`](docs/superpowers/)

## License

MIT, see [`LICENSE`](LICENSE).
