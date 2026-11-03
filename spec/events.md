# Events

> Status: specified, not implemented (plan 3)

## Period

- **EVT-001** — An event belongs to a card. It has a title, a description, a start date (required) and an end date (optional).
- **EVT-002** — An event is in progress if `start <= now` and (`end` is absent or `now < end`).
- **EVT-003** — An absent end means the event lasts until it is closed manually.
- **EVT-004** — A card cannot have more than 3 concurrent events at any instant. This limit is configurable in the instance configuration.
- **EVT-005** — The concurrent events limit (EVT-004) is checked on every creation and every modification, by computing the maximum overlap over the event's whole period; an absent end counts as infinity.
- **EVT-006** — The "Terminer maintenant" ("End now") button sets the event's end to the present instant.
- **EVT-007** — Dates are entered and displayed in the user's time zone (Europe/Paris by default) and stored in UTC.
- **EVT-008** — The server accepts a form submission only if the event is in progress or ended at most 15 minutes ago, so as not to lose a prospect who is in the middle of filling it in.
- **EVT-009** — The owner can edit, close and delete an event of their card.

## Access code

- **EVT-010** — An event can have an access code, optional and editable at any time. It is stored in a way that lets it be shown again to the owner.
- **EVT-011** — The access code comparison ignores case, leading and trailing spaces, and accents.
- **EVT-012** — The access code is verified by the server and is never sent to the browser.
- **EVT-013** — The access code is rechecked at submission time: if the owner changed it in the meantime, the prospect must enter the new one.

## Per-device limit

- **EVT-014** — The per-device submission limit is configurable per event; it is 1 by default, and the server rejects submissions beyond it.
- **EVT-015** — A device is recognized by a random identifier kept in a cookie and in local storage. This is a light protection, which can be bypassed in private browsing.
