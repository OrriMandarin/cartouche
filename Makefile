# Cartouche - monorepo tooling.
# An optional root `.env` (see `.env.example`) overrides the dev defaults below.
# Keep it free of quotes: make reads it verbatim.
-include .env
export

# Dev defaults, usable without Clerk (test auth provider, test JWKS served by the API).
APP_ENV ?= development
# `#[sqlx::test]` names its databases after the test path only: two checkouts running the Rust
# tests on the same server at the same time drop each other's databases. A worktree that runs
# tests alongside others starts its own server on another port (`DEV_DB_PORT` in `.env`).
DEV_DB_PORT ?= 54320
DATABASE_URL ?= postgres://cartouche:cartouche@localhost:$(DEV_DB_PORT)/cartouche
AUTH_ISSUER ?= cartouche-test-issuer
AUTH_JWKS_URL ?= http://localhost:8080/api/test/jwks.json
PUBLIC_BASE_URL ?= http://localhost:3000
ADMIN_USER_IDS ?= seed-admin
BIND_ADDR ?= 127.0.0.1:8080
MEDIA_LOCAL_DIR ?= $(CURDIR)/.data/media
CARTOUCHE_BUILD_PROFILE ?= development
NEXT_PUBLIC_AUTH_PROVIDER ?= test
API_INTERNAL_URL ?= http://localhost:8080

# The JS workspace (web, api-client, e2e) lives in frontend/, the Rust workspace in backend/.
PNPM := pnpm --dir $(CURDIR)/frontend
SQLX_CLI_VERSION := 0.9.0
# Run against the migrated dev database; overrides the SQLX_OFFLINE default of backend/.cargo/config.toml.
SQLX_ONLINE := cd backend && cargo sqlx migrate run --source server/migrations && SQLX_OFFLINE=false cargo sqlx prepare --workspace

.PHONY: setup dev-db api web seed test test-api test-web lint openapi sqlx-prepare sqlx-check spec-lint spec-lint-test e2e e2e-down

setup:
	$(PNPM) install && cargo fetch --manifest-path backend/Cargo.toml
	cargo install sqlx-cli --locked --version $(SQLX_CLI_VERSION) --no-default-features --features postgres,rustls

dev-db:
	docker compose -f compose.dev.yml up -d --wait

api:
	cd backend && APP_ENV=development cargo run -p cartouche-api --features test-support

web:
	$(PNPM) --filter web dev

seed:
	cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- seed $(or $(SCENARIO),base)

test: test-api sqlx-check test-web spec-lint-test spec-lint

test-api:
	cd backend && cargo test --workspace --all-features

test-web:
	$(PNPM) --filter web test && $(PNPM) --filter @cartouche/api-client test

lint:
	cd backend && cargo fmt --all --check && cargo clippy --workspace --all-features -- -D warnings
	$(PNPM) -r lint
	$(PNPM) -r typecheck

openapi:
	cd backend && UPDATE_OPENAPI=1 cargo test -p cartouche-api --all-features --test openapi && $(PNPM) --filter @cartouche/api-client generate

# After adding or changing a query or a migration: regenerates the committed .sqlx/ cache.
sqlx-prepare:
	$(SQLX_ONLINE) -- --all-features --all-targets

# Fails when .sqlx/ no longer matches the queries or the migrated schema.
sqlx-check:
	$(SQLX_ONLINE) --check -- --all-features --all-targets

spec-lint:
	node scripts/spec-lint.mjs $(ARGS)

spec-lint-test:
	node --test scripts/spec-lint.test.mjs

e2e:
	docker compose -f compose.test.yml up -d --build --wait && $(PNPM) --filter e2e test $(ARGS)

e2e-down:
	docker compose -f compose.test.yml down -v
