# Account and authentication

> Status: implemented (plans 1 and 2): ACC-001 to ACC-017; ACC-018: plan 4

## Account creation and status

- **ACC-001** — A Cartouche account is created on the first authenticated request; it is identified by the (issuer `iss`, subject `sub`) pair of the token. There is only one account per pair, even if several simultaneous requests arrive from a new user.
- **ACC-002** — The initial status depends on `SIGNUP_MODE`: `approval` → `pending`; `open` → `approved`; `closed` → refusal `403 signup_closed`, no account created. An administrator is always created `approved`, whatever the mode.
- **ACC-003** — An administrator is a user whose `sub` appears in `ADMIN_USER_IDS` (comma-separated list, spaces ignored, empty entries ignored). This is evaluated on every request, never stored. An administrator whose stored status is not `approved` (for example an account created `pending` before becoming an administrator) is set to `approved`, and that status is stored on their next request.
- **ACC-004** — Only an `approved` account can use the dashboard features. A `pending`, `rejected` or `suspended` account receives `403` with the code `account_pending`, `account_rejected` or `account_suspended`, and the interface shows a dedicated screen. `GET /api/me` remains accessible whatever the status.
- **ACC-005** — The status is re-read from the database on every request: a suspension or an approval takes effect on the next request.
- **ACC-006** — The email and the display name are taken from the token's `email` and `name` claims on every request where they are present, normalized to NFC and trimmed of leading and trailing spaces.
- **ACC-010** — A user creates their account and signs in through the identity provider, and can sign out.
- **ACC-011** — A user whose account is `pending` sees a "Ton compte est en attente de validation" ("Your account is pending approval") page and cannot create anything.
- **ACC-012** — The default sign-up mode (`SIGNUP_MODE` absent) is `approval`.

## Token verification

- **ACC-007** — No token, or an invalid token (signature, issuer, audience if configured, unknown `kid`) → `401 token_invalid`; expired token → `401 token_expired` (60 s tolerance); key provider unreachable → `503 auth_unavailable` in under 6 s.
- **ACC-013** — The backend verifies tokens using `AUTH_ISSUER`, `AUTH_JWKS_URL` and `AUTH_AUDIENCE`, with a cache of the public keys (JWKS). It only accepts tokens from a single trusted issuer and never calls Clerk's API.

## Frontend authentication module

- **ACC-014** — The frontend has an authentication module that exposes `getToken()`, `user`, `signIn()` and `signOut()`, with three implementations chosen by configuration: Clerk (default), generic OIDC (Authorization Code + PKCE) and dev/test.
- **ACC-015** — The dev/test implementation is a fake local issuer that signs its own JWTs, with a JWKS served locally; it lets you sign in with a single call as any user of the test data.

## The test provider does not exist in production

- **ACC-008** — The test authentication provider cannot work in production: test routes absent from the production binary; `APP_ENV` absent ⇒ `production`; startup refused if `APP_ENV=production` and the issuer is the test issuer; web build refused if the test adapter is requested with the `production` profile.
- **ACC-009** — In `development` and `test`, the interface permanently displays a "MODE TEST" ("TEST MODE") banner.
- **ACC-016** — At startup, the API writes the mode, the issuer and the compiled features to its logs.

## Data isolation

- **ACC-017** — A user only sees their own data: every dashboard request is filtered by the authenticated user from the persistence layer onward, and access to another user's resource returns a 404 error. Only an administrator sees everything, through the `/api/admin/*` endpoints (see ADM-001).

## Account deletion

- **ACC-018** — When a user deletes their account, all their data is deleted (slugs are then handled according to LNK-015).
