# Cartouche — Plan 6: Design milestone — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the owner's design (Claude Design mockups, `frontend/design/`) into Cartouche so that v1 becomes publishable (design §12, "jalon design"): the "Classique" public card with the eight ready-made themes, four self-hosted font pairs and a blocking contrast check that the server enforces too; a neutral 404 page for every card that is not served; header photos and avatars cut by the server from a kept source along a stored crop, header videos cropped and looped at display time from stored framing, all re-frameable; the restyled public event form with its access-code screen and a new `datetime` field type; then (phase B, after plan 4 is merged) the "Atelier" dashboard: shell, sign-in and account states, "Mes cartes", the card editor with live contrast and link reordering, the crop dialogs, the events screens, the contacts page and plan 4's screens restyled.

**Architecture:** Pure rules go to `cartouche-domain` (theme presets and contrast maths in `theme/`, crop and framing validation and output planning in `media.rs`/`framing.rs`, the `datetime` answer check in `lead.rs`) and to `frontend/web/src/lib` (theme data, colour maths and `themeToCssVars` in `lib/theme/`, crop and loop maths in `lib/media/framing.ts`, form error messages in `lib/event-form/`, instance contact points in `lib/instance-links.ts`). `cartouche-api` gets migration `0007` (theme identifiers renamed), migration `0008` (media source, framing, duration), the source-keeping image pipeline, the upload framing fields and a re-frame route. The web gets the app tokens (`--app-*`), the card variables (`--c-*`, set only around the card), the rebuilt Classique template from `tokens/card-classique.css`, a client `HeaderMedia` component (video crop, loop, pause, loading), the neutral 404 page, and the restyled event form; phase B adds the dashboard primitives (AlertDialog, Sheet, DropdownMenu, segmented RadioGroup, Sonner toasts), the shell and every dashboard screen.

**Tech Stack:** what plans 1 to 4 use (Rust 2024, Axum 0.8, SQLx 0.9 offline, utoipa 5, `image`, `webp`, `object_store` 0.14 · Next 16, React 19, Tailwind 4, shadcn/ui, next-intl, openapi-fetch, `react-easy-crop` 6, Vitest, Playwright 1.64) + web dependencies `@fontsource-variable/bricolage-grotesque@^5.3.0`, `@fontsource-variable/instrument-sans@^5.3.0`, `@fontsource-variable/jetbrains-mono@^5.3.0` (phase A, all checked on npm: OFL-1.1, 5.3.0); phase B adds `@radix-ui/react-alert-dialog@^1.2.1`, `@radix-ui/react-dropdown-menu@^2.2.1`, `@radix-ui/react-radio-group@^1.5.1`, `sonner@^2.0.8`, `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0` (all checked on npm). No new Rust dependency.

**Spec:** `spec/` is authoritative. Rules added or amended for this plan — phase A: `templates-themes.md` (TPL-009, TPL-011, TPL-012, TPL-013, TPL-018 amended; TPL-021 to TPL-027), `public-page.md` (PUB-004 to PUB-008 and PUB-023 amended; PUB-030 to PUB-038), `media.md` (MED-003, MED-005, MED-015 amended; MED-025 to MED-033), `card-links.md` (LNK-006, LNK-023, LNK-027 amended; LNK-034), `event-form.md` (FRM-021, FRM-039 amended; FRM-043 to FRM-049), `admin-support.md` (ADM-011 reworded; ADM-021); phase B: `card-links.md` (LNK-035, LNK-036), `dashboard-editor.md` (EDI-003 amended; EDI-022 to EDI-035), `account-auth.md` (ACC-025 to ACC-027), `leads-exports.md` (LEA-033 to LEA-035). Glossary: neutral page reworded; ready-made theme, contrast checks, source, crop, framing added. Source of truth for visuals and exact values: `frontend/design/` (`HANDOFF.md` for behaviour, `design/*.dc.html` for visuals — read its §0.1 —, `tokens/*.css` and `tokens/themes.json` for values). Frozen initial design: `docs/superpowers/specs/2026-11-02-cartouche-design.md` §12.

**Paths:** `backend/` (Cargo workspace: `domain/`, `server/`), `frontend/` (pnpm workspace: `web/`, `api-client/`, `e2e/`). Local machine: `source ~/.cargo/env` and `export PATH="$HOME/.local/bin:$PATH"` before `make`. The development database of this worktree is `cartouche_plan6` on the shared PostgreSQL at `localhost:54320`, already set in the worktree's `.env`: **do not run `make dev-db`**; `make sqlx-prepare` and `make sqlx-check` use it.

**Follow-ups:** `docs/superpowers/plans/2026-11-03-cartouche-plan-6-followups.md` (spec/plan rulings R-S1 to R-S37, then execution rulings and review findings).

---

## Points ruled without the owner

The owner approved the decisions of the brief (header video without transcoding, kept originals with server-side crops, neutral page in 404, `datetime` type, Classique icons layout, new themes with an id migration and a server-side contrast check, configurable contact points, access-code screen, GDPR checkbox). Every other conflict between the handoff and the spec was decided here, written as a numbered rule and recorded as a ruling (`R-S<n>`) in the follow-ups file. **Rulings that change behaviour plans 1 to 4 shipped: R-S6, R-S7, R-S9, R-S10, R-S11, R-S17, R-S20, R-S24, R-S26.**

1. **Video framing at display time** (MED-028, MED-032, R-S1): crop rect, loop and poster time stored with the media; CSS crop and a JS loop; no ffmpeg. Tasks A9 to A12.
2. **Source = metadata-free WebP of the whole image, ≤ 4,096 px** (MED-025, R-S2), not the uploaded bytes (MED-007 forbids keeping EXIF/GPS). Task A10.
3. **Re-framing creates a new media** (MED-030, R-S3): copies the source (and the video), cuts new files; published on save like an upload. Task A11.
4. **Sources only for the owner, signed** (MED-031, R-S4): `Audience::Dashboard` splits into `Owner` and `Support`. Task A10.
5. **Crop, loop and poster-time validation** (MED-026, MED-028, R-S5): proportions, 1 % shape tolerance, centered default, loop ≥ 1 s, codes `invalid_crop`, `invalid_loop`, `invalid_poster_time`. Task A9.
6. **(changes implemented behaviour) Header outputs 750/1,125/1,440 px, 4:3, WebP** (MED-015, R-S6); media uploaded before keep their files. Tasks A9, A10.
7. **(changes implemented behaviour) Neutral page in 404, unknown slugs included** (LNK-006, LNK-023, LNK-027, LNK-034, R-S7): "Carte introuvable" disappears. Task A8.
8. **`datetime` answers are naive `YYYY-MM-DDTHH:MM`** (FRM-043, LEA-033, R-S8), code `invalid_date`. Tasks A13, A15, B2.
9. **(changes implemented behaviour) Classique: icons layout by default, `animate_events` dropped** (TPL-027, R-S9). Task A7.
10. **(changes implemented behaviour) Themes and pairs replaced, ids renamed by migration 0007** (TPL-009, TPL-011, TPL-025, R-S10). Tasks A3, A5.
11. **(changes implemented behaviour) Blocking contrast, enforced by the server** (TPL-013, TPL-018, TPL-023, R-S11): formula measured against the design's `contrastChecks` table; unreadable stored cards still render, their next save is refused. Tasks A2, A4.
12. **Theme data in two equal JSON copies** (web and domain), a test keeps them equal (R-S12). Tasks A2, A4.
13. **Text-on-accent colour and colour scheme computed, never stored** (TPL-021, TPL-022, R-S13). Task A2.
14. **"Utiliser une couleur lisible": preset value, then `#111111`, then `#FFFFFF`** (TPL-024, R-S14). Tasks A2, B14.
15. **Brand icons as inline SVG copied from the mockups** (PUB-036, R-S15): lucide's brand shapes and Tabler's TikTok and X, no package. Task A6.
16. **Fonts: every `@font-face` declared, only used files downloaded** (TPL-012, R-S16); the app font is set on the dashboard's layout, never on `body`. Tasks A1, A8, B3.
17. **(changes implemented behaviour) Public page: initials, accent band, vCard button under the identity, 4:3 header, mask fade** (PUB-004 to PUB-008, PUB-023, PUB-030 to PUB-038, R-S17). Tasks A7, A8, A12.
18. **Standard fields stay those of FRM-017** (R-S18): the handoff's "Prénom et nom / Entreprise / Message" list is not adopted. Tasks A14, B19.
19. **Consent text stays FRM-026** (R-S19): the mockup's short sentence is sample text. Tasks A14, B19.
20. **(changes implemented behaviour) Event form texts** (FRM-044 to FRM-047, R-S20): "Envoyer mes coordonnées", per-field messages, summary, confirmation without "vous recontactera après le {événement}". Tasks A14, A15.
21. **Instance contact points** (ADM-021, R-S21): `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL`, placeholder defaults. Task A14.
22. **Access-code screen** (FRM-048, R-S22): band with the title only, one field, one button. Task A14.
23. **Pending screen without the e-mail promise** (ACC-026, R-S23): Cartouche sends no e-mail. Task B5.
24. **(changes implemented behaviour) A card blocked by support is read-only for its owner** (LNK-036, R-S24). Tasks B8, B9.
25. **Slug suggestions `-2`, `-3`, `-4`** (LNK-035, R-S25). Tasks B7, B10.
26. **(changes implemented behaviour) Leave dialog with three choices for both editors** (EDI-028, R-S26), replacing `window.confirm` (plan 2's card editor and plan 4's event editor). Task B12.
27. **No inline avatar zoom in the editor** (R-S27): "Recadrer" does it. Task B15.
28. **Contacts page reuses plan 4's views** (EDI-031, R-S28). Task B20.
29. **API additions in phase B** (R-S29): `CardView.event_counts`, `CardView.lead_count`, `MeView.max_simultaneous_events`, `MeView.totals`. Task B6.
30. **Coordination with plan 4** (R-S30): see the next section. Tasks B1, B2.
31. **Seed: a `datetime` field on "Démonstration en boutique"; themes for e2e set through the API** (R-S31). Tasks A8, A13.
32. **Default poster time 0; the current editor sends 0.1** (R-S32). Task A10.
33. **French typography for every text this plan adds or touches**, screen by screen; a final sweep for the rest (R-S33). All UI tasks, B23.
34. **"Vos données personnelles" leads to the instance's privacy policy** (FRM-044, R-S34). Task A14.
35. **The form band always says "Événement en cours"** while the form is open, grace window included (R-S35). Task A14.
36. **`--c-*` variables on the element around the card on the public page** (TPL-026 wording, R-S36). Tasks A3, A8.
37. **A source's file name carries a random token** (`source-<token>.webp`, MED-031, R-S37), so that in S3 mode it cannot be derived from a public file's URL. Tasks A10, A11.

The pre-flight scan (`.superpowers/sdd/2026-11-03-cartouche-plan-6-design/preflight.md`, rulings P1–P13) corrected the task texts below: shared card CSS in `components/public/public-page.css` (P1), `publicCard.notFound` kept and the form route's inactive state handled by its layout (P2), test ids `card-event-name`, `access-code-input`, `confirmation-save-contact` (P3, P5), `TemplateLabels.linksList` (P4), source naming (P6), `cfg_attr` and no `Eq` on `f64` types (P7), the real `uploadMedia` signature (P8), completed file lists (P9), datetime options dropped (P10), `MediaService::copy` reused (P11), phase-B status of TPL-013/TPL-024 (P12) and smaller items (P13).

## Coordination with plan 4

Plan 4 (leads, exports, account deletion, support lead views, event-editor guard) runs on branch `claude/nervous-driscoll-1b4f23`, not merged yet.

