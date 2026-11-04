# Events

> Status: implemented (plans 3 and 6)

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

## Input and limits

- **EVT-016** — The title is required (code `required`) and is at most 120 characters long; the description at most 2,000; the access code at most 32 (empty after normalization = no code). Beyond that, the field is rejected with the code `too_long`. Lengths are counted in characters after NFC normalization and trimming of leading and trailing spaces.
- **EVT-030** — The per-device limit (EVT-014) is an integer from 1 to 100; outside this range, the `device_limit` field is rejected with the code `out_of_range`.
- **EVT-017** — An end, when given, is strictly after the start; otherwise the `ends_at` field is rejected with the code `end_before_start`.
- **EVT-018** — A creation or modification that would exceed the limit of EVT-004 is rejected with `409 too_many_simultaneous_events`, and nothing is recorded. When several creations or modifications arrive at the same moment on a card, they cannot exceed the limit together.
- **EVT-019** — The limit of EVT-004 is set by the `MAX_SIMULTANEOUS_EVENTS` variable, an integer of at least 1, which is 3 when absent.
- **EVT-020** — An event is "à venir" ("upcoming") if its start is in the future, "en cours" ("in progress") according to EVT-002, and "passé" ("past") once its end is reached. The server computes this state with its own clock, never with the browser's.
- **EVT-021** — "Terminer maintenant" ("End now", EVT-006) is only possible on an event in progress; on an upcoming or past event, the request is rejected with `409 event_not_running`. After closing, the window of EVT-008 applies.

## Time zone

- **EVT-022** — The user's time zone (EVT-007) is their browser's; if the browser does not provide one, it is Europe/Paris. The dashboard names this time zone, and no other, under the title of a card's event list and next to the date fields of the event editor. The API only exchanges UTC instants in RFC 3339 format.
- **EVT-023** — An entered time that does not exist in the time zone (switch to summer time) is moved forward one hour; a time that exists twice (switch back to winter time) designates the first of the two.

## Deletion and disabled card

- **EVT-024** — Deleting an event deletes its leads. The dashboard asks for a confirmation that states their number.
- **EVT-025** — The events of a card disabled, by its owner or by support, stay listed and editable in the dashboard (see LNK-008), but are never served to the public (see LNK-007).

## Form opening

- **EVT-026** — An event's form can be viewed, unlocked with its code and submitted during the same window as EVT-008: from its start until 15 minutes after its end. Outside this window, the server rejects with `409 event_closed`.
- **EVT-027** — When the event has an access code, the server gives the browser only the event's title until a correct code has been entered: the description, the fields and the consent text are only sent afterwards. A wrong code is rejected with `403 invalid_access_code`. The code itself appears in no public response and in no log (see EVT-012).

## Device identifier

- **EVT-028** — The device identifier (EVT-015) is a random UUID created by the browser on its first visit to a form. It is kept in the `cartouche_device` cookie (path `/`, 400 days, `SameSite=Lax`) and in local storage; the browser takes the one it finds first, then writes it back to both places. It accompanies every submission.
- **EVT-029** — For EVT-014, the server counts the event's leads that carry the same device identifier, including those marked as spam; a deleted lead no longer counts. At the limit, the submission is rejected with `409 device_limit_reached`. Two simultaneous submissions from the same device cannot exceed the limit together.
