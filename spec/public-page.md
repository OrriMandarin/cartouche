# Public page and vCard

> Status: implemented (plan 2); PUB-008 to PUB-010: verified with a simulated event, fed by real events in plan 3

This page describes the behavior of the public page, whatever the template (see TPL-003). The visuals are those of the "Classique" ("Classic") template, the reference template.

## General rendering

- **PUB-001** — The public page is designed mobile first.
- **PUB-002** — The public page is rendered by the server, for speed and for link previews.
- **PUB-003** — The page is served in UTF-8 and all accents display correctly.

## Header and profile

- **PUB-004** — The header is a full-width image or video.
- **PUB-005** — The header video is muted, autoplays and loops, with `playsinline` so it never goes fullscreen on iOS.
- **PUB-006** — A placeholder image is shown while the header video loads.
- **PUB-007** — A gradient blends the header into the content, and the (round) profile photo is centered on this gradient, straddling the media and the content.

## Event buttons

- **PUB-008** — When one or more events are in progress, each appears as a very visible, animated button carrying the event's name.
- **PUB-009** — Event buttons are sorted by start date.
- **PUB-010** — With no event in progress, nothing is shown where the event buttons would be.

## Information and links

- **PUB-011** — The page shows the card's name, job title, company, description and contact details.
- **PUB-012** — Links are clickable and come with their icon: personal website, LinkedIn, Instagram, Facebook, TikTok, YouTube, X, plus free-form links with a label.
- **PUB-013** — Links open the native app when it is installed.

## Card content

- **PUB-018** — A card's content includes a first name, a last name, a job title, a company, a description, an email and a phone number. The first name or the last name is required (code `required`); the other fields are optional.
- **PUB-019** — Maximum lengths, counted in characters after normalization (see EDI-008): 100 for the first name, last name, job title and company; 1,000 for the description. Beyond that, the field is rejected with the code `too_long`.
- **PUB-020** — The card's email must be valid (code `invalid_email`). The phone number is validated and normalized to the international E.164 format, with France as the default country (code `invalid_phone`), and the page displays it in international format.
- **PUB-021** — On the page, the email opens the mail app (`mailto:`) and the phone number starts a call (`tel:`).
- **PUB-022** — A card has at most 20 links (see PUB-012), in the order chosen by its owner. Each link has an absolute `https://` or `http://` address of at most 2,048 characters; any other form (`javascript:`, `data:`, relative address…) is rejected (code `invalid_url`). A free-form link has a required label of at most 50 characters.
- **PUB-023** — An empty element is not displayed: no label without a value, no empty circle without a profile photo. Without a header background, the header takes the theme's background.

## vCard

- **PUB-014** — The "Enregistrer le contact" ("Save contact") button downloads a vCard (`.vcf`) in version 3.0, encoded in UTF-8, with the profile photo included.
- **PUB-015** — The vCard contains only the elements visible on the card.
- **PUB-016** — In the vCard, characters are escaped as the standard requires.
- **PUB-024** — The vCard contains, when they are filled in: the structured name and the full name (`N`, `FN`), the company (`ORG`), the job title (`TITLE`), the email (`EMAIL`), the phone number (`TEL`), one `URL` per link, the description (`NOTE`) and the profile photo (`PHOTO`).
- **PUB-025** — The vCard photo is a 256 × 256 pixel JPEG, base64-encoded: contacts apps do not read WebP (exception to MED-006, see MED-015).
- **PUB-026** — vCard lines end with CRLF and are folded at 75 bytes, never splitting a multi-byte character.
- **PUB-027** — The vCard is served with the type `text/vcard; charset=utf-8`, under the file name `<slug>.vcf`.

## Link preview

- **PUB-017** — The page exposes OpenGraph tags with the name, job title and photo, for a nice preview when the link is shared (WhatsApp, LinkedIn…).
- **PUB-028** — The OpenGraph tags give: as title, the full name; as description, the job title and company; as image, the absolute address of the profile photo as a 512 × 512 pixel JPEG (see MED-015); as canonical address, the link with the current slug.