- **Phase A** (Tasks A1 to A16) starts now from `main` and does not touch the dashboard screens. **Phase B** (Tasks B1 to B24) starts only after the controller has merged plan 4's PR into `main` and merged `main` into this branch. Phase B tasks name plan 4's components by the paths its plan creates (`components/events/{LeadList, LeadDetail, ExportDialog}.tsx`, `components/account/DeleteAccount.tsx`, `app/(app)/dashboard/account/page.tsx`, `app/(app)/account-deleted/page.tsx`, `app/(app)/dashboard/cards/[id]/leads/page.tsx`, `app/(app)/support/cards/[id]/{events,leads}/…`, `lib/events/{lead-search, lead-answers, lead-export}.ts`, `lib/account/deletion.ts`) and say **restyle, do not rebuild**.
- **Rule IDs** taken by plan 4 are not reused: plan 6 numbers ACC-025+, ADM-021+, LNK-034+, EDI-022+, LEA-033+. Plan 6's spec never cites a plan-4 ID (they do not exist on `main` yet, `spec-lint` would fail); the amendments plan 6 needs on plan-4 rules (ACC-019's "header" wording) are done in Task B1.
- **Migrations**: plan 4 adds `0006_account_deletion.sql`; plan 6 adds `0007_theme_ids.sql` (Task A5) and `0008_media_framing.sql` (Task A10). After the merge, the dev database `cartouche_plan6` has 0007 and 0008 applied before 0006: if `sqlx migrate run` refuses, drop and recreate it (`dropdb -h localhost -p 54320 -U cartouche cartouche_plan6 && createdb … && make sqlx-prepare`) — Task B1.
- **Generated files** (`backend/.sqlx/`, `frontend/api-client/openapi.json`, `schema.d.ts`) conflict at the merge: take either side, then `make sqlx-prepare` and `make openapi` — Task B1.
- **Spec conflicts** expected at the merge: the status lines of `account-auth.md`, `admin-support.md`, `card-links.md`, `dashboard-editor.md`, `leads-exports.md`; the glossary row "Neutral page" (next to plan 4's "Blocked slug"). Resolution: keep both sides' content in one line — Task B1.
- **Plan 4 e2e texts** that phase A changes: "Cette carte n'est plus active" (now "Cette carte n’est pas disponible", status 404) in `account-deletion.spec.ts` and the blocked-slug tests — Task B1.
- **`datetime` in plan 4's code** (exports, detail view): Task B2. Plan 4's export table falls back to text for an unexpected (value, kind) pair, so the merge compiles; B2 makes it right (LEA-033).

## Global Constraints

- Languages (`CLAUDE.md`): code, identifiers, comments, commits, spec and docs in **English**; interface texts in **French** with accents and French typography (non-breaking space U+00A0 before `:` `;` `?` `!` and inside « », typographic apostrophe ’), all in `frontend/web/messages/fr.json` — write the non-breaking spaces as `\u00a0` escapes in the JSON so they stay visible in review. Exact texts come from the mockups or from this plan. The default consent text (`backend/domain/src/consent.rs`) is unchanged.
- No business logic in handlers or components: `cartouche-domain` or `frontend/web/src/lib`. A handler reads the request, calls the domain and `db/`, formats the response. Every external dependency (storage, clock, `matchMedia`, clipboard) behind an interface or injected.
- `--c-*` variables only on the element holding the card (TPL-026), never `:root`; `--app-*` for the dashboard; never mixed. No runtime CDN, fonts self-hosted; the public page downloads only its pair's files.
- Accessibility (handoff §1): AA contrast, targets ≥ 44 px, visible focus, real labels, confirmations in real dialogs, `prefers-reduced-motion` respected.
- Every `db/` function on user data takes the owner's ID and puts it in the `where` (ACC-017); public reads stay in the documented exceptions. Media of another owner → 404.
- Time comes from `state.clock.now()` on the server; in the web, from an injected `now` in `lib` functions.
- Error body `{"error":{"code","message","request_id"}}`. New codes: `low_contrast` (400 field error, A4), `invalid_crop`, `invalid_loop`, `invalid_poster_time` (400 field errors, A10), `media_not_reframable` (409, A11).
- After any query or migration change: `make sqlx-prepare`, commit `backend/.sqlx/`. After any route or schema change: `make openapi`, commit `openapi.json` and `schema.d.ts`; a generated-type change that breaks the web build is fixed in the same task. Never edit an applied migration.
- Tests: `// spec: XXX-NNN` before each Rust test; the ID in the name of each TypeScript test. Data with accents, typographic apostrophes and emojis ("Éloïse D’Aubigné-Müller", "Zoé Lefèvre ✨").
- Web unit tests: `pnpm -C frontend --filter web exec vitest run <path>`. Rust: `cd backend && cargo test -p cartouche-domain <filter>` / `cargo test -p cartouche-api --all-features --test <file>`.
- E2E: `api.seedEvents()` freezes the clock at `EVENTS_NOW = 2027-03-15T10:00:00Z` before seeding; sign in only afterwards. Playwright projects `mobile` and `desktop`, `Europe/Paris`, `fr-FR`. Every task that touches the interface ends with `make e2e ARGS="-g '<rules of the task>'"`; template behaviours stay covered on every template (TPL-003). A16 and B24 run the full `make lint test` and `make e2e`.
- Test ids used by e2e (`TEMPLATE_TEST_IDS`, `event-form-*`, `field-*`, plan 4's ids) are kept; new ones are listed in the tasks.

## Review Focus

1. **A card with text `#B89580` on Terracotta** (contrast 2.0:1) → the editor blocks saving with "Texte illisible sur ce fond. Contraste 2,0:1, il faut au moins 4,5:1." and offers "Utiliser une couleur lisible (#3B2117)"; a hand-made `PUT /api/cards/{id}` with that theme → `400 validation_failed` `{"field":"theme","code":"low_contrast"}` and nothing changed; the same theme written in SQL is still served by `/c/<slug>`. Tests in A2, A4, B14.
2. **The eight ready-made themes** measure, in JS and in Rust, within ±0.1 of `contrastChecks` (craie 16.0 / 7.1 / 6.2 / 4.5 … minuit 12.6 / 5.3 / 11.8 / 6.3). Tests in A2, A4.
3. **`/c/inconnu`, `/c/alice-archive` (owner-disabled), `/c/bob-martin` (support)** → the same HTML body, HTTP 404, `noindex`, no `og:*` tag, no card text; `/c/alice-archive/e/<event>` → the same 404 page. Tests in A8.
4. **`GET /media/cards/<card>/<media>/source-<token>.webp`** without signature on a served card → 404; the token (32 hex characters, R-S37) appears in no public address, so in S3 mode the source cannot be derived from a public file's URL; the public card JSON and the support card JSON contain no `source`; the owner's `GET /api/cards/{id}` gives a signed source URL that answers 200. Tests in A10.
5. **Bob re-frames Alice's media** (`POST /api/cards/{alice card}/media/{alice media}/reframe`) → 404, no file written; Alice re-frames → a new media id, the old files byte-identical, the public page unchanged until she saves; after the save the old media's files are gone (MED-018). Tests in A11.
6. **Crop `{x:0.6, y:0, width:0.5, height:0.5}`** (overflows) and a 2 % off-ratio crop → `invalid_crop`; a loop `{start:5, end:5.5}` on a 10 s video → `invalid_loop`; poster time 12 on a 10 s video → `invalid_poster_time`; nothing stored. Tests in A9, A10.
7. **An uploaded JPEG with GPS EXIF** → neither the source file nor any variant holds EXIF; the source is oriented. Tests in A10.
8. **A card stored as `{"preset":"ocean"}`** → after migration 0007 `{"preset":"minuit","font":"inter"}`; `{"preset":"sable","font":"moderne","accent":"#123456"}` → `{"preset":"ivoire","font":"inter","accent":"#123456"}`; an unknown preset is untouched; running the migration twice changes nothing more. Tests in A5.
9. **The public page of a "Graphique" card** downloads Bricolage Grotesque and Instrument Sans files and no Playfair, Source Sans, Fraunces, Nunito or JetBrains file. Tests in A8.
10. **A prospect submits the Mariage form with 4 errors** → summary "Vos coordonnées n’ont pas été envoyées : 4 champs sont à corriger." with `role="alert"`, the focus on the first invalid field, each message under its field; the typed answers stay. Tests in A15.
11. **A `datetime` answer `2027-03-20T14:30`** is stored as typed, shown "20/03/2027 à 14:30" in the lead detail and exported `2027-03-20 14:30` (CSV), a date-time cell (XLSX), `"2027-03-20T14:30"` (JSON), with no time-zone shift. Tests in A13, B2.
12. **With reduced motion**, the header video does not start, no sheen or pulse runs; the pause button switches its label. Tests in A7, A12.

---

## File structure

```
backend/domain/src/
  theme/mod.rs              Theme (moved from theme.rs), resolve, check_readable
  theme/presets.json        copy of frontend/web/src/lib/theme/themes.json
  theme/presets.rs          ready-made themes and pairs read from presets.json
  theme/contrast.rs         luminance, ratio, Oklab mix, alpha over, the four checks
  framing.rs                CropRect, VideoLoop, Framing, validation, defaults, pixel crop
  media.rs                  header widths 750/1125/1440, plan from the crop
  form.rs, lead.rs          CustomFieldKind::Datetime, FRM-043
backend/server/
  migrations/0007_theme_ids.sql, 0008_media_framing.sql
  src/media/process.rs      decode once → source → cut variants
  src/routes/card_media.rs  framing fields; reframe route
  src/views.rs              MediaView framing + source; Audience::Owner / Support
frontend/web/src/
  app/tokens.css            --app-* tokens (copy of design tokens)
  app/c/[slug]/not-found.tsx, app/c/[slug]/e/[eventId]/layout.tsx
  components/public/        NeutralPage.tsx, CardStage.tsx
  components/event-form/    event-form.css + restyled components
  lib/theme/                themes.json, color.ts, contrast.ts, presets.ts, fonts.ts, resolve.ts, css-vars.ts
  lib/media/framing.ts      crop style, loop, covered zones, crop maths
  lib/event-form/errors.ts  per-field messages
  lib/instance-links.ts     support, terms, privacy
  templates/icons.tsx, templates/link-display.ts, templates/HeaderMedia.tsx
  templates/classique/      Classique.tsx, classique.css, settings.ts
  components/ui/            (phase B) alert-dialog, sheet, dropdown-menu, radio-group, toaster
  components/shell/         (phase B) AppShell, SideNav, TopBar, TabBar, BrandMark
  components/editor/crop/   (phase B) HeaderCropDialog, AvatarCropDialog, VideoCropDialog, CoveredZones
```

---

# Phase A — public side, themes, media (now)

### Task A1: App tokens and self-hosted fonts

**Files:**
- Create: `frontend/web/src/app/tokens.css`, `frontend/web/src/app/tokens.test.ts`
- Modify: `frontend/web/package.json`, `frontend/pnpm-lock.yaml`, `frontend/web/src/lib/theme/fonts.css`, `frontend/web/src/app/globals.css`

**Rules:** TPL-012, TPL-026.

**Interfaces:**
- Dependencies: `pnpm -C frontend --filter web add @fontsource-variable/bricolage-grotesque@^5.3.0 @fontsource-variable/instrument-sans@^5.3.0 @fontsource-variable/jetbrains-mono@^5.3.0`.
- `fonts.css`: one `@import` per family, in this order: inter, playfair-display, source-sans-3, fraunces, nunito-sans, bricolage-grotesque, instrument-sans, jetbrains-mono, each `@fontsource-variable/<pkg>/wght.css` (use `index.css` for a package that has no `wght.css`: check with `ls frontend/web/node_modules/@fontsource-variable/<pkg>/`). Comment: every `@font-face` is declared, a browser downloads only the files a page uses (R-S16).
- `tokens.css`: the `:root` block and the `@theme inline` block of `frontend/design/tokens/app-tokens.css`, values unchanged, comments translated to English. Imported from `globals.css` right after `@import "tw-animate-css";`. **Do not** map the shadcn variables to the tokens and do not change `body` (phase B, Task B3): phase A leaves the dashboard as it is.

- [ ] **Step 1: Write the failing tests** (`tokens.test.ts`, reading the CSS files with `node:fs`)

```ts
test("TPL-012 fonts.css imports the eight self-hosted families and nothing remote", …); // the 8 package names in order; no "http", no "fonts.googleapis"
test("TPL-026 no --c- variable is declared in the global stylesheets", …);              // globals.css + tokens.css: no /--c-[a-z0-9-]+\s*:/
test("TPL-026 the app tokens are --app- variables only", …);                             // every custom property declared in tokens.css :root starts with --app-
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/app/tokens.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same command, then `pnpm -C frontend -r typecheck && pnpm -C frontend --filter web build` · Expected: PASS, build succeeds.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): app tokens and the self-hosted fonts of the design"`

---

### Task A2: Colour maths and contrast checks (web)

**Files:**
- Create: `frontend/web/src/lib/theme/themes.json`, `frontend/web/src/lib/theme/color.ts`, `frontend/web/src/lib/theme/color.test.ts`
- Modify: `frontend/web/src/lib/theme/contrast.ts`, `frontend/web/src/lib/theme/contrast.test.ts`

**Rules:** TPL-018, TPL-021, TPL-022, TPL-024.

**Interfaces:**
- `themes.json`: byte-for-byte copy of `frontend/design/tokens/themes.json` (keys `fontPairs`, `buttonShapes`, `themes`, `neutralUnavailableTheme`, `contrastChecks`).
- `color.ts` (colours as `#rrggbb`, channels as numbers 0–1, never rounded inside the checks):
  - `type Rgb = readonly [number, number, number]`; `parseHex(hex: string): Rgb`; `toHex(rgb: Rgb): string` (rounds each channel to 8 bits, lowercase).
  - `relativeLuminance(rgb: Rgb): number` — per channel `c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`, then `0.2126 R + 0.7152 G + 0.0722 B`.
  - `contrastRatio(a: Rgb, b: Rgb): number` — `(Lmax + 0.05) / (Lmin + 0.05)`.
  - `mixOklab(a: Rgb, b: Rgb, weightOfA: number): Rgb` — linearize, convert to Oklab with Björn Ottosson's matrices (`l = 0.4122214708 r + 0.5363325363 g + 0.0514459929 b`, `m = 0.2119034982 r + 0.6806995451 g + 0.1073969566 b`, `s = 0.0883024619 r + 0.2817188376 g + 0.6299787005 b`, cube roots, then `L = 0.2104542553 l + 0.7936177850 m − 0.0040720468 s`, `a = 1.9779984951 l − 2.4285922050 m + 0.4505937099 s`, `b = 0.0259040371 l + 0.7827717662 m − 0.8086757660 s`), mix linearly, convert back (inverse matrices `l = L + 0.3963377774 a + 0.2158037573 b`, `m = L − 0.1055613458 a − 0.0638541728 b`, `s = L − 0.0894841775 a − 1.2914855480 b`, cubes, `r = 4.0767416621 l − 3.3077115913 m + 0.2309699292 s`, `g = −1.2684380046 l + 2.6097574011 m − 0.3413193965 s`, `b = −0.0041960863 l − 0.7034186147 m + 1.7076147010 s`), clamp to 0–1, re-encode sRGB (`c ≤ 0.0031308 ? 12.92 c : 1.055 c^(1/2.4) − 0.055`).
  - `over(fg: Rgb, bg: Rgb, alpha: number): Rgb` — per channel `fg·alpha + bg·(1 − alpha)` on the encoded values (what a browser does when laying a translucent colour).
- `contrast.ts`:
  - `type ContrastCheck = "text" | "mutedOnHover" | "onAccent" | "accentVsBg"`; `MIN_CONTRAST: Record<ContrastCheck, number> = { text: 4.5, mutedOnHover: 4.5, onAccent: 4.5, accentVsBg: 3 }`.
  - `interface ThemeColors { accent: string; text: string; background: { kind: "solid"; color: string } | { kind: "gradient"; from: string; to: string; angle: number } }`.
  - `onAccentFor(accent: string): "#FFFFFF" | "#111111"` — the one with the larger ratio, white on a tie (TPL-021).
  - `isDarkTheme(colors: ThemeColors): boolean` — `L(text) > L(first background colour)` (TPL-022).
  - `measureContrast(colors: ThemeColors): Record<ContrastCheck, number>` — stops = `[color]` or `[from, to]`; `muted = mixOklab(text, stops[0], 0.78)`; `hover(s) = over(text, s, 0.12)`; `text = min contrast(text, s)`; `mutedOnHover = min contrast(muted, hover(s))`; `onAccent = contrast(onAccentFor(accent), accent)`; `accentVsBg = min contrast(accent, hover(s))` (TPL-018).
  - `failedChecks(colors): ContrastCheck[]` (in the order above); `settingOf(check): "text" | "accent"` (`text`, `mutedOnHover` → `text`; `onAccent`, `accentVsBg` → `accent`).
  - `readableFix(colors: ThemeColors, setting: "text" | "accent", presetValue: string): string | null` — the first of `[presetValue, "#111111", "#FFFFFF"]` that makes `failedChecks` empty once put in `setting`, else `null` (TPL-024).
  - `formatRatio(ratio: number): string` — one decimal, decimal comma, floor (`2.04 → "2,0"`), for the messages of TPL-013.
  - `readableFix` returns the colour in the stored form (lowercase, `#3b2117`); the button of B14 prints it in upper case (`#3B2117`) as TPL-024 shows it.
  - The old string-based `contrastRatio(a: string, b: string)` and its luminance (threshold 0.03928) are removed from `contrast.ts` in this task: `hasContrastWarning` stays (A3 removes it with its callers) but calls `color.ts`, so only one implementation exists (threshold 0.04045).

- [ ] **Step 1: Write the failing tests**

```ts
test("TPL-018 the eight ready-made themes measure as the design's contrastChecks table", …); // iterate themes.json `themes` (the `contrastChecks` object also holds a "note" string): |measure − contrastChecks[id][check]| ≤ 0.1 for the four checks
test("TPL-018 #767676 on white passes and #777777 fails", …);                              // 4.54 and 4.48
test("TPL-018 a gradient fails when one of its two colours fails", …);                     // from #ffffff to #888888, text #444444
test("TPL-018 the muted text is mixed with the first background colour", …);               // toHex(mixOklab(#1B1A17, #F7F6F2, 0.78)) is #444340, ±1/255 per channel
test("TPL-021 white on a blue accent, near-black on a lime one", …);                       // #2F55D4 → #FFFFFF, #C8F04D → #111111
test("TPL-022 a theme is dark when its text is lighter than its background", …);           // encre, minuit dark; craie light
test("TPL-024 the fix is the preset value, then #111111, then #FFFFFF, else none", …);     // terracotta + text #b89580 → "#3b2117"; a mid-grey #777777 background → null
test("TPL-013 ratios are written with one decimal and a comma", …);                         // 2.04 → "2,0", 11.26 → "11,2"
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/theme/color src/lib/theme/contrast` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): colour maths and the four contrast checks of the design"`

---

### Task A3: Ready-made themes, font pairs and card CSS variables (web)

**Files:**
- Create: `frontend/web/src/lib/theme/css-vars.ts`, `frontend/web/src/lib/theme/css-vars.test.ts`
- Modify: `frontend/web/src/lib/theme/{presets.ts, presets.test.ts, fonts.ts, resolve.ts, resolve.test.ts, edit.ts, edit.test.ts, contrast.ts, contrast.test.ts}` (`hasContrastWarning` and its tests removed), `frontend/web/src/templates/classique/{Classique.tsx, Classique.test.tsx}` (variable names only), `frontend/web/src/templates/{contract.test.tsx, fixtures.ts, registry.test.ts}` (`--card-*` assertions → `--c-*`; `clair`/`sombre` → `craie`/`encre`; `registry.test.ts`: `BACKEND_DEFAULT_THEME_PRESET = "craie"` and expected `presetId "craie"`, equal to the Rust `card::DEFAULT_THEME_PRESET` of A4), `frontend/web/src/components/event-form/{styles.ts, LeadForm.tsx, ConsentField.tsx}` (variable names only: `var(--card-accent)` → `var(--c-accent)`), `frontend/web/src/app/c/[slug]/e/[eventId]/{page.tsx, page.test.tsx}` (`themeStyle` → `themeToCssVars`; `var(--card-bg)`, `var(--card-text)`, `var(--card-font-body)` → the new names), `frontend/web/src/components/editor/{ThemeEditor.tsx, ThemeEditor.test.tsx, CardEditor.test.tsx}` (`CardEditor.test.tsx` asserts `--c-accent` instead of `--card-accent`), `frontend/web/src/components/cards/card-view.fixture.ts`, `frontend/web/src/lib/cards/draft.test.ts`, `frontend/web/messages/fr.json` (`themes`, `fonts`, `fieldErrors.low_contrast`, `editor.theme.lowContrast`; remove the now unused `editor.theme.contrastWarning`)

**Rules:** TPL-009, TPL-010, TPL-011, TPL-019, TPL-021, TPL-022, TPL-026.

**Interfaces:**
- `fonts.ts`: `interface FontPair { id: "inter" | "playfair" | "fraunces" | "bricolage"; nameKey: string; title: string; body: string; titleWeight: number; titleTracking: string; titleStack: string; bodyStack: string }`, built from `themes.json` `fontPairs`; `titleStack = "'<title> Variable', '<title>', " + (title is "Playfair Display" or "Fraunces" ? "Georgia, serif" : "system-ui, sans-serif")`; `bodyStack = "'<body> Variable', '<body>', system-ui, sans-serif"`; `DEFAULT_FONT_ID = "inter"`; `FONT_PAIRS` in the order inter, playfair, fraunces, bricolage.
- `presets.ts`: `ThemePreset { id; nameKey; accent; text; background: ThemeBackground; headerGradient; buttonShape; font }` from `themes.json` `themes` (`background.type` → `kind`, `headerFade` → `headerGradient`, `fontPair` → `font`, colours lowercased); `DEFAULT_PRESET_ID = "craie"`; order craie, ivoire, terracotta, sauge, bonbon, lagon, encre, minuit.
- `resolve.ts`: `ResolvedTheme` = today's fields with `fonts` replaced by `fontPair: FontPair`, plus `onAccent: string` (TPL-021) and `colorScheme: "light" | "dark"` (TPL-022). Fallbacks unchanged (TPL-019: unknown preset → craie, unknown pair → the preset's pair → inter).
- `css-vars.ts`: `themeToCssVars(theme: ResolvedTheme): CSSProperties` returning exactly `--c-accent`, `--c-on-accent`, `--c-bg` (solid colour or gradient `from`), `--c-bg-2` (solid colour or gradient `to`), `--bg-angle` (`180deg` for a solid, else `<angle>deg`), `--c-text`, `--fade` (`String(headerGradient)`, no unit), `--radius-btn` (`square` `2px`, `rounded` `12px`, `pill` `999px`), `--font-title` (`titleStack`), `--font-body` (`bodyStack`), `--title-weight`, `--title-tracking`, `--c-danger` (`#B3261E` light, `#FF8A80` dark) and `colorScheme`. `themeStyle` and the `--card-*` names are removed: Classique and the event form switch to the new names now (`--card-accent` → `--c-accent`, `--card-text` → `--c-text`, `--card-bg` → `linear-gradient(var(--bg-angle), var(--c-bg), var(--c-bg-2))`, `--card-font-heading` → `--font-title`, `--card-font-body` → `--font-body`, `--card-radius` → `--radius-btn`, `--card-header-gradient` (0–1) → `calc(var(--fade) / 100)`); their markup is rebuilt in A7 and A14.
- `ThemeEditor`: lists the 8 presets and 4 pairs from the modules (names from `fr.json`); its warning uses `failedChecks`, with the message `editor.theme.lowContrast` = "Ces couleurs ne sont pas assez lisibles." until B14 replaces it; remove `hasContrastWarning`.
- `fr.json`: `themes` = `{ "craie": "Craie", "ivoire": "Ivoire", "terracotta": "Terracotta", "sauge": "Sauge", "bonbon": "Bonbon", "lagon": "Lagon", "encre": "Encre", "minuit": "Minuit" }`; `fonts` = `{ "inter": "Sobre", "playfair": "Éditoriale", "fraunces": "Douce", "bricolage": "Graphique" }`; `fieldErrors.low_contrast` = `"Ces couleurs ne sont pas assez lisibles\u00a0: corrige-les pour enregistrer la carte."` (an editor-only code: prospects, addressed with "vous", never receive it).
- Fixtures and tests that use `clair`, `sombre`, `sable`, `moderne`, `editorial` switch to `craie`, `encre`, `ivoire`, `inter`, `playfair`.

- [ ] **Step 1: Write the failing tests**

```ts
test("TPL-009 eight ready-made themes, craie first and by default", …);           // ids in order; DEFAULT_PRESET_ID
test("TPL-011 four font pairs with their weights and stacks", …);                 // playfair: title "Playfair Display", 600, "-0.005em", stack ends with "Georgia, serif"
test("TPL-019 an unknown theme or pair falls back to craie and inter", …);        // { preset: "clair" } → craie (the DB is migrated in A5)
test("TPL-010 the owner's settings override the preset", …);
test("TPL-021 TPL-022 css variables carry the text on accent and the scheme", …); // encre → --c-on-accent #111111, colorScheme dark, --c-danger #FF8A80
test("TPL-026 themeToCssVars sets only card variables", …);                       // every key starts with --c-, --bg-, --fade, --radius-btn, --font-, --title- or is colorScheme
test("TPL-010 a solid background gives the same colour twice and 180deg", …);
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/theme src/components/editor/ThemeEditor` · Expected: FAIL.
- [ ] **Step 3: Implement**, then `pnpm -C frontend --filter web exec vitest run` (whole web suite: fixtures and editor tests updated).
- [ ] **Step 4: Run and see them pass** — same commands, `pnpm -C frontend -r typecheck`, then `make e2e ARGS="-g 'TPL-0|PUB-0|EDI-0'"` · Expected: PASS (the public page looks different only through the new values).
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): the design's ready-made themes, font pairs and card variables"`

---

### Task A4: Ready-made themes and contrast checks on the server

**Files:**
- Create: `backend/domain/src/theme/{mod.rs, presets.rs, presets.json, contrast.rs}` (move `theme.rs` into `theme/mod.rs`), `frontend/web/src/lib/theme/themes-sync.test.ts`
- Modify: `backend/domain/src/{lib.rs, card.rs}`, `backend/server/src/routes/cards.rs` (OpenAPI description of the 400), `backend/server/tests/{cards.rs, media.rs}` (`clair` → `craie`), `frontend/e2e/tests/editor.spec.ts`, `frontend/api-client/*` (generated)

**Rules:** TPL-018, TPL-019, TPL-023, EDI-013, EDI-014, EDI-015.

