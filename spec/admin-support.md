# Sign-up approval and support

> Status: implemented: ADM-001 to ADM-006 and ADM-009 to ADM-015 (plans 1 and 2); ADM-007 and ADM-008: plan 4; ADM-021: plan 6

## Access and account management

- **ADM-001** — The support page and the `/api/admin/*` routes are restricted to administrators; a non-administrator receives `403 forbidden` and the interface shows "Accès réservé" ("Access restricted").
- **ADM-002** — The support page lists users, filterable by status, and prominently displays the number of `pending` accounts.
- **ADM-003** — Allowed status transitions: `pending → approved | rejected`, `rejected → approved`, `approved → suspended`, `suspended → approved`. Any other transition → `409 invalid_transition`.
- **ADM-004** — An administrator cannot change the status of another administrator, or their own → `403 cannot_moderate_admin`.

## Audit log

- **ADM-005** — Every administrator action is recorded in the audit log: actor, action, type and identifier of the target, metadata (old and new status), timestamp.
- **ADM-008** — Every time an administrator views the leads of another user, it is recorded in the audit log (who, what, when). Plan 4.

## Viewing (read-only)

- **ADM-006** — An administrator can view, for a given user, their profile and their cards, read-only. Plan 2.
- **ADM-007** — An administrator can view, for a given user, their events and their leads, read-only. Plan 4.
- **ADM-013** — A user's support page lists their cards with their state and lets the administrator open each one read-only, even if disabled: its content is shown in the template preview (see TPL-014). Plan 2.

## Card moderation

- **ADM-009** — An administrator can disable an abusive card; disabling by support is a state distinct from the owner's (see LNK-010). Plan 2.
- **ADM-010** — Only an administrator can lift a card's disabling by support (see LNK-011). Plan 2.
- **ADM-011** — When an account is suspended, all its cards show the neutral page (see LNK-006 and LNK-027). Plan 2.
- **ADM-014** — Disabling a card by support and lifting that block are recorded in the audit log (see ADM-005), with the actions `card.support_disabled` and `card.support_enabled` and the card as target. Plan 2.
- **ADM-015** — Disabling a card already blocked by support, or lifting a block that does not exist, is refused with `409 invalid_transition`. Plan 2.

## Limits of powers

- **ADM-012** — Administrators do not modify users' content: they can only view it, disable a card, and approve, reject or suspend an account.

## Instance contact points

- **ADM-021** — The instance's support email address and the addresses of its terms of service and privacy policy are set by configuration of the web application (`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL`). Their defaults are placeholders that a production instance replaces: `support@cartouche.invalid`, `/cgu` and `/confidentialite` (see LND-004). Every "Contacter le support" ("Contact support") link of the interface opens an email to the support address.
