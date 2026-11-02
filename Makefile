# Cartouche - monorepo tooling.
# An optional root `.env` (see `.env.example`) overrides the dev defaults below.
# Keep it free of quotes: make reads it verbatim.
-include .env
export

# Dev defaults, usable without Clerk (test auth provider, test JWKS served by the API).
APP_ENV ?= development
DATABASE_URL ?= postgres://cartouche:cartouche@localhost:54320/cartouche
AUTH_ISSUER ?= cartouche-test-issuer
AUTH_JWKS_URL ?= http://localhost:8080/api/test/jwks.json
PUBLIC_BASE_URL ?= http://localhost:3000
ADMIN_USER_IDS ?= seed-admin
BIND_ADDR ?= 0.0.0.0:8080
CARTOUCHE_BUILD_PROFILE ?= development
NEXT_PUBLIC_AUTH_PROVIDER ?= test
API_INTERNAL_URL ?= http://localhost:8080

.PHONY: setup dev-db api web seed test test-api test-web lint openapi spec-lint e2e e2e-down

setup:
	pnpm install && cargo fetch --manifest-path apps/api/Cargo.toml

dev-db:
	docker compose -f compose.dev.yml up -d --wait

api:
	cd apps/api && APP_ENV=development cargo run -p cartouche-api --features test-support

web:
	pnpm --filter web dev

seed:
	cd apps/api && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- seed $(or $(SCENARIO),base)

test: test-api test-web spec-lint

test-api:
	cd apps/api && cargo test --workspace --all-features

test-web:
	pnpm --filter web test && pnpm --filter @cartouche/api-client test

lint:
	cd apps/api && cargo fmt --all --check && cargo clippy --workspace --all-features -- -D warnings
	pnpm -r lint
	pnpm -r typecheck

openapi:
	cd apps/api && UPDATE_OPENAPI=1 cargo test -p cartouche-api --test openapi && pnpm --filter @cartouche/api-client generate

spec-lint:
	node scripts/spec-lint.mjs

e2e:
	docker compose -f compose.test.yml up -d --build --wait && pnpm --filter e2e test $(ARGS)

e2e-down:
	docker compose -f compose.test.yml down -v