**Interfaces:**
- `presets.json`: byte-for-byte copy of `frontend/web/src/lib/theme/themes.json`, read with `include_str!` and `serde_json` once (`std::sync::LazyLock`).
- `presets.rs`: `pub struct Preset { pub id: String, pub accent: Color, pub text: Color, pub background: Background, pub header_gradient: u8, pub button_shape: ButtonShape, pub font: String }` (from `themes`, `background.type` → `Background`, colours lowercased); `pub fn preset(id: &str) -> Option<&'static Preset>`; `pub const DEFAULT_PRESET: &str = "craie"` (and `card::DEFAULT_THEME_PRESET = "craie"`).
- `contrast.rs`: the same functions as A2 (`relative_luminance`, `contrast_ratio`, `mix_oklab`, `over`, `on_accent_for`, `measure`, `failed_checks`), `f64` throughout, same constants and matrices.
- `mod.rs`: `impl Theme { pub fn resolved_colors(&self) -> ResolvedColors /* preset values, then overrides; unknown preset → craie (TPL-019) */; pub fn check_readable(&self) -> Result<(), LowContrast> }`.
- `card::validate_card` (card.rs, around line 120): after a successful `Theme::parse`, `check_readable()` failing pushes `FieldError::new("theme", "low_contrast")`.
- The structs that read `presets.json` must **not** use `deny_unknown_fields`: the file also carries `name`, `mood`, `onAccent`, `colorScheme`, `buttonShapes`, `neutralUnavailableTheme` and `contrastChecks.note`.
- `frontend/e2e/tests/editor.spec.ts`: the plan-2 test "TPL-010 TPL-013 a low contrast warns in the editor and still saves" (text `#ffffff`) becomes "TPL-013 TPL-023 a low contrast warns in the editor and the save is refused": the warning shows, the save answers `400` and the field error `fieldErrors.low_contrast` ("Ces couleurs ne sont pas assez lisibles\u00a0: corrige-les pour enregistrer la carte.") is shown next to the theme. Card creation (default theme) passes; duplication (`routes/cards.rs` duplicate) does not call it (TPL-023).
- Route `PUT /api/cards/{id}`: its 400 description lists `low_contrast` for `theme`; `make openapi`.
- `themes-sync.test.ts`: reads `../../backend/domain/src/theme/presets.json` (path from `frontend/web`) and `src/lib/theme/themes.json` and expects them deep-equal (R-S12).

- [ ] **Step 1: Write the failing tests**

```rust
// spec: TPL-018
#[test] fn ready_made_themes_measure_as_the_design_table() { /* every theme of presets.json within 0.1 of contrastChecks */ }
// spec: TPL-018
#[test] fn thresholds_are_inclusive() { /* #767676 on #ffffff passes text; #777777 fails */ }
// spec: TPL-019, TPL-023
#[test] fn an_unknown_preset_is_checked_as_craie() { /* {preset:"zzz", text:"#f7f6f2"} → low contrast */ }
// spec: TPL-023
#[test] fn validate_rejects_an_unreadable_theme() { /* terracotta + text #b89580 → [("theme","low_contrast")]; terracotta alone → ok */ }
```
```rust
// tests/cards.rs
// spec: TPL-023, EDI-015
#[sqlx::test] async fn an_unreadable_theme_is_refused_and_nothing_changes(pool) { /* PUT with a new first name and text #b89580 → 400 field theme low_contrast; GET shows the old name and theme */ }
// spec: TPL-023
#[sqlx::test] async fn a_stored_unreadable_card_is_still_served_and_duplicated(pool) { /* SQL update of theme → GET /api/public/cards/{slug} 200 active; POST duplicate 201; then PUT without fixing → 400 low_contrast */ }
// spec: EDI-013
#[sqlx::test] async fn a_new_card_takes_craie(pool) { /* POST /api/cards → theme {"preset":"craie"} */ }
```
```ts
test("TPL-009 the web and the server use the same ready-made themes", …); // themes-sync.test.ts
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain theme`, `cargo test -p cartouche-api --all-features --test cards`, `pnpm -C frontend --filter web exec vitest run src/lib/theme/themes-sync` · Expected: FAIL.
- [ ] **Step 3: Implement**; update the existing Rust tests that use `clair`/`sombre` (`theme.rs` tests, `card.rs`, `tests/cards.rs`, `tests/media.rs`) to `craie`/`encre`; `make openapi`.
- [ ] **Step 4: Run and see them pass** — same commands, then `make test-api` and `make e2e ARGS="-g 'TPL-01|TPL-02'"` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend && git commit -m "feat(domain): ready-made themes and contrast checks enforced on card saves"`

---

### Task A5: Migration 0007 — rename theme and font identifiers

**Files:**
- Create: `backend/server/migrations/0007_theme_ids.sql`
- Modify: `backend/server/tests/migrations.rs`

**Rules:** TPL-025, TPL-019.

**Interfaces:** the migration, exactly:

```sql
-- TPL-025: the ready-made themes and font pairs of plans 2 and 3 take the identifiers of the design.
-- 1. A card without a pair of its own keeps its former pair when its new theme's pair differs:
--    only `ocean` (pair `moderne`, renamed `inter`) becomes a theme with another pair (`minuit`, `playfair`).
update cards set theme = theme || '{"font": "inter"}'::jsonb
 where theme->>'preset' = 'ocean' and not (theme ? 'font');
-- 2. Font pairs.
update cards set theme = jsonb_set(theme, '{font}', to_jsonb(case theme->>'font'
        when 'moderne' then 'inter' when 'editorial' then 'playfair' when 'chaleureux' then 'fraunces' end))
 where theme->>'font' in ('moderne', 'editorial', 'chaleureux');
-- 3. Themes.
update cards set theme = jsonb_set(theme, '{preset}', to_jsonb(case theme->>'preset'
        when 'clair' then 'craie' when 'sombre' then 'encre' when 'sable' then 'ivoire'
        when 'ocean' then 'minuit' when 'foret' then 'sauge' when 'corail' then 'terracotta' end))
 where theme->>'preset' in ('clair', 'sombre', 'sable', 'ocean', 'foret', 'corail');
```

- [ ] **Step 1: Write the failing test** (`tests/migrations.rs`; the migration has already run on the test database, so the test inserts old rows and runs the file again with `sqlx::raw_sql(include_str!("../migrations/0007_theme_ids.sql"))`)

```rust
// spec: TPL-025, Review Focus 8
#[sqlx::test(migrations = "./migrations")]
async fn theme_identifiers_are_renamed(pool: PgPool) {
    /* a user and six cards: {"preset":"clair"} → {"preset":"craie"}; {"preset":"ocean"} → {"preset":"minuit","font":"inter"};
       {"preset":"ocean","font":"editorial"} → {"preset":"minuit","font":"playfair"};
       {"preset":"sable","font":"moderne","accent":"#123456"} → {"preset":"ivoire","font":"inter","accent":"#123456"};
       {"preset":"corail","header_gradient":10} → {"preset":"terracotta","header_gradient":10}; {"preset":"zzz"} unchanged;
       running the file a second time changes nothing */
}
```

- [ ] **Step 2: Run and see it fail** — `cd backend && cargo test -p cartouche-api --all-features --test migrations` · Expected: FAIL (file missing).
- [ ] **Step 3: Implement**; `make sqlx-prepare` (no query change expected; run it to be sure) and apply to the dev database (`make api` once, or `cd backend/server && sqlx migrate run`).
- [ ] **Step 4: Run and see it pass** — same command, then `make test-api` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(db): rename the ready-made theme and font identifiers"`

---

### Task A6: Brand icons and link display

**Files:**
- Create: `frontend/web/src/templates/icons.tsx`, `frontend/web/src/templates/link-display.ts`, `frontend/web/src/templates/link-display.test.ts`
- Modify: `frontend/web/src/templates/{contract.ts, contract.test.tsx}`, `frontend/web/src/templates/classique/Classique.tsx` (imports of the moved function)

**Rules:** PUB-012, PUB-023, PUB-035, PUB-036.

**Interfaces:**
- `icons.tsx`: function components with `aria-hidden="true"`, `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"`, className passthrough: `LinkedInIcon`, `InstagramIcon`, `FacebookIcon`, `TikTokIcon`, `YouTubeIcon`, `XIcon`, the path data copied from the `<symbol id="i-linkedin|i-instagram|i-facebook|i-tiktok|i-youtube|i-x">` of `frontend/design/design/Etats.dc.html`. Header comment: LinkedIn, Instagram, Facebook and YouTube shapes come from lucide (ISC licence), TikTok and X from Tabler Icons (MIT licence), drawn with lucide's stroke (R-S15). Generic icons keep coming from `lucide-react` (`Globe`, `Link`, `Mail`, `Phone`, `UserPlus`, `ChevronRight`, `ChevronLeft`, `ArrowUpRight`, `Pause`, `Play`, `Unlink`, `CircleAlert`, `Send`, `Check`).
- `link-display.ts`:
  - `linkIcon(kind: string): ComponentType<{ className?: string }>` — brands as above, `website` → `Globe`, `custom` → `Link`, an unknown kind → `Globe` (TPL-016).
  - `linkAddress(url: string): string` — removes `^https?://`, then a leading `www.`, then one trailing `/`: `https://www.linkedin.com/in/alice/` → `linkedin.com/in/alice`.
  - `linkName(labels: TemplateLabels, link): string` — `contract.ts`'s `linkLabel` **moved** here and renamed (label, else kind name, unknown kind → website); `contract.ts` no longer exports `linkLabel` and its callers import `linkName` (no duplicate function).
  - `linkAriaLabel(labels, link): string` — `` `${linkName} — ${linkAddress}` `` (em dash with spaces).
  - `splitLinksForIcons(links)` → `{ icons: Indexed[]; rows: Indexed[] }` with `Indexed = { link, index }` (`custom` links in `rows`, every other kind in `icons`, order kept, original index kept).
  - `initials(firstName?: string | null, lastName?: string | null): string` — first character (code point) of each trimmed name, `toLocaleUpperCase("fr")`, joined: ("Éloïse", "D’Aubigné-Müller") → "ÉD", ("Alice", null) → "A".

- [ ] **Step 1: Write the failing tests**

```ts
test("PUB-035 a link's address drops the scheme, www. and the trailing slash", …);
test("PUB-035 icons and rows: free-form links become rows, the order and indexes stay", …);
test("PUB-035 the accessible name is name — address", …);              // "LinkedIn — linkedin.com/in/alice"; custom "Portfolio — alice.example.test"
test("PUB-036 every brand has its own icon, a website a globe, a free link a chain", …);
test("PUB-023 initials of the first and last name, uppercase, accents kept", …);
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/templates/link-display` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(web): brand icons and link display for the card"`

---

### Task A7: Classique template rebuilt from the design

**Files:**
- Create: `frontend/web/src/templates/classique/classique.css`, `frontend/web/src/components/public/public-page.css` (the shared card base; A8 adds the page rules to it)
- Modify: `frontend/web/src/templates/classique/{Classique.tsx, Classique.test.tsx, settings.ts}`, `frontend/web/src/templates/{contract.ts, contract.test.tsx, fixtures.ts, registry.test.ts}` (`registry.test.ts` expects the parsed settings `{ links_layout: "icons" }`, no `animate_events`), `frontend/web/src/lib/cards/draft.test.ts` (the tests around lines 151–163 that rely on the old settings defaults), `frontend/web/src/components/editor/CardEditor.test.tsx`, `frontend/web/messages/fr.json` (`publicCard`, `templates.classique`), `frontend/e2e/tests/{public-page.spec.ts, editor.spec.ts, events.spec.ts}` (`events.spec.ts` around line 133 reads the button's name through `card-event-name` instead of `toHaveText(MARIAGE)` on the button)

**Rules:** PUB-007, PUB-008, PUB-010, PUB-011, PUB-021, PUB-023, PUB-030, PUB-032, PUB-033, PUB-034, PUB-035, PUB-036, PUB-038, TPL-002, TPL-003, TPL-014, TPL-016, TPL-026, TPL-027.

**Interfaces:**
- Stylesheets (P1 of the pre-flight): the rules of `frontend/design/tokens/card-classique.css` are split in two, comments in English.
  - `components/public/public-page.css` — what every card-themed screen shares (public page, neutral page, event form, editor preview): the `.cc` base rule with its derived variables (`--c-muted`, `--c-surface`, `--c-surface-hover`, `--c-field`, `--c-field-border`, `--c-focus`, `--c-scrim`, `--c-on-scrim`, `--radius-field`, `--radius-panel`), its box model, background, font and `max-width: 28rem`; `.cc *` box sizing; `.cc a`; `.cc svg.ic`; the focus ring; `.cc-dot` with `@keyframes cc-ping`; `.cc-save`; and the reduced-motion rule for `.cc-dot::after`. Defined once: the event form (A14) never redefines them.
  - `templates/classique/classique.css` — Classique only: header (`.cc-head`, `.cc-media`, `.cc-shimmer`, `.cc-pause`), avatar, `.cc-body`, events (`.cc-events`, `.cc-event`, sheen), identity, rows, icons, and the reduced-motion rules of the sheen and shimmer; **not** `.cc-off`, `.cc-page`, `.cc-stage` (page rules, A8).
  - `Classique.tsx` imports both files (global CSS imports, allowed in the app directory), so the editor preview and the thumbnails are styled too. No colour literal is added beyond the design file's own (`--c-scrim`, `--c-on-scrim`, and the `#000` of the header's mask gradient, which only sets the mask's opacity).
- Markup = the `<article class="cc">` of `frontend/design/design/Main.dc.html` (header, avatar, `.cc-body` with events, identity, save, contact list, links), with `style={themeToCssVars(theme)}` and `data-shape={theme.buttonShape}` on the `<article>` (TPL-026: the preview and the thumbnails get the variables on the card itself); the public page wraps it (A8).
  - Header: for now an `<img>` (`srcset`, `sizes="(min-width: 40rem) 28rem, 100vw"`, `alt=""`, test id `card-header-image`) or the current plain `<video>` (test id `card-header-video`) inside `.cc-media`; no media → `<div class="cc-media is-empty" data-testid="card-header-empty" aria-hidden="true">`. Task A12 replaces this with `HeaderMedia`.
  - Avatar: `<div class="cc-avatar"><img data-testid="card-avatar" …></div>`; without photo `<div class="cc-avatar is-initials" data-testid="card-initials" aria-hidden="true">{initials}</div>` (PUB-023).
  - Events: `<a class="cc-event" data-testid="event-button-<id>">` with `<span class="cc-event-live"><span class="cc-dot" aria-hidden="true"/>{labels.eventLive}</span>` and `<span class="cc-event-name" data-testid="card-event-name">{title}</span>` (not `event-button-name`: existing selectors `/^event-button-/` and `[data-testid^="event-button-"]` would count it as a button) and a `ChevronRight` (PUB-008); none → nothing rendered (PUB-010).
  - Identity `.cc-id` (name `h1.cc-name`, `.cc-role`, `.cc-company`, `.cc-desc`, existing test ids), then `<a class="cc-save" data-testid="save-contact" download>` with `UserPlus` and `labels.saveContact` (PUB-030, PUB-033).
  - Contact list `<ul class="cc-list" aria-label={labels.contacts}>`: rows `.cc-row` with `Mail`/`Phone`, `.cc-row-label` value, `.cc-row-sub` `labels.emailLabel` / `labels.phoneLabel` (PUB-034); test ids `card-email`, `card-phone` on the `<a>`.
  - Links: `settings.links_layout === "list"` → `<ul class="cc-list" aria-label={labels.linksList}>` rows (icon, name, address, `ArrowUpRight` `.cc-row-end`); else `.cc-iconset` with `<ul class="cc-icons" aria-label={labels.networks}>` of `<a class="cc-icon" aria-label={linkAriaLabel}>` and, when there are free links, the rows list under it (PUB-035). Every link `<a>` keeps `data-testid="card-link-<original index>"`, `rel="noopener noreferrer"`, and only `isHttpUrl` links are rendered (PUB-022).
- `settings.ts`: `ClassiqueSettings = { links_layout: "icons" | "list" }`; schema: one `select` field `links_layout`, label key `templates.classique.settings.links_layout`, options `icons` (`…links_layout_icons`) then `list` (`…links_layout_list`), default `icons` (TPL-027). `animate_events` is gone.
- `contract.ts` `TemplateLabels` gains `eventLive`, `contacts`, `emailLabel`, `phoneLabel`, `linksList` ("Liens"; the existing `links: Record<LinkKind, string>` keeps the kind names), `networks`, `pauseVideo`, `playVideo`; `buildTemplateLabels` reads them; `TEMPLATE_TEST_IDS` gains `initials: "card-initials"`, `headerEmpty: "card-header-empty"`, `eventName: "card-event-name"`. The contract test "TPL-003 required test ids are present" excludes the mutually exclusive ids (`initials` vs `avatar`, `headerEmpty` vs `headerImage`/`headerVideo`) and checks each of them in its own fixture.
- `fr.json`: `publicCard.eventLive` "Événement en cours", `publicCard.contacts` "Coordonnées", `publicCard.emailLabel` "E-mail", `publicCard.phoneLabel` "Téléphone", `publicCard.links` (keep the kind names) + `publicCard.linksList` "Liens", `publicCard.networks` "Réseaux", `publicCard.pauseVideo` "Mettre la vidéo en pause", `publicCard.playVideo` "Lire la vidéo"; `templates.classique.settings` = `{ "links_layout": "Disposition des liens", "links_layout_icons": "Icônes", "links_layout_list": "Liste" }` (remove `animate_events`).

- [ ] **Step 1: Write the failing unit tests** (`Classique.test.tsx`, `contract.test.tsx`)

```ts
test("PUB-030 the order is header, photo, events, identity, save, contacts, links", …);  // DOM order of the test ids
test("PUB-023 without photo the initials show on the accent, without header a short band", …);
test("PUB-008 an event button carries the live label, the name and a chevron", …);
test("PUB-010 no event, no event area", …);
test("PUB-034 email and phone rows carry their sub-label", …);
test("PUB-035 TPL-027 icons by default, free links as rows under them", …);   // settings {} → icons; aria-label "LinkedIn — linkedin.com/in/alice"
test("PUB-035 the list layout shows every link as a row", …);
test("TPL-016 TPL-027 a stored animate_events setting is ignored", …);
test("TPL-026 the theme variables sit on the card element", …);              // article style has --c-accent; document.documentElement has none
```

- [ ] **Step 2: Write the failing e2e tests** (`public-page.spec.ts`, `events.spec.ts`; update the existing ones whose texts or structure changed — event buttons read their name through `card-event-name`)

```ts
test("PUB-030 PUB-033 the save button sits right under the identity", …);
test("PUB-035 PUB-036 links show as icons with labelled free links", …);     // alice-durand: card-link-0 has aria-label "LinkedIn — linkedin.com/in/alice"; card-link-1 row text "Portfolio" and "alice.example.test"
test("PUB-023 a card without photo shows its initials", …);                  // alice-durand → "AD"
test("PUB-038 reduced motion stops the event sheen and the pulse", …);       // page.emulateMedia({ reducedMotion: "reduce" }); getComputedStyle(button, "::after").animationName === "none"
test("TPL-027 the editor offers Icônes and Liste, Icônes by default", …);    // editor.spec.ts: setting-links_layout
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/templates` then `make e2e ARGS="-g 'PUB-0|TPL-0'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands · Expected: PASS on `mobile` and `desktop`.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): Classique template rebuilt from the design"`

---

### Task A8: Public page frame, neutral 404 page and fonts of the pair

**Files:**
- Create: `frontend/web/src/components/public/{CardStage.tsx, NeutralPage.tsx, NeutralPage.test.tsx}`, `frontend/web/src/app/c/[slug]/e/[eventId]/layout.tsx`
- Modify: `frontend/web/src/components/public/public-page.css` (created in A7: add the page rules), `frontend/web/src/app/c/[slug]/{page.tsx, page.test.tsx, not-found.tsx}`, `frontend/web/src/app/c/[slug]/e/[eventId]/{page.tsx, page.test.tsx}` (`page.test.tsx` asserts "Cette carte n'est plus active" twice today), `frontend/web/src/lib/{og.ts, og.test.ts}`, `frontend/web/src/lib/theme/resolve.ts` (`neutralTheme()`), `frontend/web/messages/fr.json` (`publicCard.unavailable`), `frontend/e2e/tests/{public-page.spec.ts, event-form.spec.ts, cards.spec.ts, support-cards.spec.ts}` (`cards.spec.ts` around lines 48 and 94 and `support-cards.spec.ts` around line 43 check the old neutral text on the public page)
- Delete: `frontend/web/src/components/public/InactiveCard.tsx`

**Rules:** LNK-006, LNK-007, LNK-010, LNK-012, LNK-023, LNK-026, LNK-027, LNK-034, ADM-011, FRM-024, PUB-037, TPL-012, TPL-026.

**Interfaces:**
- `public-page.css` (after the shared card base of A7): `.cc-off`, `.cc-page`, `.cc-stage` and the `@container (min-width: 40rem)` block of `card-classique.css`, plus `.cc-off-mark`, `.cc-off-title`, `.cc-off-text` of `Etats.dc.html` (`.cc-off { min-height: 100svh }`). `CardStage.tsx` imports it, so the neutral page and the event form get the `.cc` base without loading `classique.css`.
- `CardStage({ theme, children })`: `<div class="cc-page" style={themeToCssVars(theme)}><div class="cc-stage">{children}</div></div>` — the variables sit on this wrapper on the public page and the form (TPL-026, R-S36), never on `html`/`body` (PUB-037).
- `NeutralPage()`: `CardStage` with `neutralTheme()` (from `themes.json` `neutralUnavailableTheme`: accent and text `#1c1c1a`, background `#f5f5f3`, pair `inter`, shape `rounded`, fade 0) and `<article class="cc"><div class="cc-off" data-testid="card-unavailable"><div class="cc-off-mark"><Unlink/></div><h1 class="cc-off-title">{t("publicCard.unavailable.title")}</h1><p class="cc-off-text">{t("publicCard.unavailable.text")}</p></div></article>`.
- `app/c/[slug]/page.tsx`: `null` (never assigned) and `inactive` both call `notFound()`; `app/c/[slug]/not-found.tsx` renders `NeutralPage` (LNK-023, LNK-027). The active card renders `CardStage(theme) > renderTemplate(…)`.
- `app/c/[slug]/e/[eventId]/layout.tsx`: calls `fetchPublicCard(slug)` and `fetchPublicEvent(…)` with the same arguments as the page (both wrapped in `cache`, so the page reuses the answers); a card `null` or `inactive`, **or** the event API answering the state `inactive` (`410 card_inactive`: the card stopped being served between the two calls) → `notFound()` in the layout (pre-flight P2). Nothing is left for the page to do for an inactive card; `InactiveCard` is deleted. A `notFound()` thrown by a **layout** is handled by the parent segment's boundary, i.e. `app/c/[slug]/not-found.tsx` (the neutral page), while the page's own `notFound()` (unknown event) keeps showing `e/[eventId]/not-found.tsx` ("Formulaire introuvable", FRM-024). Verify both with the e2e tests below; if Next does not behave so, put the card check in the page and render `NeutralPage` from a dedicated `not-found` reached through a thrown marker — the tests decide.
- Metadata: the neutral page carries `<meta name="robots" content="noindex, nofollow">` and no `og:*` tag (`INACTIVE_METADATA`); `generateMetadata` returns it for `null` and `inactive` (check the 404 HTML in the e2e test).
- `fr.json`: `publicCard.unavailable.title` "Cette carte n’est pas disponible", `publicCard.unavailable.text` "Le lien est peut-être incorrect, ou la carte n’est plus active."; remove `publicCard.inactive` only. **Keep** `publicCard.notFound` ("Carte introuvable"): the dashboard uses it (`app/(app)/dashboard/cards/[id]/page.tsx`, `components/events/CardScope.tsx`; e2e `editor.spec.ts`, `leads.spec.ts`, `events.spec.ts`, ACC-017).
- No seed change: the font e2e test sets Alice's theme through the API (`PUT /api/cards/{id}` with `{ "preset": "bonbon" }` and the card's current content) before visiting (R-S31).

