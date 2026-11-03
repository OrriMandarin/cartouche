# Templates and themes

> Status: implemented (plans 2 and 3)

## Templates

- **TPL-001** — A template is a versioned React component in the repository. Users cannot upload HTML or arbitrary code.
- **TPL-002** — All templates follow the same contract: they receive the card, the resolved theme, the events in progress and the entry points to the form and to the vCard.
- **TPL-003** — The behaviors of the public page (event button, vCard, form, consent) are guaranteed whatever the template, and the end-to-end test suite runs on every template.
- **TPL-004** — Each template declares its settings as a schema (colors, accepted media, specific options). The editor generates its form from this schema: adding a template does not require changing the editor.
- **TPL-005** — Each card freely chooses its template.
- **TPL-006** — A template can carry the "bêta" ("beta") label (template under test), shown in the editor.
- **TPL-007** — All templates are available to all users.
- **TPL-008** — v1 ships the "Classique" ("Classic") template described in public-page.md, and the architecture makes it easy to add a second template.
- **TPL-014** — The public page and the editor preview render the card with the same template component (see EDI-004).
- **TPL-015** — A card whose template is unknown, for example because it was removed from the repository, is displayed with the Classique template.
- **TPL-020** — The event form, its code screen and its confirmation screen do not depend on the template: they are rendered by a shared component, with the card's theme (colors and fonts, see TPL-010). A template only provides the event button, which leads to `urls.eventForm(id)` (see TPL-002).
- **TPL-016** — The template's own settings are read through its schema at render time: a missing or invalid value takes the schema's default value, and an invalid setting never makes rendering fail.

## Themes

A theme is a set of data (colors, font, styles) applied within a template that supports it.

- **TPL-009** — Ready-made themes (6 to 8) serve as a starting point.
- **TPL-010** — On top of a theme, the user adjusts: the accent color, the background (solid color or gradient), the text color, the header gradient intensity and the button shape.
- **TPL-011** — The font is chosen from a short list of title/text pairs, all with good accent support.
- **TPL-012** — Fonts are self-hosted: no call to Google Fonts.
- **TPL-013** — A contrast warning is shown when the text becomes unreadable on the background.
- **TPL-017** — Allowed values for the settings of TPL-010: colors in `#RRGGBB` format; solid background (one color) or linear gradient (two colors and an angle from 0 to 360°); header gradient intensity from 0 to 100%; button shape square, rounded or pill. The server rejects any other value (`400`, field `theme`, code `invalid_theme`).
- **TPL-018** — The contrast warning appears when the WCAG contrast ratio between the text color and the background is below 4.5:1; for a gradient background, the worse of the two colors is used. The warning does not prevent saving.
- **TPL-019** — An unknown ready-made theme or font pair, for example because it was removed from the repository, is replaced at render time by the default theme and pair.
