# Dashboard and card editor

> Status: implemented (plans 2 and 3); EDI-010 and EDI-021: plan 4

## Cards

- **EDI-001** — The dashboard lets users list, create, edit, duplicate, disable, re-enable and delete cards.
- **EDI-002** — Deleting a card requires confirmation (see LNK-012).
- **EDI-012** — The card list shows, for each card, the name, the public link and the state: "Active", "Désactivée" ("Disabled") or "Désactivée par le support" ("Disabled by support") (see LNK-011).
- **EDI-013** — To create a card, the user enters a first name and a last name, then accepts or edits the suggested slug (see LNK-019). The card is created active, with the Classique ("Classic") template and the default theme, and opens in the editor.
- **EDI-014** — Duplicating a card copies its content, its links, its template, its theme, its settings and its media, under a new slug chosen by the user. Neither the former slugs, nor the events, nor the leads are copied, and the copy is active. A card disabled by support cannot be duplicated (`409 card_disabled_by_support`).

## Card editor

- **EDI-003** — The editor shows a form on the left and a live preview in a phone frame on the right; on mobile, the two are stacked.
- **EDI-004** — The preview updates on every change, without needing to save.
- **EDI-005** — A switch in the editor simulates "event in progress" in the preview.
- **EDI-006** — Changes are only published on save.
- **EDI-007** — The editor form is generated from the settings schema of the chosen template (see TPL-004).
- **EDI-008** — Strings entered in the editor are normalized to NFC before being stored.
- **EDI-015** — Saving is all-or-nothing: if any part is refused (slug taken, invalid field), nothing is modified. Each error is shown next to its field, and no input is lost.
- **EDI-016** — Leaving the editor with unsaved changes requires confirmation.
- **EDI-017** — The simulated event of EDI-005 exists only in the preview: it is never saved nor visible on the public page.

## Events and leads

- **EDI-009** — A card's page lists its events in three groups (in progress, upcoming, past) and lets users create, edit, close and delete them (see EVT-009).
- **EDI-018** — A card's event list shows, for each event, its title, its start, its end (or "Sans fin" ("No end")), its state (EVT-020) and its number of leads. It can be reached from the card list and from the card's editor.
- **EDI-019** — The event editor sets the title, the description, the start, the end, the access code (shown in clear, see EVT-010), the per-device limit, the standard fields (not asked, optional or required), the custom fields (adding, order, type, label, help text, options, required or not) and the consent text (default or custom). Each error is shown next to its field, with no input lost (see EDI-015).
- **EDI-020** — For each event, the dashboard lists its leads, from newest to oldest, with the submission date, the name, the email, the phone and the "Spam" label, and lets the owner mark or unmark a lead as spam and delete it (see ABU-003, ABU-004, ABU-009 and ABU-010). Search, the detailed view, the "toute la carte" ("whole card") view and exports come with EDI-010.
- **EDI-010** — The dashboard gives access to the leads and their exports (see LEA-001 and LEA-006).
- **EDI-021** — Leaving the event editor with unsaved changes requires confirmation, as in the card editor (EDI-016): closing or reloading the page, and following a link of the page, ask first; after a successful save, or when the changes have been undone, nothing is asked.

## Interface

- **EDI-011** — The interface is in French in v1, and all its texts go through an i18n system, so that English can be added without a rewrite.