- [ ] **Step 1: Write the failing unit tests**

```ts
test("LNK-034 the neutral page shows its title and text in the neutral theme", …);
test("LNK-023 LNK-027 an unknown slug and an inactive card both end in notFound", …);  // page.test.tsx, notFound mocked
test("LNK-027 the neutral metadata asks not to index and has no OpenGraph", …);        // og.test.ts
test("LNK-007 FRM-024 a card disabled while its form is open gives the neutral page", …); // e/[eventId] layout test: fetchPublicCard active but fetchPublicEvent state "inactive" → the layout calls notFound
```

- [ ] **Step 2: Write the failing e2e tests** (`public-page.spec.ts`, `event-form.spec.ts`; update the plan-2/3 tests that expected status 200, "Cette carte n'est plus active" or "Carte introuvable")

```ts
test("LNK-023 LNK-027 LNK-034 unknown, disabled and blocked cards show the same 404 page", …);
// /c/inconnu-zz, /c/alice-archive, /c/bob-martin: response.status() 404; card-unavailable visible with both texts;
// meta[name=robots] content contains "noindex"; no meta[property^="og:"]; page text contains no "Alice", "Bob", "Ancien poste"
test("LNK-007 FRM-024 the form of an inactive card is the same 404 page", …);       // /c/alice-archive/e/<Événement archivé id> → 404 + card-unavailable
test("FRM-024 an unknown event of a served card still says Formulaire introuvable", …);
test("PUB-037 from 40rem the card is 28rem wide with rounded corners", …);           // desktop project: .cc width 448, border-radius 28px; mobile: .cc width = viewport width
test("TPL-012 the public page downloads only the files of its pair", …);
// PUT theme bonbon on alice-durand; collect requests ending in .woff2 on /c/alice-durand;
// some contain "bricolage-grotesque" and some "instrument-sans"; none contains "playfair", "source-sans", "fraunces", "nunito", "jetbrains"
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/public "src/app/c" src/lib/og` then `make e2e ARGS="-g 'LNK-0|FRM-024|PUB-037|TPL-012'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): card frame, neutral 404 page and fonts of the card's pair"`

---

### Task A9: Domain — crop, framing and planned outputs

**Files:**
- Create: `backend/domain/src/framing.rs`
- Modify: `backend/domain/src/{lib.rs, media.rs}`

**Rules:** MED-015, MED-026, MED-028, MED-033.

