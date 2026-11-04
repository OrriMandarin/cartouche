---
name: add-card-template
description: Use when adding a new card template (public page layout) to Cartouche: template folder, settings schema, registry, translations, contract and e2e coverage.
---

# Add a card template

A template is a versioned React component in `frontend/web/src/templates/` (TPL-001). The public page (Server Component) and the editor preview (client) render it with the same component (TPL-014). The backend needs no change: it only knows the identifier, and a card whose template is unknown is displayed as "classique" (TPL-015).

**Colours and fonts**: the page wrapper (`.cc-page`; the card itself in the preview) carries the `--c-*` variables, produced by `themeToCssVars` (`src/lib/theme/css-vars.ts`) from the resolved theme (TPL-026); a template never sets them on `html` or `body` and only reads them (`var(--c-text)`, `var(--c-accent)`, `var(--font-title)`…). The `--app-*` variables belong to the dashboard: never mix them. Classique styles itself with plain CSS classes (`classique/classique.css`, `.cc-*`) built on these variables rather than with utility classes; copy that approach.

Reference files: `contract.ts` (types `TemplateDefinition`, `TemplateProps`, `TEMPLATE_TEST_IDS`), `ids.ts` (`TEMPLATE_IDS`), `registry.ts` (`TEMPLATES`, `renderTemplate`), `settings-schema.ts` (`SettingsSchema`, `parseSettings`), `contact-links.ts` (`isHttpUrl`, `mailtoHref`, `telHref`), `classique/` (the model to copy), `contract.test.tsx` (contract suite).

## Steps

1. **Create `frontend/web/src/templates/<id>/`** by copying `classique/`: `index.ts` exports the `TemplateDefinition` (`id`, `nameKey`, `descriptionKey`, `beta`, `supportsTheme`, `media`, `settings`, `Component`), `<Name>.tsx` is the component, `settings.ts` holds the settings schema and type. The component follows the **contract rule**: a pure function, **with no hook, no event handler, no server or browser API** (`useState`, `onClick`, `window`, `headers()`…), so that it renders identically on the server and in the preview. Fixed texts arrive through `labels` (translated by the caller), the theme through `theme` (CSS variables), the vCard and form URLs through `urls` (`urls.vcard`, `urls.eventForm(id)`). Set **all** the `TEMPLATE_TEST_IDS` (`card-name`, `card-job-title`, `card-company`, `card-description`, `card-email`, `card-phone`, `card-avatar`, `card-header-image`, `card-header-video`, `save-contact`, `card-header-empty`, `card-initials`, `card-event-name`, `card-link-<i>`, `event-button-<id>`): the e2e tests rely only on them (TPL-003).
   **Events**: the public page gives the template the events in progress in `events` (`PublicEvent { id, title, startsAt }`); the API returns them in `card.events`, and the page converts them with `toPublicEvents` (`src/lib/public-card.ts`). The template renders **only the button** of each one: a link (`<a>`) `data-testid={TEMPLATE_TEST_IDS.eventButton(event.id)}` to `urls.eventForm(event.id)`; with no event, nothing is shown in their place (PUB-008 to PUB-010, PUB-029). The template sorts the buttons by start (the API breaks ties by title) and animates them (CSS, switched off under `prefers-reduced-motion`, PUB-038). It contains no form, no access code and no consent: the form is **shared by all templates** (TPL-020), served on `/c/<slug>/e/<id>` (`frontend/web/src/app/c/[slug]/e/[eventId]/`, components in `src/components/event-form/`), and only inherits the CSS variables of the card's theme. See `classique/Classique.tsx` for an example.
   **Links**: Classique draws them either as icons (`links_layout: "icons"`, the default) or as rows (`"list"`, icon, name, address, arrow), both with `card-link-<i>` (PUB-035, TPL-027); a template with a layout setting must keep the test id in both.
2. **Use the shared safety helpers**, not home-grown code: `isHttpUrl` before putting a stored address in an `href` (a link that is not `http`/`https` produces no anchor, PUB-022), `mailtoHref` and `telHref` for email and phone (PUB-021), `linkLabel` for a link's label. An unknown link type must fall back to the "website" icon and label (TPL-016). The contract suite checks all of this on every template.
3. **Declare the template**: add the id to `TEMPLATE_IDS` (`ids.ts`, no React import: the e2e package reads it) and the definition to `TEMPLATES` (`registry.ts`). Use `beta: true` while it is being tested (TPL-006): the editor then shows the "bêta" ("beta") badge.
4. **Declare the settings** in the schema of `settings.ts` (`select`, `boolean`, `range`, `color` fields, each with `key`, `labelKey` and `default`) and the accepted media (`media: { header: ["image", "video"], avatar: true }`): the editor builds its form from the schema, with no extra code (TPL-004). `parseSettings` ignores unknown keys and replaces an invalid value with the default value (TPL-016); never re-read the raw settings in the component.
5. **Translations**: add `templates.<id>.name`, `templates.<id>.description` (the `descriptionKey`, required) and `templates.<id>.settings.*` (one entry per `labelKey`, including the `select` options) to `frontend/web/messages/fr.json`, in French, with accents.
6. **Tests**:
   ```bash
   pnpm -C frontend --filter web exec vitest run src/templates   # the contract suite (contract.test.tsx) runs on the new template
   make e2e ARGS="-g TPL-003"                                      # the loop in public-page.spec.ts (TEMPLATE_IDS) covers it
   ```
   For each template, this loop loads `api.seedEvents()`, gives this template to the `alice-durand` card (`api.updateCard`), displays it, checks the event button (`event-button-<id>`), follows the link to the shared form (the theme's `--card-accent` variable, presence of the consent text with the card's name), submits it and waits for the confirmation (TPL-020, FRM-001, FRM-006). A new template enters the loop without touching the test, but it must set the button with the right `data-testid` and the right link, otherwise the loop fails.
   Add a `<Name>.test.tsx` next to the component for what is specific to it (settings, variants). A test name cites its rule (`TPL-004 …`).
7. **Verify**: `make lint test`, then `make e2e` (both projects, `mobile` and `desktop`).

Nothing else to touch: neither the API, nor the editor, nor the public page names a template.
