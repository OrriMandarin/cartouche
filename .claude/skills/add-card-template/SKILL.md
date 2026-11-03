---
name: add-card-template
description: Use when adding a new card template (public page layout) to Cartouche: template folder, settings schema, registry, translations, contract and e2e coverage.
---

# Add a card template

A template is a versioned React component in `frontend/web/src/templates/` (TPL-001). The public page (Server Component) and the editor preview (client) render it with the same component (TPL-014). The backend needs no change: it only knows the identifier, and a card whose template is unknown is displayed as "classique" (TPL-015).

Reference files: `contract.ts` (types `TemplateDefinition`, `TemplateProps`, `TEMPLATE_TEST_IDS`), `ids.ts` (`TEMPLATE_IDS`), `registry.ts` (`TEMPLATES`, `renderTemplate`), `settings-schema.ts` (`SettingsSchema`, `parseSettings`), `contact-links.ts` (`isHttpUrl`, `mailtoHref`, `telHref`), `classique/` (the model to copy), `contract.test.tsx` (contract suite).

## Steps

1. **Create `frontend/web/src/templates/<id>/`** by copying `classique/`: `index.ts` exports the `TemplateDefinition` (`id`, `nameKey`, `beta`, `supportsTheme`, `media`, `settings`, `Component`), `<Name>.tsx` is the component, `settings.ts` holds the settings schema and type. The component follows the **contract rule**: a pure function, **with no hook, no event handler, no server or browser API** (`useState`, `onClick`, `window`, `headers()`…), so that it renders identically on the server and in the preview. Fixed texts arrive through `labels` (translated by the caller), the theme through `theme` (CSS variables), the vCard and form URLs through `urls`. Set **all** the `TEMPLATE_TEST_IDS` (`card-name`, `card-job-title`, `card-company`, `card-description`, `card-email`, `card-phone`, `card-avatar`, `card-header-image`, `card-header-video`, `save-contact`, `card-link-<i>`, `event-button-<id>`): the e2e tests rely only on them (TPL-003).
2. **Use the shared safety helpers**, not home-grown code: `isHttpUrl` before putting a stored address in an `href` (a link that is not `http`/`https` produces no anchor, PUB-022), `mailtoHref` and `telHref` for email and phone (PUB-021), `linkLabel` for a link's label. An unknown link type must fall back to the "website" icon and label (TPL-016). The contract suite checks all of this on every template.
3. **Declare the template**: add the id to `TEMPLATE_IDS` (`ids.ts`, no React import: the e2e package reads it) and the definition to `TEMPLATES` (`registry.ts`). Use `beta: true` while it is being tested (TPL-006): the editor then shows the "bêta" ("beta") badge.
4. **Declare the settings** in the schema of `settings.ts` (`select`, `boolean`, `range`, `color` fields, each with `key`, `labelKey` and `default`) and the accepted media (`media: { header: ["image", "video"], avatar: true }`): the editor builds its form from the schema, with no extra code (TPL-004). `parseSettings` ignores unknown keys and replaces an invalid value with the default value (TPL-016); never re-read the raw settings in the component.
5. **Translations**: add `templates.<id>.name` and `templates.<id>.settings.*` (one entry per `labelKey`, including the `select` options) to `frontend/web/messages/fr.json`, in French, with accents.
6. **Tests**:
   ```bash
   pnpm -C frontend --filter web exec vitest run src/templates   # the contract suite (contract.test.tsx) runs on the new template
   make e2e ARGS="-g TPL-003"                                      # the loop in public-page.spec.ts (TEMPLATE_IDS) covers it
   ```
   Add a `<Name>.test.tsx` next to the component for what is specific to it (settings, variants). A test name cites its rule (`TPL-004 …`).
7. **Verify**: `make lint test`, then `make e2e` (both projects, `mobile` and `desktop`).

Nothing else to touch: neither the API, nor the editor, nor the public page names a template.