**Interfaces:**
- `#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)] #[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))] pub struct CropRect` (utoipa is an optional feature of the domain; the same attributes on every type below; no `Eq`, the fields are `f64`) { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }`; `pub struct VideoLoop { pub start: f64, pub end: f64 }`; `pub struct Framing { pub crop: CropRect, #[serde(rename = "loop", skip_serializing_if = "Option::is_none")] pub video_loop: Option<VideoLoop>, #[serde(skip_serializing_if = "Option::is_none")] pub poster_time: Option<f64> }`.
- `pub fn default_crop(slot: Slot, width: u32, height: u32) -> CropRect` — target ratio `r` = 4/3 (header) or 1 (avatar); if `width / height > r`: `height = 1`, `width = (height_px · r) / width_px`, `x = (1 − width) / 2`, `y = 0`; else `width = 1`, `height = (width_px / r) / height_px`, `y = (1 − height) / 2`, `x = 0`.
- `pub fn check_crop(crop: &CropRect, slot: Slot, width: u32, height: u32) -> Result<(), &'static str>` → `Err("invalid_crop")` unless every value is finite, `x ≥ 0`, `y ≥ 0`, `width > 0`, `height > 0`, `x + width ≤ 1 + 1e-9`, `y + height ≤ 1 + 1e-9`, and `| (width·W) / (height·H) / r − 1 | ≤ 0.01`.
- `pub struct PixelRect { pub x: u32, pub y: u32, pub width: u32, pub height: u32 }`; `pub fn crop_pixels(crop: &CropRect, width: u32, height: u32) -> PixelRect` — each value `round(v · W or H)`, then `width ≤ W − x`, `height ≤ H − y`, both ≥ 1; for an avatar, `width = height = min(width, height)`.
- `pub fn check_loop(lp: &VideoLoop, duration: Duration) -> Result<(), &'static str>` → `Err("invalid_loop")` unless finite, `0 ≤ start < end ≤ d + 0.05`, and `end − start ≥ 1` or (`start == 0` and `end ≥ d − 0.05`); `pub fn check_poster_time(t: f64, duration: Duration) -> Result<(), &'static str>` → `Err("invalid_poster_time")` unless finite and `0 ≤ t ≤ d + 0.05`; `pub fn default_loop(duration) -> VideoLoop { start: 0, end: d }`.
- `media.rs`: `HEADER_WIDTHS = [750, 1125, 1440]`; `plan_image_variants(slot, crop_width_px, crop_height_px)` — header: `capped(...)` on the crop's pixel width, each planned variant has `height = round(width · 3 / 4)`, clamped to the crop's pixel height so that no variant is taller than the crop (new `PlannedVariant.height`); avatar unchanged (side = crop side). `SOURCE_MAX_SIDE: u32 = 4096`; `pub fn source_size(width, height) -> (u32, u32)` (scaled down so the longer side ≤ 4096, never enlarged, rounding to nearest, ≥ 1).

- [ ] **Step 1: Write the failing tests** (inline, `framing.rs` and `media.rs`)

```rust
// spec: MED-026
#[test] fn the_default_crop_is_the_largest_centered_rectangle() { /* 1600×900 header → x 0.125.., width 0.75, height 1; 900×1600 avatar → y 0.21875, height 0.5625 */ }
// spec: MED-026, Review Focus 6
#[test] fn invalid_crops_are_refused() { /* overflow {0.6,0,0.5,0.5}; negative x; zero width; NaN; 2 % off ratio; 0.9 % off ratio passes */ }
// spec: MED-026
#[test] fn pixel_crop_rounds_and_stays_inside() { /* 1600×1200, {0,0,0.5,0.5} → 0,0,800,600; a crop touching the right edge never exceeds W */ }
// spec: MED-028
#[test] fn loops_and_poster_times_are_checked_against_the_duration() { /* 10 s: {0,10} ok; {5,5.5} refused; {9,10.04} ok; {0,10.2} refused; 0.6 s video {0,0.6} ok; poster 12 refused */ }
// spec: MED-015
#[test] fn header_variants_are_4_3_and_never_enlarged() { /* 800×600 crop → 750×563, 800×600; 1600×1200 → 750×563, 1125×844, 1440×1080 */ }
// spec: MED-025
#[test] fn sources_are_capped_at_4096() { /* 8000×4000 → 4096×2048; 1000×800 unchanged */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain framing` and `… media` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — `cd backend && cargo test -p cartouche-domain` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(domain): crop, video framing and 4:3 header outputs"`

---

### Task A10: Source kept, cropped outputs and framing on upload (migration 0008)

**Files:**
- Create: `backend/server/migrations/0008_media_framing.sql`
- Modify: `backend/server/src/media/{process.rs, service.rs}`, `backend/server/src/db/media.rs`, `backend/server/src/routes/{card_media.rs, media_files.rs, cards.rs (duplication copies source and framing), public_cards.rs, admin_cards.rs}`, `backend/server/src/views.rs`, `backend/domain/src/media_files.rs`, `backend/server/tests/{media.rs, media_processing.rs, media_service.rs}`, `frontend/web/src/lib/media/{upload.ts, upload.test.ts}`, `frontend/web/src/lib/api.ts` (`useUploadMedia`), `frontend/web/src/components/editor/MediaField.tsx` (sends the poster time), `frontend/api-client/*` (generated), `backend/.sqlx/`

**Rules:** MED-003, MED-007, MED-014, MED-015, MED-016, MED-023, MED-025, MED-026, MED-027, MED-028, MED-029, MED-031, MED-033, EDI-014.

**Interfaces:**
- Migration, exactly:

```sql
-- MED-025 to MED-028: the source kept for re-framing, the framing, and a video's duration.
-- All three stay null for media uploaded before plan 6 (MED-033).
alter table media
    add column source jsonb,
    add column framing jsonb,
    add column duration_ms integer check (duration_ms is null or duration_ms >= 0);
```

- Source file name (pre-flight P6, R-S37, MED-031): `source-<token>.webp`, `<token>` = 32 lowercase hexadecimal characters of a random UUID v4 (`Uuid::new_v4().simple()`), drawn by the server for each new media (upload, re-frame, duplication). In S3 mode the owner's address of the source is its bucket URL, which cannot be derived from a public variant's URL; in local mode it is also signed. Domain `media_files.rs`: `pub fn source_name(token: &str) -> String` and `pub fn is_source_name(name: &str) -> bool` (`^source-[0-9a-f]{32}\.webp$`).
- `db::media::MediaRecord` gains `source: Option<SourceFile>` (`{ name: "source-<token>.webp", width, height }`), `framing: Option<Framing>`, `duration_ms: Option<u32>`; every select and insert carries them; owner filter unchanged. `MediaRecord` and `MediaView` drop `Eq` (they hold `f64`), keeping `PartialEq`.
- `process.rs`: `decode(bytes) -> Result<DynamicImage, ProcessError>` (today's checks, orientation applied); `encode_source(&DynamicImage) -> EncodedSource { bytes, width, height }` (resized to `source_size`, Lanczos3, WebP quality 90); `cut_variants(source: &DynamicImage, slot, crop: &CropRect) -> Vec<EncodedVariant>` (crop in pixels of the **encoded source**, then the planned widths/heights with `resize_exact`). The uploaded bytes are never stored (MED-007): only the source file and the variants.
- Upload route (`POST /api/cards/{id}/media`): new optional multipart text fields `crop` (JSON `CropRect`), `loop` (JSON `VideoLoop`, video only), `poster_time` (decimal, video only). Image: decode → source → `check_crop` against the source size (default when absent) → cut. Video: duration from `mp4_duration` (stored in `duration_ms`); `poster` required as today; the poster becomes the video media's source file; the crop is checked against the poster's size; `check_loop`, `check_poster_time` (defaults when absent); the poster's variants are cut along the crop (MED-029); `video.mp4` stored as uploaded. Errors: `400 validation_failed` with fields `crop`/`loop`/`poster_time` and codes `invalid_crop`/`invalid_loop`/`invalid_poster_time`; a malformed JSON field → `400 invalid_request`. `framing` is stored for every new media (with the defaults filled in).
- `media_files.rs`: `served_content_type` also accepts a name for which `is_source_name` holds (`image/webp`); `pub fn is_source_key(key) -> bool`; `media_access(signed, served, is_source)`: a source needs a valid signature, whatever `served` (MED-031, local mode).
- `views.rs`: `Audience::Dashboard(now)` becomes `Audience::Owner(now)` (owner routes) and `Audience::Support(now)` (`/api/admin/*`), both signed (MED-023). `CardView::new(card, attached, config, media, now)` hard-codes the dashboard audience today and is called by `routes/cards.rs` and `routes/admin_cards.rs`: it takes the `Audience` as a parameter instead of `now`. `MediaView` gains `crop: Option<CropRect>`, `video_loop: Option<VideoLoop>` (serialized `loop`), `poster_time: Option<f64>`, `duration_seconds: Option<f64>`, `source: Option<SourceView { url, width, height }>` — `source` only with `Audience::Owner`; `Public` and `Support` never carry it.
- Duplication (EDI-014): `variant_keys` only lists the variants, so the source is copied explicitly, under a **new** token name (`MediaService::copy`), with the `framing` and `duration_ms` columns. `discard_files` (and every media deletion) also removes the source: `delete_media` deletes the whole `cards/<card>/<media>/` prefix — check it does.
- `lib/media/upload.ts`: the real signature `uploadMedia(getToken, cardId, slot, file, poster?)` becomes `uploadMedia(getToken, cardId, slot, file, poster?, framing?: { crop?: CropRect; loop?: VideoLoop; posterTime?: number })`, appending the multipart fields `crop` (JSON), `loop` (JSON) and `poster_time` (decimal text) when given; the type `UploadMedia = (slot, file, poster?, framing?) => Promise<MediaView>` of `lib/api.ts` (`useUploadMedia`) follows; `MediaField.tsx`, which calls `capturePoster(file)` (0.1 s) then `send(file, poster)`, now calls `send(file, poster, { posterTime: 0.1 })` (R-S32). `make sqlx-prepare`, `make openapi`.

- [ ] **Step 1: Write the failing tests**

```rust
// tests/media.rs and media_processing.rs
// spec: MED-025, MED-007, MED-014, Review Focus 7
#[sqlx::test] async fn the_source_is_kept_oriented_without_metadata(pool) { /* JPEG with EXIF orientation 6 and GPS → the source file has swapped dimensions, no EXIF chunk; ≤ 4096; its name matches ^source-[0-9a-f]{32}\.webp$ */ }
// spec: MED-026, MED-027, MED-015
#[sqlx::test] async fn the_header_is_cut_along_the_crop(pool) { /* 1600×1200 PNG, quadrants red/green/blue/yellow; crop {0,0,0.5,0.5} → variants w750 (750×563) and w800 (800×600), centre pixel red */ }
// spec: MED-026
#[sqlx::test] async fn without_crop_the_largest_centered_rectangle_is_taken(pool) { /* 1600×900 header → framing.crop {x:0.125,y:0,width:0.75,height:1}; variant 1125×844 */ }
// spec: MED-026, Review Focus 6
#[sqlx::test] async fn a_bad_crop_is_refused_and_nothing_is_stored(pool) { /* overflow → 400 crop invalid_crop; no media row, no file */ }
// spec: MED-028, MED-029
#[sqlx::test] async fn a_video_keeps_its_framing_and_its_poster_is_cut(pool) { /* header-2s.mp4 + 1280×720 poster, crop centered 4:3, loop {0.2,1.8}, poster_time 1 → framing stored, duration_ms ≈ 2000, poster variants 4:3 */ }
// spec: MED-028
#[sqlx::test] async fn video_loop_and_poster_time_are_checked(pool) { /* loop {0.5,1.0} → invalid_loop; poster_time 3 → invalid_poster_time; none → loop {0, duration read from header-2s.mp4} (compare with a 0.05 s tolerance: the file is not exactly 2 s), poster_time 0 */ }
// spec: MED-031, Review Focus 4
#[sqlx::test] async fn a_source_is_only_read_with_the_owners_signature(pool) { /* served card: unsigned /media/…/source-<token>.webp → 404; owner GET /api/cards/{id} → source.url signed → 200; public card JSON and admin card JSON have no "source" and no "source-" substring */ }
// spec: MED-031
#[sqlx::test] async fn a_source_name_cannot_be_derived_from_the_public_files(pool) { /* S3-mode service (in-memory store behaving like S3): two uploads → two different source names matching ^source-[0-9a-f]{32}\.webp$; replacing a variant's file name in a public URL by "source.webp" reads nothing */ }
// spec: MED-033
#[sqlx::test] async fn a_media_from_before_plan_6_has_no_framing(pool) { /* row inserted with null source/framing → MediaView crop null, source null; its w640 file still served */ }
// spec: EDI-014, MED-025
#[sqlx::test] async fn duplication_copies_the_source_and_the_framing(pool) { … }
```
```ts
test("MED-028 uploadMedia sends the framing fields", …); // upload.test.ts: FormData has crop, loop, poster_time
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test media` (then `--test media_processing`, `--test media_service`), `pnpm -C frontend --filter web exec vitest run src/lib/media` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make sqlx-prepare`; `make openapi`.
- [ ] **Step 4: Run and see them pass** — same commands, then `make test-api` and `make e2e ARGS="-g 'MED-0'"` (plan 2's media e2e still passes) · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend && git commit -m "feat(api): keep a media's source and cut its files along a stored crop"`

---

### Task A11: Re-framing route

**Files:**
- Modify: `backend/server/src/routes/card_media.rs`, `backend/server/src/{app.rs, openapi.rs, error.rs}`, `backend/server/tests/media.rs`, `frontend/web/src/lib/media/{upload.ts, upload.test.ts}` (`reframeMedia`), `frontend/web/src/lib/api.ts` (`useReframeMedia`), `frontend/api-client/*` (generated). `MediaService::copy(&self, from, to)` already exists (used by duplication): reuse it.

**Rules:** MED-016, MED-018, MED-020, MED-030, ACC-017.

**Interfaces:**
- `POST /api/cards/{id}/media/{media_id}/reframe` (tag `cards`, `operation_id` `reframe_media`), multipart: `crop` (required), `loop`, `poster_time`, `poster` (optional image: the newly captured frame of a video). 201 → `MediaView` (`Audience::Owner`) of a **new** media of the same slot and kind.
- Steps: card of the caller (else 404) → media of that card (else 404) → `source` null → `409 media_not_reframable` (new `ApiError::MediaNotReframable`, code `media_not_reframable`) → read the source (image media: its stored source file; video media: the new `poster` when given, which becomes the new source, else the stored source file) → check crop/loop/poster time (A9) → new id `Uuid::now_v7()` → `MediaService::copy` of `video.mp4` (video) → put the source under a **new** name `source-<new token>.webp` (R-S37) and the cut variants under the new id → insert the row; on any failure after the first write, delete the new media's files (as `discard_files`). The previous media and its files are untouched (MED-016); the card shows the new media only after a save names it (MED-018), which deletes the previous one.
- `lib/media/upload.ts`: `reframeMedia(getToken, cardId, mediaId, framing: { crop: CropRect; loop?: VideoLoop; posterTime?: number }, poster?: Blob) -> Promise<MediaView>` (same error mapping as `uploadMedia`); `lib/api.ts` gains `useReframeMedia()` binding `getToken` and the card, like `useUploadMedia`. `make openapi`.

- [ ] **Step 1: Write the failing tests**

```rust
// spec: MED-030, MED-016, Review Focus 5
#[sqlx::test] async fn reframing_makes_a_new_media_and_leaves_the_old_one(pool) { /* old files byte-equal after; new id; public page still shows the old one */ }
// spec: MED-030, MED-018
#[sqlx::test] async fn saving_the_reframed_media_replaces_the_previous_one(pool) { /* PUT card with header_media_id = new → old files and row gone */ }
// spec: MED-020, ACC-017
#[sqlx::test] async fn another_owner_cannot_reframe(pool) { /* Bob → 404, no file written; unknown media → 404; media of another card of Alice → 404 */ }
// spec: MED-030
#[sqlx::test] async fn a_media_without_source_cannot_be_reframed(pool) { /* legacy row → 409 media_not_reframable */ }
// spec: MED-030, MED-029
#[sqlx::test] async fn a_video_is_reframed_with_or_without_a_new_frame(pool) { /* without poster → poster variants re-cut from the stored source; with poster → new source; video.mp4 copied, bytes equal */ }
// spec: MED-026
#[sqlx::test] async fn reframing_checks_the_crop(pool) { /* invalid crop → 400 invalid_crop, no new row */ }
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test media` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make openapi`.
- [ ] **Step 4: Run and see them pass** — same command, `pnpm -C frontend --filter web exec vitest run src/lib/media`, `make test-api` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend && git commit -m "feat(api): re-frame a media into a new one from its source"`

---

### Task A12: Header media on the card — video crop, loop, pause and loading

**Files:**
- Create: `frontend/web/src/lib/media/framing.ts`, `frontend/web/src/lib/media/framing.test.ts`, `frontend/web/src/templates/HeaderMedia.tsx`, `frontend/web/src/templates/HeaderMedia.test.tsx`
- Modify: `frontend/web/src/templates/classique/Classique.tsx`, `frontend/web/src/templates/contract.ts` (comment: a template may render the client components of `src/templates/`), `frontend/web/src/templates/contract.test.tsx` (it asserts `video.loop === true` and `video.autoplay === true` today, around lines 125–126: assert instead the `muted` property, `playsInline` and the absence of `loop`/`autoplay`), `frontend/e2e/tests/public-page.spec.ts` (or `media.spec.ts`), `frontend/e2e/fixtures.ts` (the existing `api.uploadMedia` helper, around line 174, gains optional `crop`, `loop` and `poster_time` fields)

**Rules:** PUB-004, PUB-005, PUB-006, PUB-031, PUB-038, MED-032, MED-033.

**Interfaces:**
- `framing.ts`:
  - `videoCropStyle(crop: CropRect | null): CSSProperties` — `null` → `{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }` (MED-033); else `{ position: "absolute", left: `${-x / w * 100}%`, top: `${-y / h * 100}%`, width: `${100 / w}%`, height: `${100 / h}%`, maxWidth: "none", objectFit: "fill" }` (MED-032).
  - `loopRestart(currentTime: number, loop: VideoLoop | null, duration: number): number | null` — the time to seek to: `loop.start` when `currentTime ≥ loop.end − 0.05` or `currentTime < loop.start − 0.05`; `0` at the end when `loop` is null; else `null`.
- `HeaderMedia` (`"use client"`): props `{ media: MediaView | null; labels: { pause: string; play: string }; reducedMotion?: () => boolean }` (defaults to `matchMedia("(prefers-reduced-motion: reduce)").matches`, injected for tests).
  - Image → `<div class="cc-media"><img class="cc-media-el" data-testid="card-header-image" …></div>`; none → the empty band (A7).
  - Video → `<div class="cc-media" aria-busy={loading}>`: the poster `<img class="cc-media-el is-blur">` + `<div class="cc-shimmer" aria-hidden>` while loading (PUB-006); `<video data-testid="card-header-video" playsInline preload="auto" poster={largest image} aria-hidden="true" style={videoCropStyle(media.crop)}>` without `loop`/`autoPlay` attributes; a ref sets `el.muted = true` (PUB-005), and unless reduced motion, seeks to `loop.start` and calls `play()` through `Promise.resolve(el.play()).catch(() => {})` (jsdom's `play()` returns `undefined`, so a bare `el.play().catch` would throw in every unit test that renders a video header); `timeupdate` applies `loopRestart`; `canplay`/`playing` ends the loading state; while loading, the `.cc-media` element also carries the class `is-loading` of the design CSS. Under reduced motion: no `play()`, the poster stays unblurred, the button reads "Lire la vidéo".
  - Pause button `<button class="cc-pause" data-testid="header-video-toggle" aria-label={playing ? labels.pause : labels.play}>` with `Pause`/`Play` (PUB-031).
- Classique renders `<HeaderMedia media={card.header} labels={{ pause: labels.pauseVideo, play: labels.playVideo }} />` inside `.cc-head`; `Classique` itself stays free of hooks.

- [ ] **Step 1: Write the failing unit tests**

```ts
test("MED-032 the crop style scales and shifts the video to show only the crop", …); // {x:0.25,y:0,width:0.5,height:1} → left -50%, width 200%, height 100%
test("MED-033 without crop the video covers the header", …);
test("MED-032 the loop returns to its start at its end", …);                          // loopRestart(8.3, {0.8, 8.3}) → 0.8; 4 → null; 0.1 → 0.8
test("PUB-005 the video is muted on the element and starts at the loop start", …);    // jsdom: HTMLMediaElement.prototype.play mocked; el.muted true; currentTime 0.8
test("PUB-005 PUB-038 under reduced motion the video does not start", …);
test("PUB-006 the header is busy until the video can play", …);                       // aria-busy true, then false after dispatching "canplay"
test("PUB-031 the button pauses and resumes and changes its name", …);
```

- [ ] **Step 2: Write the failing e2e tests** (upload a framed video to Alice's card through the API with `frontend/e2e/fixtures/header-2s.mp4` and a poster, save the card, then visit)

```ts
test("PUB-031 the pause button pauses the header video", …);  // header-video-toggle "Mettre la vidéo en pause" → click → paused, "Lire la vidéo"
test("MED-032 the video starts at its loop start", …);        // loop {0.5, 1.8}: after "playing", currentTime ≥ 0.5
test("PUB-005 reduced motion keeps the poster", …);           // emulateMedia reducedMotion reduce → video.paused true
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/media/framing src/templates/HeaderMedia` then `make e2e ARGS="-g 'PUB-005|PUB-031|MED-032'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands, plus `make e2e ARGS="-g 'PUB-0|MED-0'"` · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): header video cropped, looped and pausable on the card"`

---

### Task A13: `datetime` custom field

**Files:**
- Modify: `backend/domain/src/{form.rs, lead.rs, event.rs}`, `backend/server/src/test_support/seed.rs`, `backend/server/tests/{events.rs, leads_submit.rs}`, `frontend/web/src/lib/events/{fields.ts, types.ts}`, `frontend/web/src/lib/event-form/{answers.ts, answers.test.ts}`, `frontend/web/messages/fr.json` (the `custom.kinds.<kind>` message family `CustomFieldsEditor.tsx` already reads gets `"datetime": "Date et heure"`; the component itself does not change), `frontend/e2e/fixtures.ts` (`CustomFieldView.kind`), `frontend/api-client/*` (generated)

**Rules:** FRM-021, FRM-032, FRM-038, FRM-043, FRM-022.

**Interfaces:**
- `CustomFieldKind::Datetime` (serde `"datetime"`), placed after `Date`; no options (FRM-032): like every non-choice kind, options sent for it are **dropped silently** by the event validation (`event.rs`, around line 280), not refused.
- `lead.rs`: `parse_datetime(text) -> Option<String>` — exactly `YYYY-MM-DDTHH:MM` (16 characters, `T` separator, no seconds, no zone), date valid per FRM-035 (calendar, 1900-01-01 to 2100-12-31), `HH` 00–23, `MM` 00–59; the answer is stored as that string (FRM-043); otherwise `invalid_date`. The snapshot records kind `datetime` (FRM-022, FRM-038).
- Seed (`events` scenario, R-S31): "Démonstration en boutique" gets one custom field `{ id: 0198c8a1-0000-7000-8000-000000000005, label: "Rendez-vous souhaité", kind: Datetime, options: [] }` (seeded optional, like every seeded field); no lead added, no other event touched.
- Web: `CUSTOM_FIELD_KINDS` gains `"datetime"` after `"date"`; the current event editor's "Ajouter : {kind}" buttons (driven by `CUSTOM_FIELD_KINDS` and `custom.kinds.<kind>`) then offer "Date et heure" (its restyle is B19); `isCalendarDateTime(value)` is a new function of `answers.ts`; `answers.ts` `checkCustomText` accepts `datetime` with the same rule (`isCalendarDateTime`); `draftToSubmission` sends it as typed (trimmed). `make openapi`.

- [ ] **Step 1: Write the failing tests**

```rust
// spec: FRM-043
#[test] fn datetime_answers_are_checked() { /* "2027-03-20T14:30" ok and stored as is; "2027-02-30T10:00", "2027-02-06T24:00", "2027-02-06T14:30:00", "2027-02-06 14:30", "1899-12-31T10:00", "2027-02-06T14:30Z" → invalid_date */ }
// spec: FRM-021, FRM-032
#[test] fn a_datetime_field_drops_its_options() { /* in event.rs tests: a datetime field sent with options ["a","b"] is valid and its options are empty, as for date */ }
// spec: FRM-043, FRM-038
#[sqlx::test] async fn a_datetime_answer_is_recorded_as_typed(pool) { /* leads_submit.rs: submit → lead custom answer value "2027-03-20T14:30", kind "datetime" */ }
```
```ts
test("FRM-043 the browser checks a datetime answer as the server does", …); // answers.test.ts
test("FRM-021 the editor offers the Date et heure type", …);                // CustomFieldsEditor or fields test
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain lead` and `… event`, `cargo test -p cartouche-api --all-features --test leads_submit`, `pnpm -C frontend --filter web exec vitest run src/lib/event-form src/lib/events` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make openapi`; `make sqlx-prepare` if a query changed.
- [ ] **Step 4: Run and see them pass** — same commands, `make test-api`, `make e2e ARGS="-g 'FRM-0|EVT-0'"` (the Démonstration tests still pass: the new field is optional) · Expected: PASS.
- [ ] **Step 5: Commit** — `git add backend frontend && git commit -m "feat: datetime custom field"`

---

### Task A14: Event form restyle — structure, theme, access code, contact points

**Files:**
- Create: `frontend/web/src/components/event-form/event-form.css`, `frontend/web/src/lib/instance-links.ts`, `frontend/web/src/lib/instance-links.test.ts`
- Modify: `frontend/web/src/components/event-form/{EventFormPage.tsx, EventFormPage.test.tsx, LeadForm.tsx, LeadForm.test.tsx, AccessCodeScreen.tsx, ClosedEvent.tsx, ConsentField.tsx, Honeypot.tsx}`, delete `styles.ts` (replaced by the CSS classes), `frontend/web/src/app/c/[slug]/e/[eventId]/{page.tsx, page.test.tsx}`, `frontend/web/messages/fr.json` (`eventForm`), `.env.example` (web section: the three variables, commented, with their defaults), `frontend/e2e/tests/event-form.spec.ts`

**Rules:** FRM-001, FRM-002, FRM-003, FRM-005, FRM-006, FRM-025, FRM-044, FRM-045, FRM-048, FRM-049, TPL-020, TPL-022, ADM-021, EVT-027.

**Interfaces:**
- `event-form.css`: only the `.fm-*` rules of `frontend/design/design/Formulaire.dc.html` (`<helmet><style>`), comments in English. The `.cc` base, its derived variables (`--c-field`, `--c-field-border`, `--radius-field`…), `.cc-dot` and `.cc-save` come from `components/public/public-page.css`, which `CardStage` loads (A7, A8): never redefine them here. The page uses `CardStage(theme) > <article class="cc"> > <div class="fm">` (FRM-049, PUB-037) and never loads `classique.css`.
- `instance-links.ts`: `supportEmail()` (`NEXT_PUBLIC_SUPPORT_EMAIL` or `"support@cartouche.invalid"`), `supportMailto()` (`mailto:` + encoded address), `termsUrl()` (`NEXT_PUBLIC_TERMS_URL` or `"/cgu"`), `privacyUrl()` (`NEXT_PUBLIC_PRIVACY_URL` or `"/confidentialite"`); an empty variable counts as absent (ADM-021).
- Structure (FRM-044): back link `.fm-back` (`data-testid="event-form-back"`, `ChevronLeft`, avatar 32 px or initials, card full name) → band `.fm-head` (`.fm-live` with `.cc-dot` + "Événement en cours", `h1.fm-title` `event-form-title`, `.fm-intro` `event-form-description`) → form: `.fm-note`, fieldset "Vos coordonnées" (first and last name side by side in `.fm-row2` when both are asked), fieldset "Votre projet" only with custom fields, the consent `.fm-check` (text = the consent text of the form, FRM-026 unchanged, R-S19), the honeypot, the submit `.fm-submit` `event-form-submit` with `Send` + "Envoyer mes coordonnées", then `.fm-privacy` "Vos informations sont transmises uniquement à {name}." + `<a href={privacyUrl()}>Vos données personnelles</a>`.
- Fields (FRM-045): label + `(facultatif)` in `.fm-opt` for optional ones only; `.fm-input` everywhere; help in `.fm-hint` linked by `aria-describedby`; `datetime` → `type="datetime-local"`; every existing `data-testid` kept.
- Access-code screen (FRM-048): same back link, band with the title only, `<label>` "Code d’accès", input `access-code-input` (the current test id, kept; used by `event-form.spec.ts`, `EventFormPage.test.tsx` and `page.test.tsx`), button "Continuer"; the intro sentence and error texts of today kept (the intro explains where the code comes from; FRM-048's "single field" is about inputs), typography fixed. Closed screen: band + text + "Retour à la carte".
- `fr.json` `eventForm` (new or changed): `live` "Événement en cours", `note` "Tous les champs sont obligatoires, sauf mention «\u00a0facultatif\u00a0».", `optional` "facultatif", `sections.contact` "Vos coordonnées", `sections.project` "Votre projet", `submit` "Envoyer mes coordonnées", `privacy` "Vos informations sont transmises uniquement à {name}.", `privacyLink` "Vos données personnelles", `code.label` "Code d’accès"; every existing text of `eventForm` rewritten with ’ and `\u00a0` before `:`/`?`/`!`.

- [ ] **Step 1: Write the failing unit tests**

```ts
test("ADM-021 contact points default to placeholders and follow the configuration", …);
test("FRM-044 the page shows the back link, the band, the note, the sections and the privacy line", …);
test("FRM-044 no custom field, no Votre projet section", …);
test("FRM-045 only optional fields are marked facultatif", …);
test("FRM-048 the code screen shows the title only, one field and Continuer", …);
test("FRM-039 FRM-043 a datetime field is a datetime-local input", …);   // owned here: A14 renders the datetime-local input
test("FRM-049 TPL-022 the form uses the card theme and its error colour", …);   // wrapper style --c-danger #FF8A80 with encre
```

- [ ] **Step 2: Write the failing e2e tests** (`event-form.spec.ts`; adapt the existing tests to the new texts)

```ts
test("FRM-044 the Mariage form has both sections and the privacy link", …);   // "Vos coordonnées", "Votre projet", link href "/confidentialite"
test("FRM-048 the Portes ouvertes code screen", …);                           // "Code d’accès", "Continuer", no description before the code
test("FRM-049 a dark theme gives dark native controls", …);                   // PUT theme encre; getComputedStyle(.cc-page).colorScheme === "dark"
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/event-form src/lib/instance-links "src/app/c"` then `make e2e ARGS="-g 'FRM-0'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend .env.example && git commit -m "feat(web): event form restyled with the card theme, code screen and contact points"`

---

### Task A15: Event form — error messages, summary, confirmation, date and time

**Files:**
- Create: `frontend/web/src/lib/event-form/{errors.ts, errors.test.ts, contact-label.ts, contact-label.test.ts}`
- Modify: `frontend/web/src/components/event-form/{LeadForm.tsx, LeadForm.test.tsx, Confirmation.tsx, EventFormPage.tsx, EventFormPage.test.tsx}`, `frontend/web/src/lib/event-form/{flow.ts, flow.test.ts}` (prospect first name kept for the confirmation), `frontend/web/messages/fr.json` (`eventForm.errors`, `eventForm.summary`, `eventForm.confirmation`), `frontend/e2e/tests/event-form.spec.ts`

**Rules:** FRM-015, FRM-039, FRM-043, FRM-046, FRM-047, FRM-004, FRM-030, FRM-040, FRM-041, FRM-042.

**Interfaces:**
- `errors.ts`: `fieldMessageKey(path: string, code: string, kind?: CustomFieldKind): string` — the keys below, falling back to `fieldErrorKey(code)` of `lib/field-errors.ts` (reused, not re-implemented); `errorCount(errors: Record<string, string>): number`.

| Path / kind | Code | Key → text |
|---|---|---|
| `answers.first_name` | `required` | `eventForm.errors.firstNameRequired` → "Indiquez votre prénom." |
| `answers.last_name` | `required` | `…lastNameRequired` → "Indiquez votre nom." |
| `answers.birth_date` | `required` / `invalid_date` | `…birthDateRequired` → "Indiquez votre date de naissance." / `…birthDateInvalid` → "Vérifiez la date de naissance." |
| `answers.email` | `required` / `invalid_email` / `too_long` | "Indiquez votre adresse e-mail." / "Vérifiez l’adresse e-mail (exemple\u00a0: nom@domaine.fr)." / "Cette adresse e-mail est trop longue." |
| `answers.phone` | `required` / `invalid_phone` | "Indiquez votre numéro de téléphone." / "Vérifiez le numéro de téléphone (exemple\u00a0: 06 12 34 56 78)." |
| `answers.address.street|postal_code|city|country` | `required` | "Indiquez la rue." / "Indiquez le code postal." / "Indiquez la ville." / "Indiquez le pays." |
| custom `text`, `long_text` | `required` | "Indiquez une réponse." |
| custom `date` / `datetime` | `required` | "Indiquez une date." / "Indiquez une date et une heure." |
| custom `date`, `datetime` | `invalid_date` | "Vérifiez la date." |
| custom `number` | `required` / `invalid_number` | "Indiquez un nombre." / "Indiquez un nombre, par exemple 80 ou 12,5." |
| custom `single_choice` | `required` / `invalid_choice` | "Choisissez une option." / "Choisissez l’une des options proposées." |
| custom `checkbox` | `required` | "Cochez cette case pour continuer." |
| any | `too_long` | "Ce texte est trop long." |
| `consent` | `required` | "Cochez cette case pour envoyer vos coordonnées." |

- Summary (FRM-046): it replaces today's `eventForm.fix` text (`EventFormPage.tsx`, around lines 113 and 166), whose key is removed from `fr.json`. `.fm-alert` `role="alert"` `data-testid="event-form-summary"` with `CircleAlert` and `eventForm.summary` = `"Vos coordonnées n’ont pas été envoyées\u00a0: {count, plural, one {# champ est à corriger.} other {# champs sont à corriger.}}"`, shown after a refusal by the browser check or a server `400` (field errors), above the fields; the focus goes to the first `[aria-invalid="true"]` (already done by `attempt`); messages `.fm-error` with `CircleAlert`, `id` referenced by `aria-describedby`. Inputs are never cleared (FRM-015, FRM-040).
- Confirmation (FRM-047): `.fm-done` `role="status"` `data-testid="event-form-confirmation"`: `.fm-done-mark` `Check`; title `eventForm.confirmation.title` "Merci {firstName}, c’est envoyé\u00a0!" or `…titleAnonymous` "Merci, c’est envoyé\u00a0!" (the trimmed first name the prospect sent); text "{name} a bien reçu vos coordonnées."; `.cc-save` with the current test id `confirmation-save-contact` (kept; `save-contact` is the card's own button, `TEMPLATE_TEST_IDS.saveContact`) "Enregistrer le contact de {cardFirstName}", "Enregistrer le contact d’{cardFirstName}" before a vowel (a, e, i, o, u, y, accented or not; `lib/event-form/contact-label.ts` picks the message `eventForm.confirmation.saveContactOf` or `…saveContactOfElided`), or "Enregistrer le contact" (card without first name) → vCard; link `.fm-link` "Retour à la carte". The other states (refusals of FRM-042, network error) keep their texts, typography fixed.

- [ ] **Step 1: Write the failing unit tests**

```ts
test("FRM-046 each field has its own message", …);                         // errors.test.ts: table above
test("FRM-046 the summary counts the fields and takes the focus to the first one", …);
test("FRM-046 a server refusal shows the same summary", …);                // 400 validation_failed with 2 fields
test("FRM-047 the confirmation thanks the prospect by first name", …);
test("FRM-047 without first names the confirmation stays neutral", …);
test("FRM-047 de becomes d’ before a vowel", …);                         // Camille → "de Camille", Alice → "d’Alice", Éloïse → "d’Éloïse"
```

- [ ] **Step 2: Write the failing e2e tests**

```ts
test("FRM-046 four errors: summary, focus and messages", …);   // Mariage: Prénom "Inès", Nom empty, E-mail "ines.martin@", Nombre d'invités "abc", consent unchecked → "Vos coordonnées n’ont pas été envoyées : 4 champs sont à corriger.", focus on Nom, "Indiquez votre nom.", "Vérifiez l’adresse e-mail (exemple : nom@domaine.fr).", typed values kept
test("FRM-047 confirmation and vCard of Alice", …);           // Mariage submitted as Inès → "Merci Inès, c’est envoyé !", "Alice Durand a bien reçu vos coordonnées.", "Enregistrer le contact d’Alice"
test("FRM-043 a date and time answer reaches the owner", …);  // Démonstration: Rendez-vous souhaité 2027-03-20T14:30 → owner's API lead list value "2027-03-20T14:30"
```

- [ ] **Step 3: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/event-form src/components/event-form` then `make e2e ARGS="-g 'FRM-0'"` · Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run and see them pass** — same commands, plus `make e2e ARGS="-g 'FRM-0|EVT-0|ABU-0'"` · Expected: PASS.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(web): event form messages, error summary and confirmation of the design"`

---

### Task A16: Phase A — spec status, documentation and final check

**Files:**
- Modify: `spec/{templates-themes.md, public-page.md, media.md, card-links.md, event-form.md, admin-support.md}` (status lines), `CLAUDE.md`, `.claude/skills/{add-card-template, change-api, dev-env, run-tests}/SKILL.md`, `docs/superpowers/plans/2026-11-03-cartouche-plan-6-followups.md`

- [ ] **Step 1: Status lines**, exactly:
  - `templates-themes.md`: `> Status: implemented (plans 2, 3 and 6 phase A); TPL-013 and TPL-024 in the editor (message with the ratio, fix button): plan 6 (phase B, Task B14)`
  - `public-page.md`: `> Status: implemented (plans 2, 3 and 6)`
  - `media.md`: `> Status: implemented (plans 2, 3 and 6); the crop dialogs of EDI-026, EDI-034 and EDI-035: plan 6 (phase B)`
  - `card-links.md`: `> Status: implemented (plans 2, 3 and 6 phase A); LNK-015 and LNK-016: plan 4; LNK-035 and LNK-036: plan 6 (phase B)`
  - `event-form.md`: `> Status: implemented (plans 3 and 6)`
  - `admin-support.md`: replace `ADM-021: plan 6 (phase A)` by `ADM-021: plan 6`.
- [ ] **Step 2: Documentation** (English): `CLAUDE.md` repository map (`src/app/tokens.css`, `src/lib/theme/` with `themes.json` and its Rust copy `backend/domain/src/theme/presets.json` kept equal by a test, `src/lib/media/framing.ts`, `src/templates/HeaderMedia.tsx`, `src/lib/instance-links.ts`), the three `NEXT_PUBLIC_*` contact points; `add-card-template`: `--c-*` variables and `themeToCssVars`, the CSS class approach of Classique, test ids, both link layouts; `change-api`: media framing fields, `reframe`, `Audience::Owner`/`Support`, codes `low_contrast`, `invalid_crop`, `invalid_loop`, `invalid_poster_time`, `media_not_reframable`; `dev-env`: switching a seeded card's theme through the API; `run-tests`: font and reduced-motion e2e tips.
- [ ] **Step 3: Coverage** — `node scripts/spec-lint.mjs --coverage` · Expected: none of TPL-009 to TPL-027 (TPL-013 and TPL-024 are cited by A2 and A4's tests; their editor part is tested in B14), PUB-004 to PUB-008, PUB-023, PUB-030 to PUB-038, MED-015, MED-025 to MED-033, LNK-023, LNK-027, LNK-034, FRM-021, FRM-039, FRM-043 to FRM-049, ADM-021 in the uncited list (a remaining one gets its test in the task that owns it).
- [ ] **Step 4: Full check** — `make lint test` then `make e2e` · Expected: everything passes on `mobile` and `desktop`.
- [ ] **Step 5: Commit** — `git add spec docs CLAUDE.md .claude && git commit -m "docs: plan 6 phase A implemented"`

---

# Phase B — dashboard (only after plan 4 is merged into `main` and `main` into this branch)

### Task B1: Integrate plan 4

**Files:** whatever the merge left in conflict; `spec/{account-auth.md, admin-support.md, card-links.md, dashboard-editor.md, leads-exports.md, glossary.md}`, `frontend/e2e/tests/{account-deletion.spec.ts, …}`, `backend/.sqlx/`, `frontend/api-client/*`, `docs/superpowers/plans/2026-11-03-cartouche-plan-6-followups.md`

**Rules:** LNK-027, LNK-034, ACC-019 (plan 4), EDI-022.

- [ ] **Step 1: Spec** — merge both sides of each conflicting status line into one; glossary: keep plan 4's rows and plan 6's "Neutral page"; amend plan 4's **ACC-019** to say the "Mon compte" page is "reached from the dashboard navigation (EDI-022)" instead of "from the header"; `node scripts/spec-lint.mjs` passes.
- [ ] **Step 2: Generated files and database** — `make sqlx-prepare`, `make openapi`; if `sqlx migrate run` refuses the dev database (0006 after 0007/0008), recreate `cartouche_plan6` and re-run.
- [ ] **Step 3: Plan 4's tests** — replace "Cette carte n'est plus active" by "Cette carte n’est pas disponible" (and 200 by 404 where asserted) in plan 4's e2e tests (account deletion, blocked slugs); run `make e2e ARGS="-g 'ACC-0|LNK-03|LEA-0|ADM-0'"` · Expected: PASS.
- [ ] **Step 4: Full check** — `make lint test` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: integrate plan 4 into the design milestone"`

---

### Task B2: `datetime` answers in exports, detail view and search

**Files:**
- Modify: `backend/domain/src/export/{table.rs, csv.rs, xlsx.rs, json.rs}`, `frontend/web/src/lib/events/{lead-answers.ts, lead-answers.test.ts, lead-search.test.ts}`, `frontend/e2e/tests/exports.spec.ts`

**Rules:** LEA-033, FRM-043.

**Interfaces:** `Cell::LocalDateTime(NaiveDateTime)` built from a `datetime` snapshot (`%Y-%m-%dT%H:%M`, unparsable → `Text`), never converted to the export's zone; CSV `YYYY-MM-DD HH:MM`; XLSX date cell with format `yyyy-mm-dd hh:mm`; JSON value unchanged (the recorded string). Web `displayAnswer` for `datetime`: `"20/03/2027 à 14:30"` (`dd/MM/yyyy 'à' HH:mm`, no zone conversion); the search does not match it.

- [ ] **Step 1: Failing tests** — Rust: `// spec: LEA-033` table cell, CSV line, XLSX cell read back with `calamine`, JSON value; TS: `test("LEA-033 a datetime answer reads 20/03/2027 à 14:30", …)`, `test("LEA-033 the search ignores datetime answers", …)`; e2e: `test("LEA-033 a datetime answer in the CSV", …)` (submit the Démonstration form with 2027-03-20T14:30, export its event as CSV → column "Rendez-vous souhaité" holds `2027-03-20 14:30`).
- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain export`, `pnpm -C frontend --filter web exec vitest run src/lib/events`, `make e2e ARGS="-g LEA-033"` · Expected: FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: datetime answers in exports and in the lead detail"`

---

### Task B3: Dashboard primitives on the "Atelier" tokens

**Files:**
- Create: `frontend/web/src/components/ui/{alert-dialog.tsx, sheet.tsx, dropdown-menu.tsx, radio-group.tsx, toaster.tsx}`, `frontend/web/src/lib/toast.ts`, `frontend/web/src/components/ui/primitives.test.tsx`
- Modify: `frontend/web/package.json` (`@radix-ui/react-alert-dialog@^1.2.1`, `@radix-ui/react-dropdown-menu@^2.2.1`, `@radix-ui/react-radio-group@^1.5.1`, `sonner@^2.0.8`), `frontend/web/src/app/globals.css`, `frontend/web/src/app/(app)/layout.tsx`, `frontend/web/src/components/ui/{button.tsx, badge.tsx, input.tsx, select.tsx, switch.tsx, tabs.tsx, dialog.tsx, slider.tsx}`

**Rules:** TPL-026, EDI-011.

**Interfaces:**
- `globals.css`: the shadcn variables point at the tokens (`--background: var(--app-bg)`, `--foreground: var(--app-text)`, `--card`/`--popover: var(--app-surface)`, `--primary: var(--app-primary)`, `--primary-foreground: var(--app-on-primary)`, `--secondary`/`--accent`/`--muted: var(--app-surface-2)`, `--muted-foreground: var(--app-muted)`, `--border: var(--app-border)`, `--input: var(--app-border-strong)`, `--ring: var(--app-ring)`, `--destructive: var(--app-danger)`, `--radius: var(--app-radius)`); the `.dark` block is removed. The `(app)` layout wraps its children in `<div class="font-app bg-app-bg text-app-text min-h-screen">` (the app font is never set on `body`, R-S16).
- Styles from `frontend/design/design/AppTokens.dc.html`: buttons (primary, secondary, ghost, danger) and every interactive primitive at least 44 px high; focus `outline: 2px solid var(--app-ring); outline-offset: 2px`; badges `success`, `neutral`, `warning`, `danger`, `info` with their `-soft` backgrounds and the dot; `RadioGroup` in its segmented look; `Toaster` (Sonner) bottom-centre, dark, `lib/toast.ts` wraps `toast(message, { action })` so components never import Sonner directly.

- [ ] **Step 1: Failing tests** — `test("TPL-026 the dashboard has no card variable", …)` (render the app layout: no `--c-` on its elements), `test("EDI-011 the AlertDialog focuses its default action and closes on Escape", …)`, `test("EDI-011 toast shows its action and calls it", …)`.
- [ ] **Step 2–4:** run (`vitest run src/components/ui`), implement, run again with `make e2e ARGS="-g 'ACC-0|EDI-0'"` (screens unchanged in behaviour).
- [ ] **Step 5: Commit** — `git commit -m "feat(web): dashboard primitives on the Atelier tokens"`

---

### Task B4: Dashboard shell

**Files:**
- Create: `frontend/web/src/components/shell/{AppShell.tsx, SideNav.tsx, TopBar.tsx, TabBar.tsx, BrandMark.tsx, AppShell.test.tsx}`
- Modify: `frontend/web/src/components/account/AccountGate.tsx` (approved accounts render inside `AppShell`; plan 4's `account-link` test id moves to the "Mon compte" nav item), the dashboard pages (title, breadcrumb, mobile back action props), `frontend/web/messages/fr.json` (`shell`), `frontend/e2e/tests/shell.spec.ts`

**Rules:** EDI-022, ACC-019 (plan 4).

**Interfaces:** layout of `AppCartes.dc.html` / `AppEditeur.dc.html`: side bar 248 px (`BrandMark` = the `.a-mark` SVG of the mockups + "Cartouche"; nav `nav-cards` "Mes cartes" → `/dashboard`, `nav-contacts` "Contacts" → `/dashboard/contacts`, `nav-account` "Mon compte" → `/dashboard/account`; the user's display name and email at the bottom); top bar 68 px with a breadcrumb (`aria-label="Fil d’Ariane"`) on card screens; content max 1,160 px; below 600 px of the main area (container query `@container` with `container-type: inline-size`): top bar 56 px (back, title, action) and bottom tab bar with the same three entries (`aria-label="Navigation principale"`); `AppShell` takes a `saveBar` slot that replaces the tab bar on phones (editors). Active entry: `aria-current="page"`, brand colour `--app-brand`.

- [ ] **Step 1: Failing tests** — `test("EDI-022 the side bar lists Mes cartes, Contacts and Mon compte, the current one marked", …)`, `test("EDI-022 a save bar replaces the tab bar", …)`; e2e `test("EDI-022 navigation on a computer and on a phone", …)` (desktop: side nav; mobile: tab bar; each entry opens its page).
- [ ] **Step 2–4:** run, implement, run (`make e2e ARGS="-g 'EDI-0|ACC-0'"`).
- [ ] **Step 5: Commit** — `git commit -m "feat(web): dashboard shell with side bar and phone tab bar"`

---

### Task B5: Sign-in page and account-state screens

**Files:**
- Modify: `frontend/web/src/app/(app)/login/{page.tsx, page.test.tsx}`, `frontend/web/src/lib/auth/adapters/clerk.tsx` (appearance), `frontend/web/src/components/account/{AccountGate.tsx, AccountGate.test.tsx}` (restyle, plan 4's `DeleteAccount` offer kept), `frontend/web/messages/fr.json` (`auth`, `account`), `frontend/e2e/tests/account.spec.ts`

**Rules:** ACC-010, ACC-011, ACC-025, ACC-026, ADM-021.

**Interfaces:**
- Login: two columns from 600 px (left: `BrandMark`, h1 "Ta carte de visite, toujours à jour.", the three arguments "Un tag NFC ou un QR code", "Une page à ton image", "Les contacts de tes salons, au même endroit", a `Classique` preview of a sample card with the `terracotta` theme and the texts of `AppAcces.dc.html`; right: the sign-in block), one column on phones (tagline above the block). The block is Clerk's `SignIn` with the appearance object of `HANDOFF.md` §6.1 verbatim (check the `elements` keys against the installed `@clerk/nextjs` version and keep the 44 px minimum), or the test adapter's `TestLoginPanel` in the same frame. Under the block: "En continuant, tu acceptes les " + link "Conditions générales d’utilisation" (`termsUrl()`) + " et la " + link "Politique de confidentialité" (`privacyUrl()`) + ".".
- States (ACC-026), centered card with badge, icon, title, text and buttons (`AppAcces.dc.html`):
  - pending: badge "En attente" (warning), title "Ton compte est en attente de validation", text "Merci pour ton inscription. Nous validons chaque nouveau compte à la main\u00a0: tu pourras utiliser Cartouche avec {email} dès qu’il sera activé." (without email: "… à la main\u00a0: tu pourras utiliser Cartouche dès que ton compte sera activé."), button "Se déconnecter" (R-S23);
  - rejected: badge "Inscription refusée" (danger), title "Ton inscription n’a pas été acceptée", text "Ce compte ne peut pas utiliser Cartouche. Si tu penses qu’il s’agit d’une erreur, écris-nous\u00a0: nous reverrons ta demande.", buttons "Contacter le support" (`supportMailto()`) and "Se déconnecter";
  - suspended: badge "Suspendu" (neutral), title "Ton compte est suspendu", text "Tu ne peux plus modifier tes cartes pour le moment. Contacte le support pour connaître la raison et la marche à suivre.", same two buttons;
  - plan 4's "Supprimer mon compte" stays offered under these screens (restyle only).

- [ ] **Step 1: Failing tests** — `test("ACC-025 the sign-in page links to the terms and the privacy policy", …)`, `test("ACC-026 each account state has its badge, title, text and actions", …)`; e2e `test("ACC-011 ACC-026 a pending account sees its email and can sign out", …)` (seed-carol), `test("ACC-026 a suspended account can contact support", …)` (mailto href `support@cartouche.invalid`).
- [ ] **Step 2–4:** run, implement, run (`make e2e ARGS="-g 'ACC-0'"`).
- [ ] **Step 5: Commit** — `git commit -m "feat(web): sign-in page and account-state screens of the design"`

---

### Task B6: API — card summaries, events limit and account totals

**Files:**
- Modify: `backend/server/src/{views.rs, db/cards.rs, routes/cards.rs, routes/me.rs, db/users.rs}`, `backend/server/tests/{cards.rs, account.rs}`, `frontend/api-client/*`, `backend/.sqlx/`, web fixtures (`card-view.fixture.ts`)

**Rules:** EDI-023, EDI-024, EDI-032, ACC-027, ACC-017, EVT-019, EVT-020.

**Interfaces:** `CardView` gains `event_counts: { running: u32, upcoming: u32, past: u32 }` (EVT-020 with `state.clock.now()`) and `lead_count: i64` (spam included), computed in `db/cards.rs` with the owner filter (list and get); `MeView` gains `max_simultaneous_events: u32` (config, EVT-019) and `totals: { cards, events, leads }` of the caller (zeros for a non-approved account). `make sqlx-prepare`, `make openapi`.

- [ ] **Step 1: Failing tests** — `// spec: EDI-023` counts by phase at a frozen clock; `// spec: EDI-024` lead counts; `// spec: EDI-032, EVT-019` `MAX_SIMULTANEOUS_EVENTS=5` → `max_simultaneous_events` 5; `// spec: ACC-027` totals; `// spec: ACC-017` Bob's totals ignore Alice's data.
- [ ] **Step 2–4:** `cargo test -p cartouche-api --all-features --test cards` / `--test account`, implement, `make test-api`.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): card event and lead counts, events limit and account totals"`

---

### Task B7: API — slug suggestions when the slug is taken

**Files:** `backend/domain/src/slug.rs`, `backend/server/src/routes/slugs.rs`, `backend/server/tests/slugs.rs`, `frontend/api-client/*`

**Rules:** LNK-035, LNK-018, LNK-019, LNK-022 (and plan 4's blocked slugs, which the suggestion skips).

**Interfaces:** the availability response gains `suggestions: string[]`: when the state is taken or reserved, the first three available slugs of `<slug>-2`, `<slug>-3`, … (the base cut so that the suffix fits 64 characters, LNK-018; blocked slugs skipped); empty otherwise. `make openapi`.

- [ ] **Step 1: Failing tests** — `// spec: LNK-035` taken `alice-durand` → `["alice-durand-2", "alice-durand-3", "alice-durand-4"]` (with `alice-durand-2` taken → `-3, -4, -5`); available or invalid → `[]`; a 64-character slug → suggestions of 64 characters at most.
- [ ] **Step 2–5:** run, implement, run, commit `feat(api): slug suggestions when the slug is taken`.

---

### Task B8: API — a card blocked by support is read-only

**Files:** `backend/server/src/routes/{cards.rs, card_media.rs}`, `backend/server/tests/{cards.rs, media.rs}`, `frontend/api-client/*`

**Rules:** LNK-036, LNK-028, EVT-025, LNK-008.

**Interfaces:** `PUT /api/cards/{id}`, `POST /api/cards/{id}/media` and `POST /api/cards/{id}/media/{media_id}/reframe` answer `409 card_disabled_by_support` when the card is blocked by support (checked with the owner filter, after the 404 of another owner's card); events and exports unchanged.

- [ ] **Step 1: Failing tests** — `// spec: LNK-036` each of the three routes → 409, nothing changed; event creation on that card still 201 (`EVT-025`); export still 200 (`LNK-008`).
- [ ] **Step 2–5:** run, implement (`make openapi` for the descriptions), run, commit `feat(api): a card blocked by support is read-only for its owner`.

---

### Task B9: "Mes cartes"

**Files:**
- Create: `frontend/web/src/components/cards/{CardThumbnail.tsx, DeleteCardDialog.tsx, CardMenu.tsx}` (+ tests), `frontend/web/src/lib/cards/summary.ts` (+ test)
- Modify: `frontend/web/src/components/cards/{CardList.tsx, CardList.test.tsx, CardActions.tsx, CardActions.test.tsx, CardStatusBadge.tsx, ShareCard.tsx}`, `frontend/web/src/app/(app)/dashboard/page.tsx`, `frontend/web/messages/fr.json` (`cards`), `frontend/e2e/tests/cards.spec.ts`

**Rules:** EDI-001, EDI-002, EDI-012, EDI-023, EDI-024, EDI-025, LNK-011, LNK-017, LNK-036, TPL-026, ADM-021.

**Interfaces:** layout of `AppCartes.dc.html` (desktop table, phone cards): header "Mes cartes", sub "{n} cartes · {m} actives" (ICU plurals), button "Créer une carte"; each row: `CardThumbnail` (a mini Classique header + initials with `themeToCssVars` on the thumbnail element), name + job title, public link in `font-app-mono` + icon button `aria-label="Copier le lien de {slug}"` (clipboard behind an injected function; toast "Lien copié\u00a0: {link}"), state badge (`Active` success, `Désactivée` neutral, `Désactivée par le support` warning + link "Contacter le support"), events summary from `lib/cards/summary.ts` (`eventSummary({running, upcoming})` → "1 en cours · 1 à venir" / "2 à venir" / "Aucun événement à venir") linking to the card's events, "Modifier" and the `DropdownMenu` (`aria-label="Plus d’actions pour {slug}"`): "Ouvrir la page publique", "Dupliquer", "Désactiver"/"Réactiver", "Supprimer…"; a support-blocked card has no "Modifier", "Désactiver"/"Réactiver" or "Dupliquer". Hint under the list: "Une carte désactivée affiche la page «\u00a0Cette carte n’est pas disponible\u00a0»\u00a0; tu peux la réactiver à tout moment." Delete `AlertDialog`: title "Supprimer cette carte\u00a0?", text "La carte {slug}, ses {n} événements et ses {m} contacts seront supprimés définitivement. Les tags NFC et QR codes qui pointent vers ce lien afficheront «\u00a0Cette carte n’est pas disponible\u00a0».", buttons "Annuler" (default) and "Supprimer définitivement" (danger). Empty state: "Crée ta première carte", text "Ta carte, c’est ta page publique\u00a0: tes coordonnées, tes liens, et un bouton pour t’enregistrer en un geste. Ton prénom et ton nom suffisent pour commencer.", button "Créer une carte". Loading: skeleton rows `aria-label="Chargement des cartes"`. Existing test ids kept.

- [ ] **Step 1: Failing tests** — `test("EDI-023 the events summary leaves out the empty parts", …)`, `test("EDI-023 copying the link confirms Lien copié", …)`, `test("EDI-024 the deletion dialog gives the slug and the counts", …)`, `test("EDI-025 no card: one button to create the first one", …)`, `test("LNK-036 a card blocked by support has no edit action and offers support", …)`; e2e `test("EDI-023 EDI-024 the card list of Alice", …)` (alice-durand "3 en cours · 1 à venir", alice-archive "Désactivée", copy toast, delete dialog text with "6 événements" and "4 contacts", cancel).
- [ ] **Step 2–4:** run, implement, run (`make e2e ARGS="-g 'EDI-0|LNK-0'"`).
- [ ] **Step 5: Commit** — `git commit -m "feat(web): Mes cartes in the design"`

---

### Task B10: Card creation page

**Files:** `frontend/web/src/components/cards/{NewCardForm.tsx, NewCardForm.test.tsx, SlugField.tsx, SlugField.test.tsx}`, `frontend/web/src/lib/cards/{slug-availability.ts, slug-availability.test.ts}`, `frontend/web/src/app/(app)/dashboard/cards/new/page.tsx`, `frontend/web/messages/fr.json`, `frontend/e2e/tests/cards.spec.ts`

**Rules:** EDI-013, EDI-025, LNK-019, LNK-020, LNK-035.

**Interfaces:** `AppCartes.dc.html` "Nouvelle carte": breadcrumb "Mes cartes › Nouvelle carte", sub "Commence par l’essentiel\u00a0: tu compléteras le reste dans l’éditeur.", fields "Prénom", "Nom", "Lien de la carte" with the fixed prefix `<host>/c/` (`…/c/` on phones) and the editable slug in mono, hint "Proposé à partir de ton nom. Choisis-le bien\u00a0: il sera inscrit dans tes tags NFC et tes QR codes. Lettres minuscules, chiffres et tirets." (phone: "Il sera inscrit dans tes tags NFC et tes QR codes."); availability as the user types: success "Ce lien est disponible.", error "Ce lien est déjà pris. Choisis-en un autre ou prends une suggestion\u00a0:" + the suggestions as buttons (`slug-suggestion-<slug>`) that fill the field; reserved and invalid keep their messages; buttons "Annuler", "Créer la carte".

- [ ] **Step 1: Failing tests** — `test("LNK-035 a taken slug shows three suggestions that fill the field", …)`; e2e `test("LNK-035 EDI-025 creating a card with a suggested slug", …)` (type alice-durand → pick alice-durand-2 → create → editor).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): card creation page with slug suggestions`.

---

### Task B11: Card editor layout, save feedback and preview

**Files:**
- Create: `frontend/web/src/components/editor/{EditorSections.tsx, ErrorSummary.tsx}`, `frontend/web/src/lib/cards/section-summary.ts` (+ tests for each)
- Modify: `frontend/web/src/components/editor/{CardEditor.tsx, CardEditor.test.tsx, PhonePreview.tsx, ContentFields.tsx, Field.tsx}`, `frontend/web/src/app/(app)/dashboard/cards/[id]/page.tsx`, `frontend/web/messages/fr.json` (`editor`), `frontend/e2e/tests/editor.spec.ts`

**Rules:** EDI-003, EDI-004, EDI-005, EDI-006, EDI-015, EDI-017, EDI-027, LNK-036.

**Interfaces:** `AppEditeur.dc.html`: desktop form left with anchor tabs "Identité · Coordonnées · Liens · Médias · Apparence" (`aria-label="Sections"`), preview right in a phone frame labelled "Aperçu" + badge "Brouillon, non publié", switch "Simuler un événement en cours", note "L’aperçu suit chaque frappe. Rien n’est publié avant «\u00a0Enregistrer\u00a0»."; top bar: breadcrumb, `/c/<slug>`, badge "Modifications non enregistrées" (warning), "{n} erreurs à corriger" badge after a refused save, "Page publique" link, "Enregistrer" button. Phone: segmented tabs "Modifier" / "Aperçu", collapsible sections with summaries (`lib/cards/section-summary.ts`: Identité → full name; Coordonnées → "email · phone"; Liens → "{n} réseaux · {m} liens libres"; Médias → "Vidéo d’en-tête · photo de profil" / "Photo d’en-tête" / "Aucun média"; Template → "Classique · liens en icônes|en liste"; Thème → EDI-030 summary), sticky save bar (`AppShell.saveBar`). Error summary "Rien n’a été enregistré\u00a0: {n, plural, one {# point à corriger} other {# points à corriger}}." with links to each field id. Toast "Carte enregistrée et publiée". Field hints: Description "Deux ou trois lignes s’affichent le mieux."; optional fields marked "(facultatif)". A card blocked by support opens read-only with a notice (LNK-036).

- [ ] **Step 1: Failing tests** — `test("EDI-027 the unsaved badge follows the draft", …)`, `test("EDI-027 a refused save lists the fields with links", …)`, `test("EDI-027 a successful save says Carte enregistrée et publiée", …)`, `test("EDI-003 on a phone Modifier and Aperçu switch views", …)`, `test("LNK-036 a blocked card opens read-only", …)`; e2e updates of `editor.spec.ts` + `test("EDI-027 save feedback", …)`.
- [ ] **Step 2–5:** run, implement, run (`make e2e ARGS="-g 'EDI-0|MED-0|TPL-0'"`), commit `feat(web): card editor layout and save feedback of the design`.

---

### Task B12: Leave dialog for both editors

**Files:** `frontend/web/src/components/editor/LeaveDialog.tsx` (+ test), `frontend/web/src/lib/navigation/leave-guard.ts` (+ test), `frontend/web/src/components/editor/CardEditor.tsx`, `frontend/web/src/components/events/EventEditor.tsx` (plan 4's guard: restyle, keep its dirty logic), `frontend/web/messages/fr.json`, `frontend/e2e/tests/{editor.spec.ts, events.spec.ts}`

**Rules:** EDI-016, EDI-028, EDI-021 (plan 4).

**Interfaces:** `leave-guard.ts`: `useLeaveGuard({ dirty, save })` intercepting in-app link clicks (anchor `click` capture on the shell, Next `router.push` wrapper) → opens `LeaveDialog`; `beforeunload` kept for tab close/reload. Dialog (`AlertDialog`, phone: bottom sheet): title "Quitter sans enregistrer\u00a0?", text card editor "Tu as modifié la carte de {name}. Si tu quittes maintenant, ces modifications seront perdues\u00a0; la page publique reste telle qu’elle était." (phone: "Tes modifications seront perdues\u00a0; la page publique reste telle qu’elle était."), event editor "Tu as modifié l’événement «\u00a0{title}\u00a0». Si tu quittes maintenant, ces modifications seront perdues."; buttons "Rester" (default focus), "Quitter sans enregistrer", "Enregistrer et quitter" (navigates only after a successful save; a refused save closes the dialog and shows the errors). Plan 4's `window.confirm` texts are removed.

- [ ] **Step 1: Failing tests** — `test("EDI-028 leaving with changes opens the dialog, Rester stays", …)`, `test("EDI-028 Enregistrer et quitter leaves only after the save", …)`, `test("EDI-028 without changes nothing is asked", …)`; e2e `test("EDI-028 card editor: leave dialog", …)` and `test("EDI-028 event editor: leave dialog", …)` (replace plan 4's `dialog` event assertions).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): leave dialog with three choices in both editors`.

---

### Task B13: Links editor with reordering

**Files:** `frontend/web/package.json` (`@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`), `frontend/web/src/components/editor/{LinksEditor.tsx, LinksEditor.test.tsx}`, `frontend/web/src/lib/cards/reorder.ts` (+ test), `frontend/web/messages/fr.json`, `frontend/e2e/tests/editor.spec.ts`

**Rules:** EDI-029, PUB-022, PUB-012.

**Interfaces:** `AppEditeur.dc.html` "Liens": hint "Glisse la poignée, ou utilise les flèches du clavier, pour changer l’ordre."; each network row: handle button `aria-label="Déplacer {name}"`, icon, name, address input, remove `aria-label="Retirer {name}"`; free links: handle, "Intitulé", "Adresse", remove; buttons "Ajouter un réseau" (menu of the seven kinds) and "Ajouter un lien libre"; at 20 links both are disabled with the existing max message. `reorder.ts`: `moveItem(list, from, to)`, `announcement(name, position, total)` → "{name}, position {n} sur {total}" in an `aria-live="polite"` region; keyboard: handle focused + ArrowUp/ArrowDown moves one place (also handled by dnd-kit's keyboard sensor).

- [ ] **Step 1: Failing tests** — `test("EDI-029 arrow keys move a link and announce its position", …)`, `test("EDI-029 dragging reorders the links", …)` (dnd-kit test utilities or the reorder function), e2e `test("EDI-029 reordering links with the keyboard changes the public order", …)` (alice-durand: move Portfolio up, save, `card-link-0` is Portfolio).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): reorderable links in the card editor`.

---

### Task B14: Theme and template sections with live contrast

**Files:** `frontend/web/src/components/editor/{ThemeEditor.tsx, ThemeEditor.test.tsx, SettingsForm.tsx, SettingsForm.test.tsx, TemplatePicker.tsx, ColorField.tsx}`, `frontend/web/src/lib/theme/{edit.ts, edit.test.ts, summary.ts}` (+ test), `frontend/web/src/lib/cards/draft.ts` (save blocked while a check fails), `frontend/web/messages/fr.json` (`editor.theme`), `frontend/e2e/tests/editor.spec.ts`

**Rules:** TPL-004, TPL-010, TPL-011, TPL-013, TPL-018, TPL-024, TPL-027, EDI-007, EDI-030, TPL-023.

**Interfaces:** `AppEditeur.dc.html` "Template" and "Thème": template card "Classique" with "En-tête plein cadre, photo ronde à cheval, boutons d’événement, liens." and the schema-driven setting (a `select` with at most 3 options renders as a segmented `RadioGroup`; "Disposition des liens · réglage du template Classique", "Icônes" / "Liste"); theme: 8 thumbnails (`aria-label="Thèmes prêts à l’emploi"`, radio group, each shows "Aa" in its font on its colours), then "Couleur d’accent", "Couleur du texte" (swatch button `aria-label="Choisir la couleur …"` + mono hex input), "Fond" segmented "Uni"/"Dégradé", "Couleur 1", "Couleur 2", "Angle" slider (`{n}°`), "Intensité du dégradé de l’en-tête" slider (0–100), "Forme des boutons" segmented "Carrée"/"Arrondie"/"Pilule", "Paire de polices" select ("Douce · Fraunces + Nunito Sans"). Contrast (TPL-013): on a failed check, under its setting, an alert `role="alert"`: text check "Texte illisible sur ce fond." + " Contraste {r}:1, il faut au moins 4,5:1. La carte ne peut pas être enregistrée ainsi."; muted check "Texte secondaire illisible sur ce fond."; text-on-accent "Texte illisible sur la couleur d’accent."; accent check "Couleur d’accent trop proche du fond." + " Contraste {r}:1, il faut au moins 3:1. …"; then the button "Utiliser une couleur lisible ({hex})" (`readableFix`, TPL-024), `{hex}` printed in upper case (`#3B2117`) while the stored value stays lowercase. All passing: "Lisible\u00a0: contraste du texte {a}:1, des boutons {b}:1." The save button stays enabled but a save with a failed check is stopped in the browser with the summary of B11 pointing at the theme (TPL-013); the server's `low_contrast` maps to the same message. Theme summary (`lib/theme/summary.ts`): "{name}" or "{name}, personnalisé".

- [ ] **Step 1: Failing tests** — `test("TPL-013 an unreadable text colour blocks the save with its ratio", …)`, `test("TPL-024 the readable colour button fixes the setting", …)`, `test("EDI-030 all checks pass: Lisible with both ratios", …)`, `test("EDI-030 the summary says personnalisé after a change", …)`, `test("TPL-004 TPL-027 the template setting is a segmented control from the schema", …)`; e2e `test("TPL-013 TPL-024 EDI-030 contrast in the editor", …)` (terracotta, text #B89580 → message "Contraste 2,0:1", save blocked; fix → "#3B2117", save → toast).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): theme section with live contrast checks`.

---

### Task B15: Crop maths, media section and header photo dialog

**Files:**
- Create: `frontend/web/src/components/editor/crop/{HeaderCropDialog.tsx, CoveredZones.tsx}` (+ tests)
- Modify: `frontend/web/src/lib/media/{framing.ts, framing.test.ts}`, `frontend/web/src/components/editor/{MediaField.tsx, MediaField.test.tsx}`, `frontend/web/messages/fr.json` (`editor.media`), `frontend/e2e/tests/media.spec.ts`

**Rules:** EDI-026, MED-026, MED-030, MED-033, MED-015.

**Interfaces:** `framing.ts` additions: `cropFromPercentages(area: { x, y, width, height } /* react-easy-crop percentages */) → CropRect` (÷ 100, clamped); `needsCrop(width, height, ratio) → boolean` (`|w / h / ratio − 1| > 0.01`); `coveredZones(headerGradient)` → fade band (bottom `headerGradient` % of the frame), avatar circle (diameter 112/448 of the frame width, centre x 50 %, overlapping the bottom by 64/336 of the frame height), pause square (44/448 of the width, 12/448 from the top-right) — fractions of the 4:3 frame; `nudge(crop, key)` (arrows: 2 % of the frame, Shift: 10 %) and `zoomStep` (+/−: 10 %, 100–300 %). `HeaderCropDialog` (`AppRecadrage.dc.html` §1, react-easy-crop with `aspect={4/3}`, `minZoom={1}`, `maxZoom={3}`): title "Recadrer l’en-tête", stage `role="application"` `aria-label="Zone de recadrage. Flèches pour déplacer, plus et moins pour zoomer."`, thirds grid, `CoveredZones` with labels "Fondu {n} %" and "Photo de profil", switch "Afficher les zones couvertes" (on), legend "Fondu vers le fond de la carte" / "Photo de profil et bouton pause", preview "Sur ta carte", zoom slider (`aria-valuetext="{n} %"`, buttons "Dézoomer"/"Zoomer"), "Réinitialiser", "Annuler", "Appliquer"; phone: full screen, "Pince pour zoomer, glisse pour déplacer.". Media section ("Médias"): "En-tête" with kind and length ("Vidéo · 9 s", "Photo"), buttons "Recadrer" (disabled with the hint "Remplace ce média pour pouvoir le recadrer." when `media.source` is null, MED-033), "Remplacer", "Retirer"; hint "Image ou courte vidéo (lue sans le son). Format 4:3 conseillé\u00a0; garde le sujet dans la moitié haute."; a chosen file that `needsCrop` opens the dialog first, then `uploadMedia(…, { crop })`; "Recadrer" on an existing media → `reframeMedia`. No inline avatar zoom (R-S27).

- [ ] **Step 1: Failing tests** — `test("EDI-026 percentages become a crop rect", …)`, `test("EDI-026 arrows and plus/minus move and zoom within bounds", …)`, `test("EDI-026 covered zones follow the header gradient", …)`, `test("EDI-026 a non-4:3 file opens the dialog before upload", …)`, `test("MED-030 MED-033 a media without source cannot be re-framed", …)`; e2e `test("EDI-026 MED-030 re-framing the header photo", …)` (upload a 16:9 image → dialog → Appliquer → save → public header image is 4:3; Recadrer again → new media id after save).
- [ ] **Step 2–5:** run, implement, run (`make e2e ARGS="-g 'EDI-026|MED-0'"`), commit `feat(web): header photo crop dialog and media section`.

---

### Task B16: Profile photo crop dialog

**Files:** `frontend/web/src/components/editor/crop/AvatarCropDialog.tsx` (+ test), remove `frontend/web/src/components/editor/AvatarCropper.tsx` and `src/lib/media/crop.ts` (the browser no longer cuts the square, MED-005), `MediaField.tsx`, `fr.json`, `frontend/e2e/tests/media.spec.ts`

**Rules:** EDI-035, MED-005, MED-026, MED-030.

**Interfaces:** `AppRecadrage.dc.html` §3: title "Recadrer la photo de profil", round mask, previews "Sur la carte · 112 px" and "Dans l’app · 36 px", hint "Centre le visage et laisse un peu d’air au-dessus de la tête\u00a0: le cercle est bordé par le fond de la carte.", zoom 100–300 %, keys as EDI-026, "Réinitialiser", "Annuler", "Appliquer"; phone "Pince pour zoomer, glisse pour centrer le visage."; opens by itself for a non-square photo; the original file is uploaded with its crop (or `reframeMedia`).

- [ ] **Step 1: Failing tests** — `test("EDI-035 the avatar dialog shows both preview sizes and applies a square crop", …)`, `test("MED-005 the original file is uploaded with its crop", …)`; e2e `test("EDI-035 MED-005 cropping the profile photo", …)` (avatar.jpg → dialog → Appliquer → save → public avatar square).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): profile photo crop dialog`.

---

### Task B17: Header video crop dialog

**Files:** `frontend/web/src/components/editor/crop/VideoCropDialog.tsx` (+ test), `frontend/web/src/lib/media/{video.ts, video.test.ts}` (frames strip, capture at a time), `frontend/web/src/lib/media/framing.ts` (loop helpers, time formatting), `MediaField.tsx`, `fr.json`, `frontend/e2e/tests/media.spec.ts`

**Rules:** EDI-034, EDI-026, MED-003, MED-028, MED-029, MED-030.

**Interfaces:** `AppRecadrage.dc.html` §2: title "Recadrer la vidéo d’en-tête" (phone "Recadrer la vidéo"), stage with the video (react-easy-crop `video` source), "Lire l’extrait" button, strip of 8 frames captured with `captureFrames(file, 8)`, two handles `role="slider"` "Début de l’extrait" / "Fin de l’extrait" (`aria-valuetext` "0,8 s"), playhead, times in mono `formatClock(s)` → "0:00,8", "Boucle de {d} s" (`d` with one decimal and a comma) and "tête de lecture à {t}"; checkbox "Utiliser l’image à {t} comme image d’attente" (phone "Cette image comme image d’attente"), checked → `poster_time` = playhead and the frame captured at that time is sent as `poster`; loop handles keep `end − start ≥ 1 s` (MED-028); defaults: whole video (≤ 30 s), poster unchanged. Apply → `uploadMedia` (new file) or `reframeMedia`.

- [ ] **Step 1: Failing tests** — `test("EDI-034 the handles keep a loop of at least one second", …)`, `test("EDI-034 the loop length and times are written the French way", …)`, `test("EDI-034 the poster box sends the frame at the playhead", …)`; e2e `test("EDI-034 MED-028 framing the header video", …)` (header-2s.mp4 → loop 0,5–1,8 → Appliquer → save → public video starts ≥ 0.5 s).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): header video crop and loop dialog`.

---

### Task B18: Events list

**Files:** `frontend/web/src/components/events/{EventList.tsx, EventList.test.tsx, EventActions.tsx, DeleteEventDialog.tsx}` (+ test), `frontend/web/src/lib/events/{groups.ts, limit.ts}` (+ tests), `frontend/web/src/app/(app)/dashboard/cards/[id]/events/page.tsx`, `fr.json` (`events`), `frontend/e2e/tests/events.spec.ts`

**Rules:** EDI-009, EDI-018, EDI-032, EDI-033, EVT-004, EVT-006, EVT-021, EVT-022, EVT-024, LEA-006.

**Interfaces:** `AppEvenements.dc.html` "Liste" (same markup on computer and phone, `@container` switch at 600 px): header "Événements", sub "Carte {slug} · heures de Paris ({zone})" (the browser's zone name, EVT-022), "Nouvel événement"; info line "Pendant un événement en cours, ta carte affiche un bouton qui ouvre son formulaire. Jusqu’à {max} événements en cours en même temps."; limit alert (EDI-032, `max` from `MeView.max_simultaneous_events`); groups "En cours", "À venir", "Passés" with counts; rows: title, sub, "Début", "Fin" (or "Sans fin"), state badge, contacts count link, "Modifier", "Terminer" (running only), delete icon `aria-label="Supprimer {title}"`; empty state "Aucun événement", text "Crée un événement pour ton prochain salon\u00a0: pendant ses dates, ta carte affiche un bouton qui ouvre un formulaire de contact.", button "Créer un événement". Delete dialog (EDI-033): title "Supprimer «\u00a0{title}\u00a0»\u00a0?", text "Les {n} contacts collectés pendant cet événement seront supprimés avec lui, définitivement.", hint "Exporte-les d’abord si tu veux les garder.", buttons "Annuler", "Exporter les contacts" (opens plan 4's `ExportDialog` for the event), "Supprimer l’événement et {n} contacts" / "Supprimer l’événement".

- [ ] **Step 1: Failing tests** — `test("EDI-032 the limit message appears at the instance's maximum", …)`, `test("EDI-033 the deletion dialog counts the contacts and offers the export", …)`, `test("EDI-032 no event: Aucun événement and a create button", …)`; e2e `test("EDI-032 EDI-033 Alice's events", …)` (3 running → limit text with 3; delete Mariage dialog says 3 contacts; Exporter opens the export dialog).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): events list of the design`.

---

### Task B19: Event editor

**Files:** `frontend/web/src/components/events/{EventEditor.tsx, EventEditor.test.tsx, StandardFieldsEditor.tsx, CustomFieldsEditor.tsx, ConsentEditor.tsx, EventStatePanel.tsx}` (+ test), `fr.json`, `frontend/e2e/tests/events.spec.ts`

**Rules:** EDI-019, EDI-029, FRM-019, FRM-020, FRM-021, FRM-029, EVT-006, EVT-022, EDI-028.

**Interfaces:** `AppEvenements.dc.html` "Éditeur" (restyle plan 4's editor, keep its dirty logic): sections "Informations" (Titre + hint "Affiché sur le bouton de ta carte et en haut du formulaire.", Description (facultatif)), "Dates" ("Fuseau\u00a0: {zone}", Début date + time with `aria-label` "Date de début" / "Heure de début ({zone})", Fin idem, switch "Sans fin" + "(tu le termineras à la main)"), "Accès au formulaire" (Code d’accès (facultatif) + "Affiché en clair. Donne-le aux visiteurs de ton stand\u00a0; sans code, le formulaire est ouvert à tous.", "Envois par appareil" + "Nombre de fois qu’un même téléphone peut envoyer le formulaire. 1 par défaut."), "Champs standards" (each FRM-017 field with a segmented "Non demandé" / "Facultatif" / "Obligatoire", R-S18), "Champs personnalisés" ("Glisse la poignée pour changer l’ordre.", reorder as EDI-029, type select with "Texte", "Texte long", "Date", "Date et heure", "Nombre", "Choix unique", "Case à cocher", "Libellé", "Choix proposés" + "Ajouter un choix", "Aide (facultatif)", switch "Obligatoire", "Ajouter un champ", hint "Types\u00a0: texte, texte long, date, date et heure, nombre, choix unique, case à cocher."), "Consentement" (preview of the checkbox with the default or custom text, FRM-029, R-S19; "Toujours affichée et obligatoire. Le nom vient de ta carte\u00a0; la date et le texte acceptés sont conservés avec chaque contact."); state panel "État" (badge, "Depuis le … · se termine le …", "Voir les {n} contacts", "Terminer maintenant", "Supprimer l’événement"); sticky "Annuler" / "Enregistrer".

- [ ] **Step 1: Failing tests** — `test("FRM-021 the type list includes Date et heure", …)`, `test("EDI-029 custom fields move with the keyboard", …)`, `test("EDI-019 the state panel ends and deletes", …)`; e2e updates of `events.spec.ts` + `test("EDI-019 FRM-043 an event with a date and time field", …)` (add "Rendez-vous souhaité" Date et heure → save → the public form shows a datetime-local input).
- [ ] **Step 2–5:** run, implement, run, commit `feat(web): event editor of the design`.

---

### Task B20: Contacts page, lead sheet, spam undo, export counts

**Files:** `frontend/web/src/app/(app)/dashboard/contacts/{page.tsx, page.test.tsx}`, `frontend/web/src/components/events/{LeadList.tsx, LeadDetail.tsx, ExportDialog.tsx}` (restyle, do not rebuild) + tests, `frontend/web/src/lib/events/{contacts-scope.ts, export-count.ts}` (+ tests), `fr.json` (`leads`, `contacts`), `frontend/e2e/tests/{contacts.spec.ts, exports.spec.ts, leads.spec.ts}`

**Rules:** EDI-031, LEA-001, LEA-003, LEA-004, LEA-034, LEA-035, LEA-012, ABU-009, ABU-010.

**Interfaces:** `AppContacts.dc.html`: page "Contacts" + sub "Les personnes qui ont rempli le formulaire d’un de tes événements, de la plus récente à la plus ancienne.", "Exporter"; "Carte\u00a0:" selector (first card by default, `?card=` in the URL), scope tabs (computer) / menu (phone) "Toute la carte" + each event with its count (`?event=`), search "Rechercher un contact", summary "{n} contacts, dont {m} marqués comme spam" (`m` = 0 → "{n} contacts"); table "Date", "Nom", "E-mail", "Téléphone", "Événement", "Spam" badge (row greyed); empty "Aucun contact pour l’instant" + "Ils apparaîtront ici dès qu’une personne remplira le formulaire d’un de tes événements." + link "Voir mes événements". Lead detail as a `Sheet` on computers, a full-screen sheet on phones (plan 4's `LeadDetail` restyled): name, "Dim. 7 févr. 2027 à 16:42 · {event}", "Coordonnées", "Réponses", "Consentement" ("Accepté", "le … à …", the quoted text), "Marquer comme spam"/"Retirer le marquage spam", "Supprimer". Spam toggle → toast "Contact marqué comme spam" / "Marquage spam retiré" with action "Annuler" that calls the opposite toggle (LEA-034). Export dialog (plan 4's, restyled): title "Exporter les contacts", scope line "Carte {slug} · {event} · {n} contacts", format radios "CSV" ("Excel, Numbers, Google Sheets"), "XLSX" ("Fichier Excel"), "JSON" ("Pour un outil ou un script"), checkbox "Inclure les contacts marqués comme spam ({m})", hint "Une ligne par contact\u00a0; une colonne par champ, champs personnalisés et consentement compris.", buttons "Annuler" and "Exporter {k} contacts" (`export-count.ts`: `k` = count minus spam unless included, LEA-035). Plan 4's per-event and whole-card pages stay and use the same restyled components.

- [ ] **Step 1: Failing tests** — `test("EDI-031 the contacts page picks the first card and switches scope", …)`, `test("LEA-034 the spam toast undoes the change", …)`, `test("LEA-035 the export button gives the exact count", …)`; e2e `test("EDI-031 LEA-034 LEA-035 contacts of Alice", …)` (whole card 4 contacts "dont 1 marqué comme spam" — check the plural form the ICU message gives —, export button "Exporter 3 contacts", checkbox → "Exporter 4 contacts"; mark Zoé spam → toast Annuler → not spam).
- [ ] **Step 2–5:** run, implement, run (`make e2e ARGS="-g 'EDI-031|LEA-0|ABU-0'"`), commit `feat(web): contacts page and lead screens of the design`.

---

### Task B21: "Mon compte"

**Files:** `frontend/web/src/app/(app)/dashboard/account/{page.tsx, page.test.tsx}`, `frontend/web/src/components/account/{DeleteAccount.tsx, DeleteAccount.test.tsx}` (restyle plan 4's), `fr.json` (`account`), `frontend/e2e/tests/account-deletion.spec.ts`

**Rules:** ACC-027, ACC-010, ACC-018, ACC-020 (plan 4).

**Interfaces:** `AppCompte.dc.html`: "Mon compte", section "Profil" (name, email, provider line, "Gérer l’e-mail et la connexion" — Clerk's user profile when the Clerk adapter is active, hidden otherwise —, "Se déconnecter"), danger zone "Supprimer mon compte": "Supprime définitivement ton compte et toutes ses données\u00a0: {c} cartes, {e} événements et {l} contacts. Les liens de tes cartes, tags NFC et QR codes compris, cesseront de fonctionner." (counts from `MeView.totals`, ICU plurals), link "Exporter mes contacts d’abord" → `/dashboard/contacts`, button "Supprimer mon compte…"; dialog (plan 4's, restyled): "Supprimer ton compte\u00a0?", "Tout sera supprimé, sans retour possible\u00a0:", list "tes {c} cartes et leurs pages publiques\u00a0;", "tes {e} événements et leurs formulaires\u00a0;", "les {l} contacts collectés.", "Pour confirmer, tape SUPPRIMER", "Annuler", "Supprimer définitivement" (enabled per plan 4's rule).

- [ ] **Step 1: Failing tests** — `test("ACC-027 the deletion area gives the counts and links to the contacts", …)`; e2e `test("ACC-027 Alice's account page counts her data", …)` (2 cartes, 7 événements, 4 contacts — check against the seed).
- [ ] **Step 2–5:** run, implement, run (`make e2e ARGS="-g 'ACC-0'"`), commit `feat(web): account page of the design`.

---

### Task B22: Support pages

**Files:** `frontend/web/src/components/support/*` and `frontend/web/src/app/(app)/support/**` (restyle only), `fr.json` (`support`), `frontend/e2e/tests/{support.spec.ts, support-cards.spec.ts, support-leads.spec.ts}`

**Rules:** ADM-001, ADM-002, ADM-006, ADM-013 (and plan 4's support views).

**Interfaces:** the shell (B4) with a "Support" entry for administrators only (after "Mon compte"), tables, badges and buttons from B3; read-only notices as `alert` info; no behaviour change. Existing e2e tests pass unchanged except for texts this task rewrites with French typography.

- [ ] **Step 1–5:** e2e `make e2e ARGS="-g 'ADM-0'"` stays green after the restyle; add `test("ADM-001 the Support entry shows only for administrators", …)`; commit `feat(web): support pages on the Atelier tokens`.

---

### Task B23: Typography sweep

**Files:** `frontend/web/messages/fr.json`, the e2e and unit tests that assert the rewritten texts.

**Rules:** EDI-011.

- [ ] **Step 1:** every remaining text uses ’ instead of `'`, `\u00a0` before `:` `;` `?` `!` and inside « » (R-S33). `test("EDI-011 the French texts use typographic apostrophes and non-breaking spaces", …)` scans `fr.json` (no `'` in any value; no ` :` with a normal space before `:`, `;`, `?`, `!`).
- [ ] **Step 2:** fix the assertions; `make test` and `make e2e`.
- [ ] **Step 3: Commit** — `git commit -m "chore(web): French typography in every interface text"`

---

### Task B24: Spec status, documentation and final check

**Files:** `spec/*.md` status lines, `CLAUDE.md`, `.claude/skills/*`, `docs/superpowers/plans/2026-11-03-cartouche-plan-6-followups.md`

- [ ] **Step 1: Status lines** — every rule of plan 6 marked implemented (e.g. `dashboard-editor.md`: `> Status: implemented (plans 2, 3, 4 and 6)`; same for `account-auth.md`, `leads-exports.md`, `card-links.md`, `media.md`).
- [ ] **Step 2: Documentation** — `CLAUDE.md` map (`components/shell`, `components/ui` additions, `components/editor/crop`, `/dashboard/contacts`), skills (`dev-env`: contacts page; `run-tests`: toasts and dialogs in e2e).
- [ ] **Step 3: Coverage** — `node scripts/spec-lint.mjs --coverage` · Expected: no plan-6 rule uncited.
- [ ] **Step 4: Full check** — `make lint test` then `make e2e` · Expected: PASS on both projects.
- [ ] **Step 5: Commit** — `git commit -m "docs(spec): plan 6 design milestone implemented"`
