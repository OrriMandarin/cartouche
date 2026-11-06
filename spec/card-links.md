# Public card link

> Status: implemented (plans 2, 3, 4 and 6)

## Format and uniqueness

- **LNK-001** — The public link of a card has the form `https://<domain>/c/<slug>`. The slug is chosen by the user; a suggestion is made from their name.
- **LNK-002** — A slug is unique across the whole instance.
- **LNK-018** — A slug is 3 to 64 characters long: lowercase letters without accents, digits and hyphens, with no hyphen at the start or end, and no two hyphens in a row. The input is trimmed of leading and trailing spaces and lowercased before being checked; an invalid slug is rejected (`400`, field `slug`, code `invalid_slug`).
- **LNK-019** — The slug suggestion (see LNK-001) starts from the first and last name: accents removed, lowercased, every other character replaced with a hyphen, then made to conform to LNK-018 (extra hyphens removed). A hyphen and a random suffix of 6 characters (lowercase letters and digits) are appended, so that the link is hard to guess and is unique from the start; the name is shortened if needed so that the whole slug stays within 64 characters. If the suggested slug is not available (taken, reserved or blocked, LNK-032), another random suffix is drawn until one is.
- **LNK-020** — Before saving, the dashboard shows whether the entered slug is available, already taken, reserved or invalid.
- **LNK-035** — When the entered slug is taken or reserved, the dashboard proposes three available slugs, each chosen with one click: the first three available slugs of the sequence `<slug>-2`, `<slug>-3`… built from the entered slug, made to conform to LNK-018 as in LNK-019. When the slug is available or invalid, nothing is proposed.
- **LNK-021** — A link entered with uppercase letters (`/c/Alice-Durand`) permanently redirects to its lowercase form.
- **LNK-022** — Claiming a slug that belongs to another user (current slug, former slug or reserved slug) is rejected with `409 slug_taken`, without saying who owns it. When two requests claim the same available slug at the same time, only one succeeds and the other gets `409 slug_taken`.
- **LNK-023** — A slug that was never assigned shows the neutral page of a card that is not served (LNK-027), with the same HTTP status 404: a visitor cannot tell an unknown link from a disabled or deleted card.

## Slug change

- **LNK-003** — The link never breaks: when the user changes a card's slug, all former slugs of that card permanently redirect to the new one.
- **LNK-004** — A former slug stays reserved for that card: nobody else can take it.
- **LNK-024** — The permanent redirect of LNK-003 is an HTTP 308 redirect. It applies to all public addresses of the card: the page and the vCard.
- **LNK-030** — The redirects of LNK-003 and LNK-021 (page, vCard and event form) carry the `Cache-Control: no-store` header: a former slug can become its card's current slug again (LNK-025) or be attached to a new card (LNK-014), so a redirect must not stay cached.
- **LNK-025** — A card can take back one of its own former slugs, which becomes its current slug again. The former slug of a card that still exists cannot be given to another card, even one of the same owner (`409 slug_reserved`), because the first card's links would break.

## Disabling by the owner

- **LNK-005** — The owner can disable or re-enable a card at any time from the dashboard, in one click.
- **LNK-006** — The link of a disabled card shows the neutral page (LNK-027, LNK-034) instead of the card.
- **LNK-007** — On a disabled card, the vCard and the event forms are unreachable, including for an event still in progress, and the server rejects submissions.
- **LNK-008** — The data of a disabled card (content, events, leads) is kept, and remains visible and exportable in the dashboard.
- **LNK-009** — Re-enabling a card puts the same link back into service, changing nothing else.
- **LNK-026** — The public page, the vCard and the forms of a card are served only if the card is disabled neither by its owner nor by support, and if its owner's account is `approved`. In all other cases, the link shows the neutral page and the vCard responds `410 card_inactive`.
- **LNK-027** — The neutral page is the same whether the slug was never assigned (LNK-023), the card is disabled by its owner or by support, deleted, or its owner's account is suspended: it does not reveal the reason and shows no card data, not even in the OpenGraph tags. It is served with HTTP status 404 and asks search engines not to index it (`noindex`).
- **LNK-034** — The neutral page shows a broken-link pictogram, the title "Cette carte n’est pas disponible" ("This card is not available") and the text "Le lien est peut-être incorrect, ou la carte n’est plus active." ("The link may be wrong, or the card is no longer active."). It always uses the neutral theme (accent and text `#1C1C1A`, background `#F5F5F3`, "Sobre" font pair, TPL-011), never the card's.

## Disabling by support

- **LNK-010** — Disabling by support is a state distinct from disabling by the owner. On the public side, the card shows the same neutral page (see LNK-006).
- **LNK-011** — For a card disabled by support, the owner sees "Désactivée par le support" ("Disabled by support") in their dashboard and cannot re-enable it themselves; only an administrator can lift this block (see ADM-009 and ADM-010).
- **LNK-028** — Disabling by the owner and disabling by support are independent. As long as support blocks a card, its owner can neither disable nor re-enable it (`409 card_disabled_by_support`); when support lifts the block, the card returns to the state its owner had chosen.
- **LNK-036** — As long as support blocks a card, its owner cannot change it either: saving the card, uploading media to it and re-framing its media (MED-030) are refused with `409 card_disabled_by_support`, and the dashboard shows the card read-only. Its events stay editable (EVT-025) and its leads exportable (LNK-008).

## Deletion

- **LNK-012** — Deleting a card is permanent and requires confirmation. The link of a deleted card shows the same neutral page (see LNK-006).
- **LNK-013** — The slugs of a deleted card stay reserved and are never reassigned to anyone else, so that an old NFC chip never points to a stranger's card.
- **LNK-014** — The same user can attach one of their reserved slugs to a new card.
- **LNK-015** — When an account is deleted, the user's slugs are kept only as a hash in a blocked-slugs table, with no link to a person. They remain blocked permanently: nobody, including the former user, can take them again.
- **LNK-016** — No personal data is kept after an account is deleted (see ACC-018), and no former link can point to a stranger.
- **LNK-031** — A blocked slug (LNK-015) is stored as the SHA-256 hash of the slug as stored (lowercase, UTF-8), and nothing else: no user, no card, no date. All the slugs of the deleted account are blocked: current slugs, former slugs (LNK-003) and reserved slugs (LNK-013).
- **LNK-032** — A blocked slug cannot be claimed: creating a card with it or changing a slug to it is refused with `409 slug_taken` (LNK-022), the availability check says it is taken (LNK-020), and the suggestion skips it (LNK-019). When a claim and the deletion of the account that held the slug happen at the same time, the slug ends up blocked, never claimed.
- **LNK-033** — The link of a blocked slug, its vCard and its forms answer like those of a deleted card: the neutral page (LNK-012, LNK-027), and `410 card_inactive` for the vCard and the public event routes.

## Sharing

- **LNK-017** — The dashboard lets the user copy a card's link and download its QR code as SVG and PNG.
- **LNK-029** — The copied link and the QR code carry the card's full public link, with its current slug: `PUBLIC_BASE_URL/c/<slug>`.
