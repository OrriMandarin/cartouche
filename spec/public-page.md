# Public page and vCard

> Status: implemented (plans 2, 3, 6 and 7)

This page describes the behavior of the public page, whatever the template (see TPL-003). The visuals are those of the "Classique" ("Classic") template, the reference template.

## General rendering

- **PUB-001** — The public page is designed mobile first.
- **PUB-002** — The public page is rendered by the server, for speed and for link previews.
- **PUB-003** — The page is served in UTF-8 and all accents display correctly.

## Header and profile

- **PUB-004** — The header is a full-width image or video in the 4:3 format: an image shows the files the server cut along its crop (MED-027), a video its served file, which the server cut along its crop (MED-034, MED-032).
- **PUB-005** — The header video is muted (on the video element itself, so that browsers allow it to start), autoplays from its start and loops over its whole file (`loop`: the loop of MED-028 is already cut into it, MED-032), with `playsinline` so it never goes fullscreen on iOS. When the visitor prefers reduced motion, it does not start by itself and its placeholder image stays.
- **PUB-006** — While the header video loads, its placeholder image (MED-029) is shown blurred under a moving sheen, and the header is marked busy (`aria-busy`) until the video can play. When the visitor prefers reduced motion, the placeholder image is not blurred and no sheen moves over it (PUB-038). If the video cannot be loaded, the sheen and the busy mark go and the placeholder image stays, not blurred.
- **PUB-039** — While the header image loads, the header shows the theme's surface color under the moving sheen and is marked busy (`aria-busy`); once the image has loaded, it is shown without the sheen or the busy mark. If the image cannot be loaded, the sheen and the busy mark go and the surface color stays.
- **PUB-040** — While the profile photo loads, its circle shows the theme's surface color under the moving sheen and is marked busy (`aria-busy`); once the photo has loaded, it is shown without the sheen or the busy mark. If the photo cannot be loaded, the sheen and the busy mark go and the circle keeps the surface color.
- **PUB-041** — A header image, header video or profile photo that finished loading, or failed to load, before the page became interactive (from the browser's cache, for example) leaves its loading state as soon as the page is interactive: no sheen or busy mark stays over a media that has loaded or failed (PUB-006, PUB-039, PUB-040).
- **PUB-042** — Without JavaScript, no sheen is shown over the header or the profile photo and a video's placeholder image is not blurred: the media are shown as soon as the browser has them.
- **PUB-007** — The header fades into the content through a mask whose height is the theme's header gradient intensity, as a percentage of the header, so that the fade also works over a gradient background. The round profile photo, 112 pixels wide with a 4-pixel ring of the background color, is centered and straddles the header, which it overlaps by 64 pixels.

## Event buttons

- **PUB-008** — When one or more events are in progress, each appears as a very visible button in the accent color, with the small label "Événement en cours" ("Event in progress") after a pulsing dot, the event's name and a chevron, under a sheen that crosses it every 3.2 seconds; the second button's animations are offset by 1.6 seconds. The button opens the event's form (FRM-001).
- **PUB-009** — Event buttons are sorted by start date.
- **PUB-010** — With no event in progress, nothing is shown where the event buttons would be.
- **PUB-029** — The event buttons are the card's events in progress (EVT-002) at the moment the page is rendered, according to the server's clock (see EVT-020): an event that starts appears, and an event that has ended disappears, on the next render. For equal start dates, buttons are sorted by title.

## Information and links

- **PUB-030** — From top to bottom, the page shows: the header, the profile photo, the event buttons, the identity (name, job title, company, description), the "Enregistrer le contact" ("Save contact") button, the contact details (email, phone), then the links.
- **PUB-032** — The name, in the title font, is never truncated: it wraps on balanced lines. Long job titles, companies and addresses wrap without overflowing the card.
- **PUB-034** — The email and the phone number are rows showing their icon, their value and, under it, the label "E-mail" or "Téléphone" ("Phone") (see PUB-021).
- **PUB-035** — In the "Icônes" ("Icons") layout (TPL-027), the links of a known kind (PUB-012) are 48-pixel icon buttons in a centered row that wraps, in the order of PUB-022, each named "<name> — <address>" for assistive technologies; the free-form links follow under the icons as rows showing their label and their address. In the "Liste" ("List") layout, every link is a row showing its icon, its name, its address and an arrow. A link's name is its label, or else the name of its kind; the editor gives a new link of a known kind no label (EDI-036), so its name is normally its kind's; its address is its URL without the scheme, without a leading `www.` and without a trailing `/`.
- **PUB-036** — Brand links (LinkedIn, Instagram, Facebook, TikTok, YouTube, X) show their brand pictogram, drawn with the same stroke as the other icons; a website shows a globe and a free-form link a chain link. The icons are part of the application: none is loaded from another server.

- **PUB-011** — The page shows the card's name, job title, company, description and contact details.
- **PUB-012** — Links are clickable and come with their icon: personal website, LinkedIn, Instagram, Facebook, TikTok, YouTube, X, plus free-form links with a label.
- **PUB-013** — Links open the native app when it is installed.

## Card content

- **PUB-018** — A card's content includes a first name, a last name, a job title, a company, a description, an email and a phone number. The first name or the last name is required (code `required`); the other fields are optional.
- **PUB-019** — Maximum lengths, counted in characters after normalization (see EDI-008): 100 for the first name, last name, job title and company; 1,000 for the description. Beyond that, the field is rejected with the code `too_long`.
- **PUB-020** — The card's email must be valid (code `invalid_email`). The phone number is validated and normalized to the international E.164 format, with France as the default country (code `invalid_phone`), and the page displays it in international format.
- **PUB-021** — On the page, the email opens the mail app (`mailto:`) and the phone number starts a call (`tel:`).
- **PUB-022** — A card has at most 20 links (see PUB-012), in the order chosen by its owner. Each link has an absolute `https://` or `http://` address of at most 2,048 characters; any other form (`javascript:`, `data:`, relative address…) is rejected (code `invalid_url`). A free-form link has a required label of at most 50 characters.
- **PUB-023** — An empty element is not displayed: no label without a value, no empty row. Without a profile photo, the circle shows the card's initials (the first letter of the first name and of the last name, uppercase, or of the one that is filled in) on the accent color. Without a header background, the header is a 128-pixel band tinted with the accent color.

## Layout and accessibility

- **PUB-031** — Over a header video, a 44-pixel round button at the top right pauses and resumes playback; it is named "Mettre la vidéo en pause" ("Pause the video") while the video plays and "Lire la vidéo" ("Play the video") while it is paused.
- **PUB-033** — The "Enregistrer le contact" button has inverted colors (its background is the theme's text color and its text the background color), so that it does not compete with the event buttons.
- **PUB-037** — On a screen narrower than 40rem, the card fills the screen. From 40rem on, the card is 28rem wide and centered, with 28-pixel rounded corners and a shadow, on a page background made of the card's background color mixed at 14% with its text color.
- **PUB-038** — Every link and button of the page is at least 44 pixels high and wide, shows a visible focus ring (3 pixels, in the text color), and the animations (event sheen, pulsing dot, loading sheen) stop when the visitor prefers reduced motion.

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
