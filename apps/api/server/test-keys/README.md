# Test keys

**Test only, never trusted in production.**

These keys exist so that tests (and, behind the `test-support` feature, the local test
token issuer) can sign JWTs that the API's verifier accepts. The private keys are public
in this repository: anyone can forge a token with them.

- `es256-private.pem` / `es256-public.pem`: ES256 (P-256) key pair, `kid` is always
  `cartouche-test-1`. `jwks.json` is the matching JWK Set.
- `untrusted-es256-private.pem`: a second key that no verifier trusts, used to check that
  tokens signed by an unknown key are rejected.

- `rsa-test-private.pem` / `rsa-jwks.json`: RSA-2048 key (`kid` `cartouche-test-rsa-1`) and its
  JWK Set, to exercise RS256 (what real providers such as Clerk use). Test only as well.

Production verifies tokens against the JWKS published by the configured `AUTH_ISSUER`
(`AUTH_JWKS_URL`). The API refuses to start with the test issuer when `APP_ENV=production`.

Regenerate (the tests do not depend on the actual key material, except `jwks.json`, which
must match the public key):

```sh
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out es256-private.pem
openssl pkey -in es256-private.pem -pubout -out es256-public.pem
```
