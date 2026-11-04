# Sign-up approval and support

> Status: implemented (plans 1, 2 and 4); ADM-021: plan 6

## Access and account management

- **ADM-001** — The support page and the `/api/admin/*` routes are restricted to administrators; a non-administrator receives `403 forbidden` and the interface shows "Accès réservé" ("Access restricted").
- **ADM-002** — The support page lists users, filterable by status, and prominently displays the number of `pending` accounts.
- **ADM-003** — Allowed status transitions: `pending → approved | rejected`, `rejected → approved`, `approved → suspended`, `suspended → approved`. Any other transition → `409 invalid_transition`.
- **ADM-004** — An administrator cannot change the status of another administrator, or their own → `403 cannot_moderate_admin`.

## Audit log

- **ADM-005** — Every administrator action is recorded in the audit log: actor, action, type and identifier of the target, metadata (old and new status), timestamp.
- **ADM-008** — Every time an administrator views the leads of another user, it is recorded in the audit log (who, what, when).
- **ADM-019** — For ADM-008, each request by which an administrator obtains leads (the list of an event, or the whole-card list of a card) records one audit entry before any lead is sent: action `leads.viewed`, target type `event` or `card` with its identifier, metadata holding the owner's user identifier, the card's identifier and the number of leads returned. If the entry cannot be recorded, no lead is sent. The detail view shows leads already received and records nothing more. The entry is recorded even when the administrator views their own leads through the support views; the owner dashboard routes record nothing.
- **ADM-020** — An audit entry holds no personal data of prospects: only identifiers, statuses, a slug (ADM-014) and counts.

## Viewing (read-only)

- **ADM-006** — An administrator can view, for a given user, their profile and their cards, read-only. Plan 2.
- **ADM-007** — An administrator can view, for a given user, their events and their leads, read-only.
- **ADM-016** — On a user's support page, each card leads to its events, listed read-only with their title, start, end, state and number of leads (EDI-018); each event leads to its leads, and the card to its whole-card view (LEA-013). Viewing events is not audited; viewing leads is (ADM-008).
- **ADM-017** — The support lead views show the same list, search and detail view as the owner's (LEA-013 to LEA-019), read-only, under the notice "Consultation en lecture seule, enregistrée dans le journal d'audit" ("Read-only view, recorded in the audit log").
- **ADM-018** — An administrator cannot export leads, mark them as spam or delete them: the support page offers none of these actions and no `/api/admin/*` route performs them (ADM-012).
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
