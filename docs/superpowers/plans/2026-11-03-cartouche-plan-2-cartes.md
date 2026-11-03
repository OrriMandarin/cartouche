# Cartouche — Plan 2 : Cartes et page publique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un utilisateur validé crée et gère ses cartes (slug, contenu, liens, template, thème, médias), les publie sur une page publique rapide `/c/<slug>` avec vCard et aperçu de lien, et le support peut consulter et désactiver une carte.

**Architecture:** Les règles pures (slugs, validation du contenu, thème, vCard, analyse des médias) vont dans `cartouche-domain` ; `cartouche-api` ajoute les tables `cards`, `card_slugs` et `media`, des routes propriétaire filtrées par `owner_id` dans `db/`, une API publique sans authentification et un service de médias derrière le trait `object_store::ObjectStore` (disque local par défaut, S3 par configuration). Côté web, un template est un composant React isomorphe qui respecte un contrat unique ; la page publique (rendue par le serveur) et l'aperçu de l'éditeur rendent le même composant, et le formulaire de réglages est généré depuis le schéma que chaque template déclare.

**Tech Stack:** existant du plan 1 (Rust 2024, Axum 0.8, SQLx 0.9 en mode hors ligne, utoipa 5 · Next 16, React 19, Tailwind 4, shadcn/ui, next-intl, openapi-fetch, Vitest, Playwright) + `object_store` 0.12 (feature `aws`), `image` 0.25 (`jpeg`, `png`, `webp`), `webp` 0.3 (encodeur WebP avec perte), `phonenumber` 0.3, `base64` 0.22, `axum` feature `multipart` · `qrcode` (npm), `react-easy-crop`, polices `@fontsource-variable/*`.

**Spec:** `spec/` (fait foi) : `card-links.md` (LNK), `public-page.md` (PUB), `templates-themes.md` (TPL), `media.md` (MED), `dashboard-editor.md` (EDI), `admin-support.md` (ADM-006 et ADM-009 à ADM-015), `account-auth.md` (ACC-017). Design initial figé : `docs/superpowers/specs/2026-11-02-cartouche-design.md`, sections 5.1, 5.2, 6 et 7. Les règles LNK-018 à LNK-029, PUB-018 à PUB-028, TPL-014 à TPL-019, MED-012 à MED-020, EDI-012 à EDI-017 et ADM-013 à ADM-015 ont été ajoutées pour ce plan (commit `docs(spec): detail cards, slugs, public page, templates and media for plan 2`).

**Chemins :** le plan 1 utilise les anciens chemins. Ici : `backend/` (workspace Cargo : `domain/`, `server/`), `frontend/` (workspace pnpm : `web/`, `api-client/`, `e2e/`). Poste local : `source ~/.cargo/env` et `export PATH="$HOME/.local/bin:$PATH"` avant `make`.

---

## Points signalés au porteur du projet

Décisions prises en écrivant la spec ; aucune ne contredit une règle déjà implémentée, mais chacune précise ou interprète le design. À confirmer avant de lancer les tâches concernées.

1. **JPEG en plus du WebP pour la photo de profil** (PUB-025, MED-015) : MED-006 dit « converties en WebP », mais les applications de contacts ne lisent pas le WebP dans une vCard, et plusieurs aperçus de lien non plus. La photo de profil a donc aussi deux variantes JPEG (256 et 512 px). Tâches 7, 10 et 15.
2. **La page neutre répond 200, avec `noindex`** (LNK-027) : « et non une erreur 404 » est lu comme « statut 200 ». Un slug jamais attribué répond 404 (LNK-023). Tâches 10 et 15.
3. **Un média n'est rattaché qu'à l'enregistrement** (MED-018) : c'est la lecture de EDI-006 pour les médias. L'envoi stocke le fichier tout de suite, mais la carte publique ne change qu'au clic sur « Enregistrer ». Tâche 8.
4. **L'ancien slug d'une carte vivante ne passe pas à une autre carte du même propriétaire** (LNK-025) : LNK-004 réserve l'ancien slug « à cette carte » ; LNK-014 ne vise que les slugs des cartes supprimées. Tâches 2 et 6.
5. **Pendant un blocage du support, le propriétaire ne peut ni désactiver ni réactiver** (LNK-028) ; à la levée, la carte retrouve l'état choisi par son propriétaire. Tâches 9 et 11.
6. **Thèmes et polices provisoires** : TPL-009 demande 6 à 8 thèmes conçus avec Claude Design. Ce plan livre 6 thèmes et 3 paires de polices sobres, remplacés au plan 6 sans changer les identifiants. Tâche 13.
7. **Tolérance de durée vidéo** : MED-002 fixe 30 s ; un encodeur écrit souvent 30,03 s pour une vidéo de 30 s. Le serveur refuse au-delà de **30,1 s**. Tâche 7.
8. **Plan 1 non fusionné localement** : `main` est encore au commit initial ; ce plan part de la branche `claude/cartouche-digital-business-card-d46ae6` (commit `3b39048`). Fusionner le plan 1 dans `main` avant d'exécuter ce plan.

## Suivis du plan 1 repris ici

- Task 4 : une variable obligatoire vide (`DATABASE_URL=`) vaut `Missing` ; `Config` ne doit pas afficher de secret dans `Debug` → tâche 1 (et le secret S3 de la tâche 7).
- Task 8 : `ApiJson` transforme 413 et 415 en 400 → tâche 1 (indispensable aux envois de médias).
- Task 13 : les boutons de modération se réactivent avant la fin du rechargement → règle appliquée aux nouveaux boutons d'action (tâches 16 et 19).
- Task 14 : `API_INTERNAL_URL` au runtime était inerte → la page publique le lit côté serveur (tâche 15).
- Task 15 : `API_URL` dupliqué entre `fixtures.ts` et `global-setup.ts` → tâche 12.
- Task 17 : formulation `SeededUser` / `SeedReport` dans la skill `add-seed-scenario` → tâche 20.
- Task 18 : ACC-017 rattaché au plan 2 → confirmé (tâches 6, 8, 9 et 11).

## Global Constraints

- Code, identifiants, commentaires et commits en **anglais** ; spec, docs et textes d'interface en **français** (avec accents), tous les textes d'interface dans `frontend/web/messages/fr.json`.
- Aucune logique métier dans les handlers ni dans les composants : `cartouche-domain` ou `frontend/web/src/lib` (et `frontend/web/src/templates` pour les fonctions pures de template). Chaque fonction `db/` sur des données utilisateur prend `owner_id` et le met dans le `where`. Seules exceptions : `db/public_cards.rs` (lecture publique par slug), les lectures par slug de `db/slugs.rs` (l'unicité d'un slug vaut pour toute l'instance ; elles ne renvoient que `owner_id`, `card_id` et `is_current`) et `db/admin_cards.rs` (appelé uniquement par les routes `/api/admin/*`).
- Toute chaîne reçue est normalisée par `normalize` (NFC + trim) ; vide après normalisation = absente.
- Forme des erreurs : `{"error":{"code","message","request_id"}}`, plus `"fields":[{"field","code"}]` **seulement** pour `400 validation_failed`. Chemins de champ : `slug`, `template`, `theme`, `settings`, `content.first_name`, `content.email`, `links[3].url`, `links[3].label`, `header_media_id`, `avatar_media_id`, `file`.
- Nouveaux codes : `validation_failed` 400 · `payload_too_large` 413 · `unsupported_media_type` 415 · `slug_taken` 409 · `slug_reserved` 409 · `card_disabled_by_support` 409 · `card_inactive` 410 ; `invalid_transition` 409 est réutilisé (ADM-015). Codes de champ : `required`, `too_long`, `invalid_slug`, `invalid_email`, `invalid_phone`, `invalid_url`, `too_many_links`, `invalid_template`, `invalid_theme`, `invalid_settings`, `invalid_media`, `image_too_large`, `video_too_long`, `poster_required`.
- Slug : `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 à 64 caractères (LNK-018). Lien public : `{PUBLIC_BASE_URL}/c/{slug}` (LNK-029).
- Contenu : prénom, nom, poste, entreprise ≤ 100 caractères ; description ≤ 1 000 ; liens ≤ 20, URL `http`/`https` ≤ 2 048, intitulé de lien libre ≤ 50 ; réglages de template : objet JSON ≤ 8 192 octets sérialisé.
- Types de lien (`LinkKind`, sérialisés en snake_case) : `website`, `linkedin`, `instagram`, `facebook`, `tiktok`, `youtube`, `x`, `custom`.
- Valeurs par défaut : template `classique`, thème `clair`, paire de polices `moderne`. Le backend les connaît (`DEFAULT_TEMPLATE`, `DEFAULT_THEME_PRESET`) ; le registre web doit les contenir (test de la tâche 14).
- Médias : image ≤ 10 × 1024 × 1024 octets et ≤ 40 000 000 pixels ; vidéo MP4 ≤ 25 × 1024 × 1024 octets et ≤ 30,1 s ; avatar WebP 128/256/512, JPEG 256/512 ; en-tête et image d'attente WebP de 640/1080/1920 px de large ; jamais d'agrandissement : largeur produite = `min(cible, largeur d'origine)`, doublons retirés. WebP qualité 80, JPEG qualité 85.
- Clé de stockage : `cards/{card_id}/{media_id}/{name}`, `name` ∈ `s{n}.webp`, `s{n}.jpg`, `w{n}.webp`, `video.mp4` ; identifiants en UUID v7. `/media/*` : `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`.
- Variables d'environnement nouvelles : `MEDIA_STORAGE` (`local` par défaut | `s3`), `MEDIA_LOCAL_DIR` (défaut `./data/media`), `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ENDPOINT` (optionnelle), `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` (obligatoire en `s3`). Chacune documentée dans `.env.example`.
- Tout type du domaine exposé par l'API (`CardStatus`, `LinkKind`, `Theme`, `Slot`, `MediaKind`, `FieldError`…) dérive `ToSchema` sous la feature `utoipa`, comme `UserStatus` : le client TypeScript généré est la seule source des types côté web.
- Routes : propriétaire sous `/api/cards*` et `/api/slugs/*` (extracteur `ApprovedUser`) ; public sous `/api/public/cards/*` (sans jeton, tag OpenAPI `public`) ; support sous `/api/admin/*` (`AdminUser`) ; `/media/*` hors OpenAPI, monté seulement en mode `local`.
- Après tout changement de requête ou de migration : `make sqlx-prepare` et commit de `backend/.sqlx/`. Après tout changement de route : `make openapi` et commit de `openapi.json` et `schema.d.ts`.
- Tests : `// spec: XXX-NNN` avant chaque test Rust ; identifiant dans le nom de chaque test TypeScript. Données avec accents, apostrophes typographiques et émojis (« Éloïse D'Aubigné-Müller », « ✨ »).
- Chaque tâche qui touche l'interface finit par `make e2e ARGS="-g <règles de la tâche>"` ; la tâche 20 lance `make test` et `make e2e` complets.

## Review Focus

1. **Photo de téléphone en portrait avec orientation EXIF 6 et position GPS** → les variantes stockées sont à l'endroit (plus hautes que larges) et ne contiennent aucune métadonnée EXIF. Test dans la tâche 7.
2. **Vidéo d'en-tête lue sur iPhone** → `/media/*` répond `206` avec `Content-Range` à une requête `Range`, y compris à travers la réécriture Next en dev et en test ; sans cela Safari iOS n'affiche rien. Tests dans les tâches 8 et 18.
3. **Deux demandes (deux personnes, ou un double clic sur « Enregistrer ») réclament le même slug au même instant** → exactement une réussit, l'autre reçoit `409 slug_taken`, jamais une 500. Tests dans les tâches 5 et 6.
4. **Un client qui appelle l'API directement envoie `javascript:alert(1)` comme lien, ou `url(https://pisteur)` comme couleur** → `400 validation_failed` ; et une valeur invalide déjà en base (réglages de template) est ignorée au rendu au lieu d'atteindre le HTML ou le CSS. Tests dans les tâches 3, 6, 13 et 14.
5. **Image piégée (PNG de quelques octets qui déclare 20 000 × 20 000 px) ou fichier trop lourd** → refus rapide (`400 image_too_large`, `413 payload_too_large` en JSON) sans décoder l'image ni saturer la mémoire ; et un envoi légitime de plus de 10 Mo passe la réécriture Next. Tests dans les tâches 7, 8 et 18.

---

## Structure des fichiers

```
backend/domain/src/
  validation.rs        FieldError
  slug.rs              Slug, suggest_base, with_suffix, SlugRecord, SlugClaim, decide_claim
  card.rs              CardInput, ValidCard, CardContent, Link, LinkKind, validate_card, DEFAULT_*
  card_status.rs       CardStatus, is_served
  theme.rs             Theme, Color, Background, ButtonShape
  phone.rs  email.rs   normalize_phone, format_international, is_valid_email
  vcard.rs             VCard, render
  media.rs             Slot, MediaFormat, sniff, mp4_duration, plan_image_variants, limites
backend/server/
  migrations/0003_cards.sql
  src/db/{cards.rs, slugs.rs, media.rs, public_cards.rs, admin_cards.rs}
  src/media/{mod.rs, service.rs, process.rs}
  src/routes/{cards.rs, slugs.rs, card_media.rs, media_files.rs, public_cards.rs, admin_cards.rs}
  src/views.rs         CardView, MediaView, ContentView, LinkView (partagés owner / admin / public)
  tests/{db_cards.rs, cards.rs, slugs.rs, media.rs, card_actions.rs, public_cards.rs, admin_cards.rs}
  tests/common/{cards.rs, media_fixtures.rs}
frontend/web/src/
  app/(app)/…          login, auth, dashboard, support déplacés dans un groupe qui porte l'AuthProvider
  app/(app)/dashboard/cards/new/page.tsx  app/(app)/dashboard/cards/[id]/page.tsx
  app/(app)/support/users/[id]/page.tsx   app/(app)/support/cards/[id]/page.tsx
  app/c/[slug]/{page.tsx, not-found.tsx}
  templates/{contract.ts, ids.ts, registry.ts, settings-schema.ts, contract.test.tsx, classique/}
  lib/theme/{presets.ts, fonts.ts, fonts.css, resolve.ts, contrast.ts}
  lib/cards/{draft.ts, status.ts, qr.ts, slug-availability.ts}
  lib/media/{upload.ts, video.ts, crop.ts}
  lib/public-card.ts  lib/server-api.ts  lib/og.ts
  components/cards/   components/editor/   components/public/   components/support/
frontend/e2e/
  env.ts  fixtures.ts  fixtures/{avatar.jpg, header-2s.mp4, header-31s.mp4, README.md}
  tests/{public-page,cards,editor,media,support-cards}.spec.ts
.claude/skills/add-card-template/SKILL.md
```

---

### Task 1 : Erreurs de validation, 413/415 et configuration stricte

**Files:**
- Create: `backend/domain/src/validation.rs`
- Modify: `backend/domain/src/lib.rs`, `backend/server/src/error.rs`, `backend/server/src/extract.rs`, `backend/server/src/config.rs`

**Interfaces:**
- Produces :
  - `cartouche_domain::FieldError { pub field: String, pub code: &'static str }` (`Serialize`, `ToSchema` sous la feature `utoipa`, comme `UserStatus`) ;
  - `ApiError::Validation(Vec<FieldError>)` → `400 validation_failed` ; `ApiError::PayloadTooLarge` → `413 payload_too_large` ; `ApiError::UnsupportedMediaType` → `415 unsupported_media_type` ;
  - `ErrorDetail` gagne `#[serde(skip_serializing_if = "Vec::is_empty")] pub fields: Vec<FieldError>` ;
  - `ApiJson` : rejet de statut 413 → `PayloadTooLarge`, 415 → `UnsupportedMediaType`, tout autre → `InvalidRequest` (via `rejection.status()`) ;
  - `Config::from_vars` : une variable obligatoire vide ou faite d'espaces → `ConfigError::Missing`.

- [ ] **Step 1 : Écrire les tests** (en ligne dans `error.rs`, `extract.rs`, `config.rs`)

```rust
#[test] fn validation_error_lists_fields() {
    /* ApiError::Validation(vec![FieldError{field:"content.email".into(), code:"invalid_email"}]) → 400,
       body.error.code == "validation_failed", body.error.fields == [{"field":"content.email","code":"invalid_email"}] */ }
#[test] fn other_errors_have_no_fields_key() { /* NotFound → body.error n'a pas de clé "fields" */ }
#[tokio::test] async fn oversized_json_body_is_413() { /* route ApiJson + DefaultBodyLimit::max(16), corps de 64 octets → 413 payload_too_large */ }
#[tokio::test] async fn json_without_content_type_is_415() { /* → 415 unsupported_media_type */ }
#[test] fn blank_required_variable_is_missing() { /* DATABASE_URL = "  " → Err(Missing("DATABASE_URL")) */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test --workspace --all-features` · Expected : erreurs de compilation.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.** `required` filtre `v.trim().is_empty()` comme `optional`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS. Puis `make openapi` (le schéma `ErrorDetail` change).
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): field-level validation errors and 413/415 mapping"`

---

### Task 2 : Domaine — slugs

**Files:**
- Create: `backend/domain/src/slug.rs`
- Modify: `backend/domain/src/lib.rs`, `backend/domain/Cargo.toml` (ajouter `uuid` du workspace ; le déclarer dans `[workspace.dependencies]`)

**Interfaces:**
- Produces :
  - `pub struct Slug(String)` avec `Slug::parse(input: &str) -> Result<Slug, InvalidSlug>` (trim, minuscules, LNK-018) et `as_str()` ;
  - `pub fn suggest_base(first_name: &str, last_name: &str) -> Option<Slug>` (LNK-019 ; `None` si moins de 3 caractères utiles) ;
  - `pub fn with_suffix(base: &Slug, n: u32) -> Slug` (`base-n`, base tronquée pour tenir dans 64 caractères, sans tiret final) ;
  - `pub struct SlugRecord { pub owner_id: Uuid, pub card_id: Option<Uuid>, pub is_current: bool }` ;
  - `pub enum SlugClaim { New, AlreadyCurrent, ReclaimOwn, AttachReserved }` · `pub enum SlugClaimError { Taken, Reserved }` ;
  - `pub fn decide_claim(existing: Option<&SlugRecord>, owner_id: Uuid, card_id: Option<Uuid>) -> Result<SlugClaim, SlugClaimError>` (`card_id: None` = carte en cours de création).

Translittération de `suggest_base` : décomposition NFD, suppression des marques combinantes (`unicode_normalization::char::is_combining_mark`), puis `ß→ss`, `æ→ae`, `œ→oe`, `ø→o`, `đ→d`, `ł→l` ; tout autre caractère non `[a-z0-9]` devient un tiret ; tirets fusionnés et retirés aux bords ; tronqué à 64 sans tiret final.

- [ ] **Step 1 : Écrire les tests** (en ligne)

```rust
// spec: LNK-018
#[test] fn parse_trims_and_lowercases() { assert_eq!(Slug::parse("  Alice-Durand ").unwrap().as_str(), "alice-durand"); }
#[test] fn parse_rejects_bad_shapes() { for s in ["ab", "-alice", "alice-", "al--ice", "éloïse", "a b c", &"a".repeat(65)] { assert!(Slug::parse(s).is_err(), "{s}"); } }
#[test] fn parse_accepts_bounds() { assert!(Slug::parse("abc").is_ok()); assert!(Slug::parse(&"a".repeat(64)).is_ok()); }
// spec: LNK-001, LNK-019
#[test] fn suggestion_strips_accents() { assert_eq!(suggest_base("Éloïse", "D'Aubigné-Müller").unwrap().as_str(), "eloise-d-aubigne-muller"); }
#[test] fn suggestion_transliterates_ligatures() { assert_eq!(suggest_base("Œdipe", "Straße").unwrap().as_str(), "oedipe-strasse"); }
#[test] fn suggestion_is_none_when_too_short() { assert_eq!(suggest_base("", "Li"), None); assert_eq!(suggest_base("✨", ""), None); }
#[test] fn suffix_fits_in_64() { let base = Slug::parse(&"a".repeat(64)).unwrap(); assert_eq!(with_suffix(&base, 12).as_str().len(), 64); assert!(with_suffix(&base, 12).as_str().ends_with("-12")); }
// spec: LNK-004, LNK-013, LNK-014, LNK-022, LNK-025 — table exhaustive
#[test] fn claim_decisions() {
    /* None → New ; current of this card → AlreadyCurrent ; old slug of this card → ReclaimOwn ;
       mine, card_id None (deleted card) → AttachReserved (for Some(card) and for None) ;
       mine, old slug of another live card → Err(Reserved) ; mine, current of another card → Err(Reserved) ;
       other owner (any state) → Err(Taken) */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-domain` · Expected : FAIL (compilation).
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git commit -am "feat(domain): slug parsing, suggestion and claim rules"` (ajouter `slug.rs`).

---

### Task 3 : Domaine — contenu de carte, liens, téléphone, email, thème, état

**Files:**
- Create: `backend/domain/src/{card.rs, card_status.rs, theme.rs, phone.rs, email.rs}`
- Modify: `backend/domain/src/lib.rs`, `backend/domain/Cargo.toml` (`serde_json`, `url`, `phonenumber`)

**Interfaces:**
- Consumes : `Slug`, `FieldError`, `normalize`.
- Produces :
  - `pub const DEFAULT_TEMPLATE: &str = "classique"; pub const DEFAULT_THEME_PRESET: &str = "clair"; pub const MAX_LINKS: usize = 20; pub const MAX_SETTINGS_BYTES: usize = 8192;`
  - `pub enum LinkKind { Website, Linkedin, Instagram, Facebook, Tiktok, Youtube, X, Custom }` (serde snake_case, `ToSchema`) ;
  - `pub struct ContentInput { first_name, last_name, job_title, company, description, email, phone: Option<String> }` ; `pub struct LinkInput { kind: LinkKind, url: String, label: Option<String> }` ;
  - `pub struct CardInput { slug: String, template: String, settings: serde_json::Value, theme: serde_json::Value, content: ContentInput, links: Vec<LinkInput> }` et `CardInput::new_card(slug, first_name, last_name) -> CardInput` (template et thème par défaut, `settings = {}`) ;
  - `pub struct CardContent { first_name, last_name, job_title, company, description, email: Option<String>, phone: Option<String> /* E.164 */ }` ; `pub struct Link { kind, url: String, label: Option<String> }` ;
  - `pub struct ValidCard { slug: Slug, template: String, settings: serde_json::Value, theme: Theme, content: CardContent, links: Vec<Link> }` ;
  - `pub fn validate_card(input: CardInput) -> Result<ValidCard, Vec<FieldError>>` : renvoie **toutes** les erreurs à la fois ; `template` doit valider `^[a-z][a-z0-9-]{0,31}$` (un identifiant inconnu est accepté, TPL-015) ; `settings` doit être un objet JSON de 8 192 octets au plus (`invalid_settings`) ;
  - `pub struct Theme { preset: String, font: Option<String>, accent: Option<Color>, text: Option<Color>, background: Option<Background>, header_gradient: Option<u8>, button_shape: Option<ButtonShape> }` (serde `deny_unknown_fields`, `ToSchema`) ; `Color` = `#rrggbb` stocké en minuscules ; `Background` tagué par `kind` : `Solid { color }` | `Gradient { from, to, angle: u16 }` (0..=360) ; `header_gradient` 0..=100 ; `ButtonShape { Square, Rounded, Pill }` ; `preset` et `font` valident `^[a-z0-9-]{1,32}$` ; `Theme::parse(&serde_json::Value) -> Result<Theme, InvalidTheme>` ;
  - `pub fn normalize_phone(input: &str) -> Result<String, InvalidPhone>` (pays par défaut `FR`, sortie E.164) · `pub fn format_international(e164: &str) -> String` ;
  - `pub fn is_valid_email(input: &str) -> bool` (un seul `@`, partie locale non vide, domaine avec un point, aucun espace, ≤ 254 caractères) ;
  - `pub enum CardStatus { Active, Disabled, DisabledBySupport }` (serde snake_case) · `CardStatus::of(owner_disabled: bool, support_disabled: bool) -> CardStatus` (le support l'emporte) · `pub fn is_served(status: CardStatus, owner: UserStatus) -> bool` (LNK-026).

- [ ] **Step 1 : Écrire les tests** (en ligne)

```rust
// spec: PUB-018
#[test] fn first_or_last_name_is_required() { /* les deux absents → [content.first_name: required] ; "  " compte comme absent */ }
// spec: PUB-019, EDI-008
#[test] fn lengths_are_counted_in_characters_after_nfc() { /* "é" décomposé ×100 → OK (100 caractères NFC) ; 101 → content.first_name: too_long ; description 1001 → too_long */ }
// spec: PUB-020
#[test] fn email_and_phone_are_validated() { /* "alice@" → invalid_email ; "06 12 34 56 78" → "+33612345678" ; "+44 20 7946 0958" conservé ; "12" → invalid_phone */ }
#[test] fn phone_is_displayed_internationally() { assert_eq!(format_international("+33612345678"), "+33 6 12 34 56 78"); }
// spec: PUB-022, Review Focus 4
#[test] fn links_reject_non_http_urls() { /* "javascript:alert(1)", "data:text/html,x", "/relative", "ftp://x" → links[i].url: invalid_url ; URL de 2049 → invalid_url */ }
#[test] fn custom_link_needs_a_label() { /* custom sans label → links[0].label: required ; label 51 → too_long */ }
#[test] fn at_most_20_links() { /* 21 liens → links: too_many_links */ }
// spec: TPL-017, Review Focus 4
#[test] fn theme_rejects_css_injection() { /* accent "url(https://x)" ou "red" ou "#12345" → theme: invalid_theme ; angle 361 → invalid ; header_gradient 101 → invalid ; clé inconnue → invalid */ }
#[test] fn theme_accepts_full_settings() { /* gradient + pill + font + couleurs majuscules → couleurs stockées en minuscules */ }
// spec: TPL-001, TPL-016
#[test] fn settings_must_be_a_small_object() { /* [] → invalid_settings ; objet de 9 000 octets → invalid_settings */ }
#[test] fn all_errors_are_reported_together() { /* slug invalide + email invalide + lien invalide → 3 FieldError */ }
// spec: LNK-026, LNK-028, ADM-011
#[test] fn served_only_when_active_and_owner_approved() { /* table : support l'emporte sur owner ; Active+Suspended → false */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-domain` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend/domain && git commit -m "feat(domain): card content, links, theme and status rules"`

---

### Task 4 : Domaine — vCard

**Files:**
- Create: `backend/domain/src/vcard.rs`
- Modify: `backend/domain/src/lib.rs`, `backend/domain/Cargo.toml` (`base64`)

**Interfaces:**
- Produces : `pub struct VCard<'a> { pub content: &'a CardContent, pub urls: Vec<&'a str>, pub photo_jpeg: Option<&'a [u8]> }` · `pub fn render(card: &VCard) -> String`.

Format (PUB-024, PUB-026) : `BEGIN:VCARD`, `VERSION:3.0`, `N:<nom>;<prénom>;;;`, `FN:<prénom nom>`, puis s'ils existent `ORG`, `TITLE`, `EMAIL;TYPE=INTERNET`, `TEL;TYPE=CELL` (E.164), un `URL` par lien, `NOTE` (description), `PHOTO;ENCODING=b;TYPE=JPEG:<base64>`, `END:VCARD`. Échappement des valeurs texte : `\` → `\\`, `,` → `\,`, `;` → `\;`, saut de ligne → `\n`. Chaque ligne logique est repliée à 75 octets (suite : CRLF + espace), sans couper un caractère UTF-8 ; toutes les lignes finissent par CRLF.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: PUB-014, PUB-024
#[test] fn renders_version_3_with_structured_name() { /* "Éloïse" "D'Aubigné-Müller" → contient "VERSION:3.0\r\n", "N:D'Aubigné-Müller;Éloïse;;;\r\n", "FN:Éloïse D'Aubigné-Müller\r\n" */ }
// spec: PUB-015
#[test] fn absent_fields_are_omitted() { /* seul le prénom → aucune ligne ORG/TITLE/EMAIL/TEL/URL/NOTE/PHOTO */ }
// spec: PUB-016
#[test] fn text_values_are_escaped() { /* company "Durand, Fils; & Cie\\" → "ORG:Durand\, Fils\; & Cie\\\\" ; description multi-ligne → "\n" */ }
// spec: PUB-026
#[test] fn long_lines_fold_without_splitting_characters() {
    /* description de 200 × "é✨" : chaque ligne physique ≤ 75 octets, toutes valides en UTF-8,
       les continuations commencent par une espace, déplier (retirer "\r\n ") redonne la valeur échappée */ }
#[test] fn every_line_ends_with_crlf() { /* aucun "\n" non précédé de "\r" ; finit par "END:VCARD\r\n" */ }
// spec: PUB-025
#[test] fn photo_is_base64_jpeg() { /* photo_jpeg = [0xFF,0xD8,…] → ligne PHOTO;ENCODING=b;TYPE=JPEG: dont le base64 déplié redonne les octets */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-domain vcard` · Expected : FAIL.
- [ ] **Step 3 : Implémenter `render`.** Le repli travaille sur les octets d'une ligne logique et recule jusqu'à une frontière de caractère (`str::is_char_boundary`) ; la première ligne fait au plus 75 octets, les suivantes 74 + l'espace.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend/domain && git commit -m "feat(domain): vCard 3.0 rendering with escaping and folding"`

---

### Task 5 : Schéma et `db/` des cartes, des slugs et des médias

**Files:**
- Create: `backend/server/migrations/0003_cards.sql`, `backend/server/src/db/{cards.rs, slugs.rs, media.rs}`, `backend/domain/src/media.rs`, `backend/server/tests/db_cards.rs`
- Modify: `backend/server/src/db/mod.rs`, `backend/server/src/test_support/seed.rs` (`RESET_TABLES = ["audit_log", "media", "card_slugs", "cards", "users"]`)

**Interfaces:**
- Consumes : `ValidCard`, `SlugRecord`, `SlugClaim`.
- Migration :
  - `cards(id uuid primary key, owner_id uuid not null references users(id) on delete cascade, template text not null, settings jsonb not null, theme jsonb not null, first_name text, last_name text, job_title text, company text, description text, email text, phone text, links jsonb not null default '[]', header_media_id uuid, avatar_media_id uuid, owner_disabled_at timestamptz, support_disabled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`, index `(owner_id, created_at)` ;
  - `card_slugs(slug text primary key, owner_id uuid not null references users(id) on delete cascade, card_id uuid references cards(id) on delete set null, is_current boolean not null, created_at timestamptz not null default now(), check (not is_current or card_id is not null))`, index unique partiel `(card_id) where is_current` ;
  - `media(id uuid primary key, card_id uuid not null references cards(id) on delete cascade, slot text not null check (slot in ('header','avatar')), kind text not null check (kind in ('image','video')), variants jsonb not null, created_at timestamptz not null default now())` ;
  - clés étrangères `cards.header_media_id` et `cards.avatar_media_id` → `media(id) on delete set null`.
- Produces :
  - `pub struct Card { id, owner_id, slug: String /* courant */, template, settings: Value, theme: Value, content: CardContent, links: Vec<Link>, header_media_id: Option<Uuid>, avatar_media_id: Option<Uuid>, owner_disabled_at, support_disabled_at: Option<DateTime<Utc>>, created_at, updated_at }` et `Card::status() -> CardStatus` ;
  - `db::cards::list_for_owner(pool, owner_id) -> Vec<Card>` (tri `created_at`, `id`) · `find_for_owner(pool, owner_id, card_id) -> Option<Card>` · `insert(tx, owner_id, card_id, &ValidCard) -> Card` · `update(tx, owner_id, card_id, &ValidCard, header: Option<Uuid>, avatar: Option<Uuid>) -> Option<Card>` · `set_owner_disabled(pool, owner_id, card_id, at: Option<DateTime<Utc>>) -> Option<Card>` · `delete_for_owner(tx, owner_id, card_id) -> bool` (passe d'abord `is_current = false` sur ses slugs) ;
  - `db::slugs::find_for_update(tx, slug) -> Option<SlugRecord>` · `find(pool, slug) -> Option<SlugRecord>` · `apply_claim(tx, owner_id, card_id, &Slug, SlugClaim) -> Result<(), sqlx::Error>` (retire `is_current` à l'ancien slug courant de la carte, puis insère ou rattache) · `is_unique_violation(&sqlx::Error) -> bool` ;
  - `db::media::insert(tx, card_id, MediaRecord) -> MediaRecord` · `find_for_owner(pool, owner_id, media_id) -> Option<MediaRecord>` · `list_for_card(pool, owner_id, card_id) -> Vec<MediaRecord>` · `delete_unreferenced(tx, owner_id, card_id) -> Vec<MediaRecord>` (supprime et renvoie les médias de la carte qui ne sont ni `header_media_id` ni `avatar_media_id`) ; `MediaRecord { id, card_id, slot: Slot, kind: MediaKind, variants: Vec<StoredVariant { name: String, width: u32, format: VariantFormat }> }` ;
  - `backend/domain/src/media.rs` (créé ici, complété à la tâche 7) : `pub enum Slot { Header, Avatar }`, `pub enum MediaKind { Image, Video }`, `pub enum VariantFormat { Webp, Jpeg, Mp4 }`, serde snake_case, `ToSchema`.

- [ ] **Step 1 : Écrire les tests d'intégration** (`tests/db_cards.rs`, `#[sqlx::test(migrations = "./migrations")]`, utilisateurs insérés directement)

```rust
// spec: ACC-017
#[sqlx::test] async fn find_for_owner_ignores_other_owners(pool) { /* carte d'Alice → find_for_owner(bob, id) == None ; update/delete par bob → None/false, ligne intacte */ }
// spec: LNK-003, LNK-004
#[sqlx::test] async fn new_slug_demotes_the_previous_one(pool) { /* claim "alice" puis "alice-durand" → un seul is_current, "alice" garde card_id */ }
// spec: LNK-013, LNK-014
#[sqlx::test] async fn deleting_a_card_keeps_its_slugs_reserved(pool) { /* delete → card_slugs.card_id null, is_current false, owner_id conservé */ }
// spec: LNK-022, Review Focus 3
#[sqlx::test] async fn concurrent_inserts_of_one_slug_fail_with_unique_violation(pool) { /* 2 transactions apply_claim(New) sur le même slug → une Ok, l'autre is_unique_violation */ }
// spec: MED-018
#[sqlx::test] async fn delete_unreferenced_keeps_attached_media(pool) { /* 3 médias, 1 en header → 2 supprimés et renvoyés */ }
#[sqlx::test] async fn reset_empties_card_tables(pool) { /* test-support : reset → 0 ligne dans cards, card_slugs, media */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `make dev-db && cd backend && cargo test -p cartouche-api --all-features --test db_cards` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** la migration et les fonctions ; `make sqlx-prepare`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS ; `make sqlx-check` passe.
- [ ] **Step 5 : Commit** — `git add backend && git commit -m "feat(api): cards, slugs and media tables with owner-scoped queries"`

---

### Task 6 : Routes des cartes et des slugs

**Files:**
- Create: `backend/server/src/views.rs`, `backend/server/src/routes/{cards.rs, slugs.rs}`, `backend/server/tests/{cards.rs, slugs.rs}`, `backend/server/tests/common/cards.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, error.rs, routes/mod.rs, lib.rs}`

**Interfaces:**
- Consumes : `ApprovedUser`, `validate_card`, `decide_claim`, `db::cards`, `db::slugs`.
- Produces :
  - `ApiError::SlugTaken` (409 `slug_taken`), `ApiError::SlugReserved` (409 `slug_reserved`) ;
  - `views::CardView { id, slug, public_url, status: CardStatus, template, settings: Value, theme: Theme, content: ContentView, links: Vec<LinkView>, created_at, updated_at }`, `ContentView { first_name, last_name, job_title, company, description, email, phone, phone_display: Option<String> }`, `LinkView { kind, url, label }` ; `views::public_url(config, slug) -> String` ;
  - `GET /api/cards` → `CardList { cards: Vec<CardView> }` ;
  - `POST /api/cards` corps `CreateCardBody { slug: String, first_name: Option<String>, last_name: Option<String> }` → `201 CardView` (EDI-013) ;
  - `GET /api/cards/{id}` → `CardView` ;
  - `PUT /api/cards/{id}` corps `UpdateCardBody { slug, template, settings: Value, theme: Value, content: ContentBody, links: Vec<LinkBody> }` → `CardView`. `theme` et `settings` sont reçus en `serde_json::Value` (documentés `#[schema(value_type = Theme)]` et `Object`) pour qu'une valeur invalide donne une erreur de champ (`invalid_theme`, `invalid_settings`) et non un `400 invalid_request` global. Le tout en **une transaction** : validation (toutes les erreurs) → `find_for_update` du slug + `decide_claim` → `apply_claim` → `update` ; violation d'unicité → `SlugTaken` ;
  - `DELETE /api/cards/{id}` → `204` ;
  - `GET /api/slugs/suggestion?first_name=&last_name=` → `SlugSuggestion { slug: Option<String> }` (premier libre parmi `base`, `base-2`, … `base-100` selon `decide_claim(_, me, None)`) ;
  - `GET /api/slugs/availability?slug=&card_id=` → `SlugAvailability { slug: Option<String> /* normalisé */, status: "free" | "current" | "reserved" | "taken" | "invalid" }` ;
  - `tests/common/cards.rs` : `cards_app(pool) -> TestApp` (`SIGNUP_MODE=open`, `ADMIN_USER_IDS=boss`), `token(sub)`, `create_card(app, sub, slug) -> Value`, `put_card(app, sub, id, patch: Value) -> TestResponse` (lit la carte, fusionne `patch`, renvoie le PUT).

- [ ] **Step 1 : Écrire les tests** (`tests/cards.rs`, `tests/slugs.rs`)

```rust
// spec: EDI-001, EDI-013, LNK-001
#[sqlx::test] async fn create_card_with_defaults(pool) { /* POST → 201, status "active", template "classique", theme.preset "clair", public_url "http://localhost:3000/c/alice-durand" */ }
// spec: LNK-002, LNK-022
#[sqlx::test] async fn slug_of_another_user_is_taken(pool) { /* bob POST slug "alice-durand" → 409 slug_taken, aucun détail sur le propriétaire */ }
// spec: LNK-022, Review Focus 3
#[sqlx::test] async fn concurrent_creations_of_one_slug(pool) { /* 10 POST simultanés (join_all), 10 utilisateurs, même slug → exactement 1×201 et 9×409 slug_taken, aucun 500 */ }
// spec: LNK-018
#[sqlx::test] async fn invalid_slug_is_a_field_error(pool) { /* "Al--ice" → 400 validation_failed, fields [{slug, invalid_slug}] */ }
// spec: EDI-008, PUB-018, PUB-019, PUB-020, PUB-022, TPL-017
#[sqlx::test] async fn update_validates_and_normalizes(pool) {
    /* PUT first_name "  E\u{301}loïse " → "Éloïse" ; phone "06 12 34 56 78" → "+33612345678", phone_display "+33 6 12 34 56 78" ;
       lien "javascript:alert(1)" + accent "url(x)" → 400 avec links[0].url invalid_url et theme invalid_theme */ }
// spec: EDI-015
#[sqlx::test] async fn rejected_update_changes_nothing(pool) { /* PUT job_title nouveau + slug pris → 409, GET renvoie l'ancien job_title et l'ancien slug */ }
// spec: LNK-003, LNK-025
#[sqlx::test] async fn slug_change_keeps_history_and_allows_reclaim(pool) { /* alice → alice-durand → alice : 200, la carte reprend "alice" */ }
// spec: LNK-025
#[sqlx::test] async fn old_slug_of_a_live_card_is_reserved(pool) { /* carte A ancien slug "alice" ; carte B d'Alice PUT slug "alice" → 409 slug_reserved */ }
// spec: LNK-012, LNK-013, LNK-014
#[sqlx::test] async fn deleted_card_slug_stays_with_its_owner(pool) { /* DELETE → 204 ; bob POST même slug → 409 slug_taken ; alice POST même slug → 201 */ }
// spec: TPL-005, TPL-007, TPL-015
#[sqlx::test] async fn any_well_formed_template_is_stored(pool) { /* template "futur-template" → 200 ; "Bad Id" → template invalid_template */ }
// spec: ACC-017
#[sqlx::test] async fn other_users_cards_are_404(pool) { /* bob GET/PUT/DELETE carte d'Alice → 404 not_found ; GET /api/cards de bob ne la liste pas */ }
// spec: ACC-004, ACC-011
#[sqlx::test] async fn pending_user_cannot_create(pool) { /* mode approval, compte pending → POST 403 account_pending ; sans jeton → 401 */ }
// spec: LNK-019 (tests/slugs.rs)
#[sqlx::test] async fn suggestion_skips_taken_slugs(pool) { /* "alice-durand" pris par Alice → suggestion pour Bob "Alice Durand" == "alice-durand-2" */ }
// spec: LNK-020
#[sqlx::test] async fn availability_statuses(pool) { /* free ; current (card_id = la carte) ; ancien slug de la même carte → free ; ancien slug d'une autre carte d'Alice → reserved ; slug de Bob → taken ; "a" → invalid */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test cards --test slugs` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** les routes avec `#[utoipa::path]` complets (skill `change-api`), tag `cards` ; `make sqlx-prepare` puis `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): owner card CRUD and slug suggestion/availability"`

---

### Task 7 : Médias — configuration, stockage et traitement

**Files:**
- Create: `backend/server/src/media/{mod.rs, service.rs, process.rs}`, `backend/server/tests/common/media_fixtures.rs`
- Modify: `backend/domain/src/media.rs`, `backend/server/src/{config.rs, state.rs, main.rs}`, `backend/server/Cargo.toml` (`object_store` avec `aws`, `image` sans features par défaut + `jpeg`,`png`,`webp`, `webp`, `bytes`, `tokio` feature `sync`), `backend/server/tests/common/mod.rs`, `.env.example`, `Makefile` (`MEDIA_LOCAL_DIR ?= $(CURDIR)/.data/media`), `.gitignore` (`.data/`, `backend/data/`)

**Interfaces:**
- Produces (domaine, à côté de `Slot`, `MediaKind` et `VariantFormat` de la tâche 5) :
  - `pub enum MediaFormat { Jpeg, Png, Webp, Mp4 }` · `pub fn sniff(bytes: &[u8]) -> Option<MediaFormat>` (signatures `FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`, boîte `ftyp` à l'octet 4) ;
  - `pub fn mp4_duration(bytes: &[u8]) -> Result<std::time::Duration, Mp4Error>` : parcourt les boîtes de premier niveau jusqu'à `moov`, puis `mvhd` (version 0 : timescale et durée sur 32 bits ; version 1 : durée sur 64 bits) ;
  - `pub const MAX_IMAGE_BYTES: usize = 10 << 20; MAX_VIDEO_BYTES: usize = 25 << 20; MAX_IMAGE_PIXELS: u64 = 40_000_000; MAX_VIDEO_DURATION: Duration = 30_100 ms;`
  - `pub struct PlannedVariant { name: String, width: u32, format: VariantFormat }` · `pub fn plan_image_variants(slot: Slot, width: u32, height: u32) -> Vec<PlannedVariant>` (avatar : côté = `min(w, h)` ; en-tête : largeur ; tailles de MED-015 bornées à l'origine, doublons retirés).
- Produces (serveur) :
  - `config::MediaStorageConfig { Local { dir: PathBuf }, S3 { bucket, region, endpoint: Option<Url>, access_key_id: String, secret_access_key: Secret, public_base_url: Url } }`, dans `Config::media` ; `Secret(String)` dont `Debug` affiche `"***"` ;
  - `media::MediaService` (Clone) : `from_config(&MediaStorageConfig, public_base_url: &Url) -> Result<MediaService, MediaError>` · `in_memory(public_base: Url) -> MediaService` · `serves_locally() -> bool` · `url(key: &str) -> String` (local : `{PUBLIC_BASE_URL}/media/{key}` ; S3 : `{MEDIA_PUBLIC_BASE_URL}/{key}`) · `put(key, Bytes)` · `get(key, Option<Range<u64>>) -> Result<MediaObject { bytes, size }, MediaError>` · `copy(from, to)` · `delete_media(card_id, media_id)` · `delete_card(card_id)` · `list_keys() -> Vec<String>` (tests) ; il porte un `Arc<tokio::sync::Semaphore>` de **2** permis pour le traitement d'images ;
  - `media::process::process_image(bytes: &[u8], slot: Slot) -> Result<Vec<EncodedVariant>, ProcessError>` (`EncodedVariant { name, width, format, bytes: Vec<u8> }`, `ProcessError { Unsupported, TooLarge, Corrupt }`), appelé via `spawn_blocking` sous un permis ;
  - `AppState::media: MediaService` ; le harnais de test utilise `MediaService::in_memory("http://localhost:3000/media/")` et `TestApp::media_keys()`.

Ordre de `process_image` : `sniff` (sinon `Unsupported`) → `ImageReader::with_guessed_format` + `into_dimensions()` **avant** décodage (> 40 Mpx → `TooLarge`) → décodage avec `image::Limits` (`max_alloc` 512 Mo) → `decoder.orientation()` puis `apply_orientation` → recadrage carré centré (`resize_to_fill`) pour l'avatar, redimensionnement à largeur fixe pour l'en-tête (filtre Lanczos3) → encodage WebP (crate `webp`, qualité 80) et JPEG (qualité 85). Les octets d'origine ne sont jamais stockés (MED-007).

- [ ] **Step 1 : Écrire les tests**

`tests/common/media_fixtures.rs` construit les fichiers en mémoire : `jpeg(w, h)`, `png(w, h)`, `jpeg_with_exif(w, h, orientation: u16, gps: bool)` (insère après `SOI` un segment APP1 `Exif\0\0` avec un IFD0 TIFF little-endian contenant `Orientation` (0x0112) et, si `gps`, un pointeur `GPSInfo` (0x8825) vers un IFD GPS avec `GPSLatitudeRef`), `png_claiming(w, h)` (PNG valide de 1 × 1 dont l'IHDR déclare `w × h`), `mp4(duration_ms)` (boîtes `ftyp` `isom` + `moov`/`mvhd` v0, timescale 1000).

```rust
// spec: MED-008
#[test] fn sniff_reads_content_not_extension() { /* png() → Png ; b"GIF89a…" → None ; b"<svg" → None ; mp4(1000) → Mp4 */ }
// spec: MED-002, MED-013
#[test] fn mp4_duration_is_read_from_mvhd() { assert_eq!(mp4_duration(&mp4(2_000)).unwrap(), Duration::from_secs(2)); /* sans moov → Err */ }
// spec: MED-015
#[test] fn variants_never_upscale() { /* header 800×600 → w640, w800 ; header 3000×2000 → w640,w1080,w1920 ; avatar 300×500 → s128,s256,s300 webp + s256,s300 jpg */ }
// spec: MED-006, MED-015
#[test] fn avatar_variants_are_square_webp_and_jpeg() { /* process_image(jpeg(900,600), Avatar) → s128/s256/s512.webp (RIFF…WEBP, carrés) + s256/s512.jpg (FF D8) */ }
// spec: MED-007, MED-014, Review Focus 1
#[test] fn orientation_applied_and_exif_removed() {
    /* jpeg_with_exif(1200, 800, 6, gps=true), Header → w640 décodé fait 640 × 960 (portrait) ;
       aucune variante ne contient les octets "Exif" ni "GPS" */ }
// spec: MED-012, Review Focus 5
#[test] fn pixel_bomb_is_rejected_before_decoding() { /* png_claiming(20_000, 20_000) → Err(TooLarge) en moins de 100 ms */ }
// spec: MED-009, MED-011
#[test] fn media_config_local_by_default_and_s3_on_demand() {
    /* sans MEDIA_STORAGE → Local { dir: "./data/media" } ; MEDIA_STORAGE=s3 sans MEDIA_PUBLIC_BASE_URL → Missing ;
       s3 complet → urls "https://cdn.example/cards/…" ; MEDIA_STORAGE=ftp → Invalid ; format!("{:?}", config) ne contient pas le secret */ }
// spec: MED-016
#[tokio::test] async fn in_memory_service_round_trip() { /* put puis get(Some(0..2)) → 2 octets, size totale ; delete_card retire toutes les clés du préfixe */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test --workspace --all-features media` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.** `main.rs` construit `MediaService::from_config` ; en mode local, crée `MEDIA_LOCAL_DIR` au démarrage (`LocalFileSystem::new_with_prefix`) et le loggue dans le résumé de démarrage.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend .env.example Makefile .gitignore && git commit -m "feat(api): media storage service and image processing pipeline"`

---

### Task 8 : Médias — envoi, rattachement à l'enregistrement et diffusion

**Files:**
- Create: `backend/server/src/routes/{card_media.rs, media_files.rs}`, `backend/server/tests/media.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, extract.rs, views.rs, routes/cards.rs}`, `backend/server/Cargo.toml` (feature axum `multipart`), `backend/server/tests/common/mod.rs` (`request_multipart(method, path, token, parts: &[Part])`, `Part { name, filename: Option, content_type: Option, bytes }`)

**Interfaces:**
- Consumes : `MediaService`, `process_image`, `sniff`, `mp4_duration`, `db::media`.
- Produces :
  - `extract::ApiMultipart` (comme `ApiJson` : rejet 413 → `PayloadTooLarge`, sinon `InvalidRequest`) ;
  - `views::MediaView { id, kind: MediaKind, images: Vec<ImageVariantView { width, url }> /* WebP, largeur croissante ; image d'attente pour une vidéo */, video_url: Option<String>, jpeg_url: Option<String> /* plus grand JPEG d'un avatar */ }` ; `CardView` gagne `header: Option<MediaView>` et `avatar: Option<MediaView>` ;
  - `POST /api/cards/{id}/media` (multipart : `slot` = `header`|`avatar`, `file`, `poster` pour une vidéo) → `201 MediaView`, avec `DefaultBodyLimit::max(36 << 20)` sur cette route seulement. Erreurs : 404 (carte d'un autre), 413, 415 (type par le contenu ; vidéo seulement en `header`), 400 `validation_failed` (`file: image_too_large | video_too_long`, `poster: poster_required`). La vidéo est stockée telle quelle (`video.mp4`), son image d'attente passe par `process_image(_, Header)` ;
  - `UpdateCardBody` gagne `header_media_id: Option<Uuid>` et `avatar_media_id: Option<Uuid>` : chaque id doit être un média **de cette carte**, du bon `slot` (un avatar est une image), sinon `invalid_media`. Dans la même transaction : `update` puis `delete_unreferenced` ; **après le commit**, `MediaService::delete_media` pour chaque média supprimé (un échec de stockage est loggué, pas renvoyé) ;
  - `DELETE /api/cards/{id}` appelle `MediaService::delete_card` après le commit (MED-019) ;
  - `GET /media/{*key}` (monté seulement si `serves_locally()`) : la clé doit valider `^cards/[0-9a-f-]{36}/[0-9a-f-]{36}/([sw][0-9]{2,4}\.(webp|jpg)|video\.mp4)$` (sinon 404) ; `Content-Type` par extension ; en-têtes de cache de Global Constraints ; `Range: bytes=a-b | a- | -n` (une seule plage) → `206` + `Content-Range` ; plage invalide ou hors fichier → `416` avec `Content-Range: bytes */<taille>`.

- [ ] **Step 1 : Écrire les tests** (`tests/media.rs`)

```rust
// spec: MED-005, MED-006, MED-015
#[sqlx::test] async fn avatar_upload_returns_variant_urls(pool) { /* 201, kind image, images widths [128,256,512], jpeg_url finit par s512.jpg, urls en http://localhost:3000/media/cards/… */ }
// spec: MED-008, MED-012
#[sqlx::test] async fn type_is_checked_from_content(pool) { /* PNG nommé "photo.jpg" → 201 ; texte nommé "photo.jpg" → 415 unsupported_media_type ; vidéo en slot avatar → 415 */ }
// spec: MED-012, Review Focus 5
#[sqlx::test] async fn oversized_and_bomb_images_are_refused(pool) { /* 11 Mo → 413 payload_too_large (JSON) ; png_claiming(20000,20000) → 400 fields [{file,image_too_large}] */ }
// spec: MED-002, MED-004, MED-013
#[sqlx::test] async fn video_rules(pool) { /* mp4(31_000) → video_too_long ; mp4(2_000) sans poster → poster_required ; 26 Mo → 413 ; mp4(2_000)+poster → 201, video.mp4 stocké octet pour octet */ }
// spec: MED-018, EDI-006, MED-001
#[sqlx::test] async fn media_is_attached_only_on_save(pool) {
    /* upload A → GET carte : header null ; PUT header_media_id A → header == A ;
       upload B, PUT header_media_id B → objets de A supprimés (media_keys), header == B ; upload C non retenu + PUT → C supprimé */ }
#[sqlx::test] async fn media_of_another_card_is_invalid(pool) { /* PUT avatar_media_id = média d'une autre carte d'Alice → 400 avatar_media_id invalid_media ; header vidéo en avatar_media_id → invalid_media */ }
// spec: MED-019
#[sqlx::test] async fn deleting_a_card_deletes_its_files(pool) { /* media_keys sans préfixe cards/{id}/ après DELETE */ }
// spec: MED-020, ACC-017
#[sqlx::test] async fn only_the_owner_uploads(pool) { /* bob POST media sur la carte d'Alice → 404 ; sans jeton → 401 */ }
// spec: MED-010, MED-016
#[sqlx::test] async fn media_files_are_served_with_long_cache(pool) { /* GET /media/<clé> → 200, image/webp, cache-control "public, max-age=31536000, immutable", nosniff, accept-ranges bytes */ }
// spec: MED-017, Review Focus 2
#[sqlx::test] async fn media_files_honour_range_requests(pool) { /* Range bytes=0-1 → 206, 2 octets, content-range "bytes 0-1/<n>" ; bytes=-4 → 4 derniers ; bytes=<n>- → 416 */ }
#[sqlx::test] async fn media_paths_cannot_escape(pool) { /* /media/../../etc/passwd, /media/cards/x/y/z.txt → 404 */ }
// spec: MED-011
#[sqlx::test] async fn s3_mode_does_not_mount_media_route(pool) { /* état avec MediaService S3 factice (in_memory + serves_locally=false) → GET /media/… 404 ; MediaView.url sur la base S3 */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test media` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`, `make openapi` (multipart documenté par `request_body(content_type = "multipart/form-data")`).
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): media upload, attach-on-save and range-capable media serving"`

---

### Task 9 : Actions sur une carte — désactiver, réactiver, dupliquer

**Files:**
- Create: `backend/server/tests/card_actions.rs`
- Modify: `backend/server/src/{routes/cards.rs, db/cards.rs, error.rs, app.rs, openapi.rs}`

**Interfaces:**
- Produces :
  - `ApiError::CardDisabledBySupport` (409 `card_disabled_by_support`) ;
  - `POST /api/cards/{id}/disable` et `POST /api/cards/{id}/enable` → `CardView` ; idempotents ; refusés pendant un blocage du support (LNK-028) ;
  - `POST /api/cards/{id}/duplicate` corps `DuplicateCardBody { slug: String }` → `201 CardView` : nouveau slug (claim `None`), contenu, liens, template, thème et réglages copiés ; chaque média attaché copié sous un nouvel id (`MediaService::copy` de chaque variante) ; copie active ; source bloquée par le support → `CardDisabledBySupport` ;
  - `db::cards::duplicate(tx, owner_id, source_id, new_id) -> Option<Card>` et `db::media::copy_records(tx, from_card, to_card) -> Vec<(MediaRecord /*source*/, MediaRecord /*copie*/)>`.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: LNK-005, LNK-009
#[sqlx::test] async fn disable_then_enable_keeps_everything(pool) { /* disable → status "disabled" ; enable → "active", même slug, même contenu, mêmes médias */ }
// spec: LNK-008
#[sqlx::test] async fn disabled_card_stays_listed(pool) { /* GET /api/cards contient la carte désactivée */ }
// spec: LNK-011, LNK-028
#[sqlx::test] async fn owner_cannot_toggle_a_support_disabled_card(pool) { /* support_disabled_at posé en base → enable et disable → 409 card_disabled_by_support */ }
// spec: EDI-001, EDI-014
#[sqlx::test] async fn duplicate_copies_content_and_media_not_history(pool) {
    /* source avec ancien slug "alice", avatar ; duplicate slug "alice-bis" → 201, contenu égal, avatar.id ≠ source,
       card_slugs de la copie = ["alice-bis"] ; DELETE source → les fichiers de la copie existent toujours */ }
#[sqlx::test] async fn support_disabled_card_cannot_be_duplicated(pool) { /* → 409 card_disabled_by_support */ }
// spec: ACC-017
#[sqlx::test] async fn actions_on_other_users_cards_are_404(pool) { /* bob disable/enable/duplicate carte d'Alice → 404 */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test card_actions` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`, `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): card disable, enable and duplicate"`

---

### Task 10 : API publique — résolution du slug et vCard

**Files:**
- Create: `backend/server/src/db/public_cards.rs`, `backend/server/src/routes/public_cards.rs`, `backend/server/tests/public_cards.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, error.rs, views.rs}`

**Interfaces:**
- Consumes : `is_served`, `CardStatus`, `vcard::render`, `MediaService::get`.
- Produces :
  - `ApiError::CardInactive` (410 `card_inactive`) ;
  - `db::public_cards::resolve(pool, slug: &str) -> Option<Resolution>` avec `enum Resolution { Current(Card, UserStatus), Old { current: String }, Deleted }` (lecture par slug, sans propriétaire : c'est l'exception documentée) ;
  - `GET /api/public/cards/{slug}` (sans jeton) → `PublicCardResponse`, enum sérialisé `#[serde(tag = "state", rename_all = "snake_case")]` : `Active { card: PublicCard }` | `Inactive` | `Redirect { slug: String }` ; slug jamais attribué → `404 not_found`. La valeur du chemin est passée en minuscules ; si elle diffère de l'entrée ou si c'est un ancien slug → `Redirect` vers le slug courant (LNK-021, LNK-003) ;
  - `PublicCard { slug, public_url, template, settings, theme, content: ContentView, links: Vec<LinkView>, header: Option<MediaView>, avatar: Option<MediaView>, vcard_url: String /* "/api/public/cards/{slug}/vcard" */ }` — aucun id interne, aucune date ;
  - `GET /api/public/cards/{slug}/vcard` → `200 text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.vcf"` ; ancien slug ou majuscules → `308` `Location: /api/public/cards/<courant>/vcard` ; carte non servie ou supprimée → `410 card_inactive` ; inconnu → 404. La photo est la plus petite variante JPEG de l'avatar, lue dans `MediaService` ; les `URL` sont les liens dans l'ordre.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: PUB-011, PUB-018
#[sqlx::test] async fn active_card_is_public_without_token(pool) { /* state "active", card.content.first_name, links dans l'ordre, pas de champ id */ }
// spec: LNK-003, LNK-021
#[sqlx::test] async fn old_and_uppercase_slugs_redirect(pool) { /* "alice" → {state:"redirect",slug:"alice-durand"} ; "Alice-Durand" → redirect vers "alice-durand" */ }
// spec: LNK-006, LNK-010, LNK-012, ADM-011, LNK-026, LNK-027
#[sqlx::test] async fn unserved_cards_are_inactive_without_data(pool) {
    /* owner disabled, support disabled, supprimée, propriétaire suspendu → body == {"state":"inactive"} exactement */ }
// spec: LNK-023
#[sqlx::test] async fn unknown_slug_is_404(pool) { ... }
// spec: PUB-014, PUB-015, PUB-024, PUB-027
#[sqlx::test] async fn vcard_is_downloadable(pool) {
    /* content-type "text/vcard; charset=utf-8", content-disposition filename="alice-durand.vcf",
       corps contient FN, ORG, TITLE, TEL;TYPE=CELL:+33612345678, URL:https://www.linkedin.com/in/alice ; pas de NOTE sans description */ }
// spec: PUB-025
#[sqlx::test] async fn vcard_photo_is_the_256_jpeg(pool) { /* avatar envoyé + enregistré → PHOTO base64 décodé = JPEG 256 × 256 */ }
// spec: LNK-024
#[sqlx::test] async fn vcard_of_old_slug_redirects_308(pool) { /* status 308, location "/api/public/cards/alice-durand/vcard" */ }
// spec: LNK-007, LNK-026
#[sqlx::test] async fn vcard_of_unserved_card_is_410(pool) { /* désactivée ou supprimée → 410 card_inactive */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test public_cards` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; tag OpenAPI `public`, sans `security` ; `make sqlx-prepare`, `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): public card resolution and vCard download"`

---

### Task 11 : Support — consultation et modération des cartes

**Files:**
- Create: `backend/server/src/db/admin_cards.rs`, `backend/server/src/routes/admin_cards.rs`, `backend/server/tests/admin_cards.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, routes/admin_users.rs}`

**Interfaces:**
- Consumes : `AdminUser`, `db::audit::record`, `views::CardView`.
- Produces :
  - `db::admin_cards::list_for_user(pool, user_id) -> Vec<Card>` · `find(pool, card_id) -> Option<Card>` · `find_for_update(tx, card_id) -> Option<Card>` · `set_support_disabled(tx, card_id, at: Option<DateTime<Utc>>) -> Card` ;
  - `GET /api/admin/users/{id}` → `AdminUserDetail { user: AdminUserView, cards: Vec<CardView> }` (ADM-006, ADM-013) ;
  - `GET /api/admin/cards/{id}` → `AdminCardDetail { card: CardView, owner: AdminUserView }` ;
  - `POST /api/admin/cards/{id}/support-disable` et `POST /api/admin/cards/{id}/support-enable` → `CardView`. Dans une transaction : `find_for_update`, contrôle (`409 invalid_transition` si déjà dans l'état demandé), mise à jour, audit `card.support_disabled` / `card.support_enabled`, `target_type = "card"`, metadata `{"owner_id": …, "slug": …}`. L'heure vient de `state.clock`.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: ADM-001
#[sqlx::test] async fn card_admin_routes_need_an_admin(pool) { /* alice sur les 4 routes → 403 forbidden */ }
// spec: ADM-006, ADM-013, ACC-017
#[sqlx::test] async fn admin_sees_a_users_cards_read_only(pool) { /* GET users/{alice} → 2 cartes dont la désactivée, avec leur status ; GET cards/{id} → content complet + owner */ }
// spec: ADM-009, LNK-010
#[sqlx::test] async fn support_disable_makes_the_card_inactive(pool) { /* → status "disabled_by_support" ; GET public → inactive */ }
// spec: ADM-010, LNK-028
#[sqlx::test] async fn lifting_restores_the_owner_state(pool) { /* owner disable, support disable, support enable → status "disabled" (pas "active") */ }
// spec: ADM-014, ADM-005
#[sqlx::test] async fn support_actions_are_audited(pool) { /* 2 lignes audit_log : actions card.support_disabled puis card.support_enabled, target_type "card", target_id = carte, actor = admin */ }
// spec: ADM-015
#[sqlx::test] async fn repeated_support_action_is_409_without_audit(pool) { /* 2e support-disable → 409 invalid_transition ; 1 seule ligne d'audit */ }
// spec: ADM-012
#[test] fn admin_api_cannot_edit_card_content() { /* dans ApiDoc::openapi(), aucun chemin /api/admin/cards* n'a de put, patch ni delete */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test admin_cards` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`, `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): support card view, disable and lift with audit"`

---

### Task 12 : Données de test et stack e2e

**Files:**
- Create: `frontend/e2e/env.ts`
- Modify: `backend/server/src/test_support/seed.rs`, `backend/server/tests/test_support.rs`, `backend/Dockerfile`, `compose.test.yml`, `frontend/web/next.config.ts`, `frontend/e2e/{fixtures.ts, global-setup.ts}`

**Interfaces:**
- Produces :
  - scénario `cards` (complète `base`, à charger après lui) ; `SeedReport` gagne `cards: Vec<SeededCard { id: Uuid, slug: String, owner: String }>` :

| slug courant | anciens slugs | propriétaire | état | contenu |
|---|---|---|---|---|
| `alice-durand` | `alice` | seed-alice | active | Alice Durand, « Fondatrice », « Atelier Durand & Fils », alice@example.test, +33612345678, description « Créatrice de cartes ✨ — l'artisanat d'aujourd'hui », liens LinkedIn `https://www.linkedin.com/in/alice` et libre « Portfolio » `https://alice.example.test` |
| `alice-archive` | — | seed-alice | désactivée par le propriétaire | Alice Durand, « Ancien poste » |
| `alice-ancienne` | — | seed-alice | carte supprimée (slug réservé) | — |
| `bob-martin` | — | seed-bob | désactivée par le support | Bob Martin |
| `dan-moreau` | — | seed-dan (suspendu) | active | Dan Moreau |

  - `frontend/e2e/env.ts` : `export const API_URL = "http://localhost:18080"; export const WEB_URL = "http://localhost:13000";` utilisés par `fixtures.ts`, `global-setup.ts` et `playwright.config.ts` ;
  - `TestApi.seed(scenario): Promise<SeedReport>` ; `TestApi.authHeaders(subject): Promise<{ authorization: string }>` ; `TestApi.updateCard(subject, id, patch: Record<string, unknown>): Promise<CardView>` (GET puis PUT fusionné, échoue si non 2xx) ; `TestApi.uploadMedia(subject, cardId, slot, file: {name, mimeType, buffer}, poster?): Promise<MediaView>` ;
  - `backend/Dockerfile` : `RUN mkdir -p /data/media && chown cartouche /data/media` et `ENV MEDIA_LOCAL_DIR=/data/media` ; `compose.test.yml` : `MEDIA_STORAGE: local`, `MEDIA_LOCAL_DIR: /data/media` (valeurs en dur, R4) ;
  - `next.config.ts` : réécriture `/media/:path*` → `${apiInternalUrl}/media/:path*` à côté de `/api/:path*`.

- [ ] **Step 1 : Écrire le test** (`tests/test_support.rs`)

```rust
#[sqlx::test] async fn cards_scenario_seeds_every_card_state(pool) {
    /* seed base puis cards → 4 cartes + 1 slug réservé ; GET public alice → active, alice → redirect,
       alice-archive, alice-ancienne, bob-martin, dan-moreau → inactive ; SeedReport.cards contient les 4 slugs courants */ }
#[sqlx::test] async fn cards_scenario_is_replayable(pool) { /* seed cards deux fois → mêmes 4 cartes, aucune erreur */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test test_support` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** le scénario (chaînes passées par `normalize`, `on conflict` pour rester rejouable), puis les fichiers d'infrastructure ci-dessus ; `make sqlx-prepare`.
- [ ] **Step 4 : Vérifier**
  - Run: `cd backend && cargo test -p cartouche-api --all-features --test test_support` · Expected : PASS.
  - Run: `make e2e` · Expected : les tests e2e du plan 1 passent toujours ; `curl -sI http://localhost:13000/media/cards/x` répond 404 depuis l'API (en-tête `x-request-id` présent).
- [ ] **Step 5 : Commit** — `git add -A backend compose.test.yml frontend && git commit -m "test: cards seed scenario and media-ready e2e stack"`

---

### Task 13 : Thèmes et polices (web)

**Files:**
- Create: `frontend/web/src/lib/theme/{presets.ts, fonts.ts, fonts.css, resolve.ts, contrast.ts, presets.test.ts, resolve.test.ts, contrast.test.ts}`
- Modify: `frontend/web/package.json` (`@fontsource-variable/inter`, `@fontsource-variable/playfair-display`, `@fontsource-variable/source-sans-3`, `@fontsource-variable/fraunces`, `@fontsource-variable/nunito-sans`), `frontend/web/src/app/layout.tsx` (import de `fonts.css`), `frontend/web/messages/fr.json` (`themes.*`, `fonts.*`)

**Interfaces:**
- Consumes : le type généré `components["schemas"]["Theme"]` (alias `ThemeSettings`).
- Produces :
  - `THEME_PRESETS: readonly ThemePreset[]` — 6 entrées `clair`, `sombre`, `sable`, `ocean`, `foret`, `corail` ; `ThemePreset { id, nameKey, accent, text, background, headerGradient, buttonShape, font }` ; `DEFAULT_PRESET_ID = "clair"` ;
  - `FONT_PAIRS: readonly FontPair[]` — `moderne` (Inter / Inter), `editorial` (Playfair Display / Source Sans 3), `chaleureux` (Fraunces / Nunito Sans) ; `FontPair { id, nameKey, heading: string, body: string }` (familles CSS de fontsource) ; `DEFAULT_FONT_ID = "moderne"` ;
  - `resolveTheme(raw: unknown): ResolvedTheme` — preset inconnu ou absent → `clair` ; police inconnue → celle du preset ; toute surcharge invalide ignorée (même contrôles que TPL-017) ;
  - `ResolvedTheme { presetId, fontId, accent, text, background: { kind: "solid"; color } | { kind: "gradient"; from; to; angle }, headerGradient: number, buttonShape: "square" | "rounded" | "pill", fonts: { heading, body } }` ;
  - `themeStyle(theme): React.CSSProperties` — variables `--card-accent`, `--card-text`, `--card-bg` (couleur ou `linear-gradient(<angle>deg, from, to)`), `--card-header-gradient` (0 à 1), `--card-radius` (`0` / `0.75rem` / `9999px`), `--card-font-heading`, `--card-font-body` ;
  - `contrastRatio(a: string, b: string): number` (luminance relative WCAG 2.x) · `hasContrastWarning(theme: ResolvedTheme): boolean` (`< 4.5` contre la couleur de fond, ou contre la plus défavorable des deux couleurs du dégradé).

- [ ] **Step 1 : Écrire les tests**

```ts
test("TPL-009 six presets, all readable", () => { /* 6 ids distincts ; hasContrastWarning(resolveTheme({preset:id})) === false pour chacun */ });
test("TPL-011 TPL-012 font pairs come from self-hosted packages", () => { /* 3 paires ; fonts.css n'importe que des modules @fontsource-variable/* ; aucune chaîne "googleapis" dans fonts.css */ });
test("TPL-018 contrast ratio matches WCAG", () => { /* #000/#fff → 21 ; #777777/#ffffff ≈ 4.48 (warning) ; #767676/#ffffff ≥ 4.5 (pas de warning) */ });
test("TPL-018 gradient uses the worst stop", () => { /* texte #ffffff, dégradé #000000 → #ffffff → warning */ });
test("TPL-019 unknown preset and font fall back to defaults", () => { /* {preset:"retire", font:"inconnue"} → presetId "clair", fontId "moderne" */ });
test("TPL-010 TPL-017 overrides apply, invalid ones are ignored", () => { /* accent "#FF0000" → "#ff0000" ; accent "url(x)" → accent du preset ; header_gradient 150 → preset */ });
test("TPL-010 themeStyle exposes css variables", () => { /* pill → --card-radius 9999px ; gradient → linear-gradient(90deg, …) */ });
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/lib/theme` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.** Couleurs des presets : sobres et lisibles (elles seront remplacées au plan 6) ; aucun nom de preset en dur, tout par `nameKey`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `pnpm -C frontend -r typecheck` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add frontend && git commit -m "feat(web): theme presets, font pairs, resolution and contrast check"`

---

### Task 14 : Contrat des templates, schéma de réglages et template Classique

**Files:**
- Create: `frontend/web/src/templates/{contract.ts, ids.ts, registry.ts, settings-schema.ts, settings-schema.test.ts, registry.test.ts, contract.test.tsx, fixtures.ts}`, `frontend/web/src/templates/classique/{index.ts, Classique.tsx, settings.ts, Classique.test.tsx}`
- Modify: `frontend/web/messages/fr.json` (`templates.classique.*`, `publicCard.*`)

**Interfaces:**
- Consumes : `ResolvedTheme`, `themeStyle` ; types générés `PublicCard`, `MediaView`.
- Produces :
  - `ids.ts` : `export const TEMPLATE_IDS = ["classique"] as const; export type TemplateId = (typeof TEMPLATE_IDS)[number];` (sans import React : le paquet e2e l'importe) ;
  - `contract.ts` :
    - `PublicEvent { id: string; title: string; startsAt: string }` ;
    - `TemplateProps<S> { card: PublicCard; theme: ResolvedTheme; settings: S; events: PublicEvent[]; urls: { vcard: string; eventForm(eventId: string): string }; labels: TemplateLabels; mode: "public" | "preview" }` ;
    - `TemplateLabels { saveContact: string; links: Record<LinkKind, string> }` : textes fixes traduits par l'appelant (`getTranslations` côté serveur, `useTranslations` dans l'aperçu), pour que le template reste sans hook ; `buildTemplateLabels(t)` dans `templates/contract.ts` ;
    - `TemplateDefinition<S> { id: TemplateId; nameKey: string; beta: boolean; supportsTheme: boolean; media: { header: ("image" | "video")[]; avatar: boolean }; settings: SettingsSchema; Component: (props: TemplateProps<S>) => React.ReactElement }` ;
    - `TEMPLATE_TEST_IDS` : `name: "card-name"`, `jobTitle: "card-job-title"`, `company: "card-company"`, `description: "card-description"`, `email: "card-email"`, `phone: "card-phone"`, `avatar: "card-avatar"`, `headerImage: "card-header-image"`, `headerVideo: "card-header-video"`, `saveContact: "save-contact"`, `link: (i) => "card-link-" + i`, `eventButton: (id) => "event-button-" + id`. Tout template doit les poser ; les tests e2e ne s'appuient que sur eux ;
    - règle documentée en tête du fichier : un template ne contient ni hook ni gestionnaire d'événement, ni API serveur ou navigateur, pour être rendu tel quel par un Server Component et dans l'aperçu client (TPL-014) ;
  - `settings-schema.ts` : `SettingsField = { kind: "select"; key; labelKey; options: { value: string; labelKey: string }[]; default: string } | { kind: "boolean"; key; labelKey; default: boolean } | { kind: "range"; key; labelKey; min: number; max: number; step: number; default: number } | { kind: "color"; key; labelKey; default: string }` ; `SettingsSchema { fields: SettingsField[] }` ; `parseSettings(schema, raw: unknown): Record<string, string | number | boolean>` (clé inconnue retirée, valeur absente ou invalide → `default`, range borné, couleur `#rrggbb`) ;
  - `registry.ts` : `TEMPLATES: Record<TemplateId, TemplateDefinition<any>>` · `getTemplate(id: string): TemplateDefinition<any>` (inconnu → `classique`) · `listTemplates(): TemplateDefinition<any>[]` (tous, sans filtre, TPL-007) · `renderTemplate({ template, settings, theme, card, events, urls, mode })` qui applique `getTemplate`, `parseSettings` et `resolveTheme` ;
  - `fixtures.ts` : `sampleCard: PublicCard` (Éloïse D'Aubigné-Müller, accents, émoji, 3 liens dont un libre, avatar et en-tête image) et `sampleEvents: PublicEvent[]` (deux événements dans le désordre) ;
  - Classique (5.2 du design) : en-tête pleine largeur (`<video autoPlay muted loop playsInline poster>` ou `<img srcSet sizes="100vw">`, sinon fond du thème), dégradé dont l'opacité suit `--card-header-gradient`, avatar rond centré à cheval, boutons d'événement triés par `startsAt` (animation CSS si `animate_events`), nom/poste/entreprise/description, `mailto:` et `tel:`, liens avec icône `lucide-react` (repli `Globe` / `Link` pour une marque absente), bouton « Enregistrer le contact » `<a href={urls.vcard} download>` ; réglages : `links_layout` (select `list` | `icons`, défaut `list`) et `animate_events` (boolean, défaut `true`).

- [ ] **Step 1 : Écrire les tests**

```ts
// settings-schema.test.ts
test("TPL-016 invalid or missing settings fall back to defaults", () => { /* select hors options, booléen "oui", range 999, couleur "url(x)", clé inconnue → defaults, clé retirée */ });
test("TPL-004 parseSettings keeps valid values", () => { ... });
// registry.test.ts
test("TPL-008 registry holds exactly TEMPLATE_IDS, including the backend default", () => { /* Object.keys(TEMPLATES) == TEMPLATE_IDS ; contient "classique" (DEFAULT_TEMPLATE du backend) ; DEFAULT_PRESET_ID == "clair" (DEFAULT_THEME_PRESET) */ });
test("TPL-015 unknown template renders as Classique", () => { /* getTemplate("retire").id === "classique" */ });
test("TPL-007 every template is listed for everyone", () => { /* listTemplates().length === TEMPLATE_IDS.length */ });
test("EDI-011 every template label is translated", () => { /* nameKey et chaque labelKey du schéma existent dans messages/fr.json */ });
// contract.test.tsx — describe.each(listTemplates())
test("TPL-002 TPL-014 renders on the server and in the browser", () => { /* renderToString(renderTemplate(...)) ne jette pas ; render() jsdom idem */ });
test("PUB-011 PUB-003 shows the card information", () => { /* name "Éloïse D'Aubigné-Müller", poste, entreprise, description avec émoji */ });
test("PUB-021 email and phone open the native apps", () => { /* href mailto:… et tel:+33… */ });
test("PUB-012 PUB-013 links keep their exact https url and order", () => { /* card-link-0..2 href identiques aux URLs de la carte, sans wrapper ni redirection */ });
test("PUB-014 save contact points to the vCard url", () => { /* save-contact href === urls.vcard, attribut download */ });
test("PUB-004 PUB-005 PUB-006 header video is muted, looping, inline, with poster", () => { /* video : muted, autoplay, loop, playsinline, poster = plus grande image d'attente */ });
test("PUB-007 avatar sits on the header gradient", () => { /* card-avatar présent, gradient avec opacité = headerGradient */ });
test("PUB-008 PUB-009 event buttons are sorted by start", () => { /* event-button-* dans l'ordre de startsAt, href = urls.eventForm(id) */ });
test("PUB-010 no event, no button area", () => { /* events [] → aucun event-button-*, aucun conteneur vide */ });
test("PUB-023 empty elements are not rendered", () => { /* sans avatar, sans email, sans en-tête → pas de card-avatar, card-email, card-header-* */ });
test("TPL-003 required test ids are present", () => { /* chaque TEMPLATE_TEST_IDS statique est posé avec sampleCard */ });
// classique/Classique.test.tsx
test("TPL-004 links_layout icons shows icon-only links", () => { /* liens avec aria-label, sans texte visible */ });
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/templates` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `pnpm -C frontend -r typecheck lint` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add frontend && git commit -m "feat(web): template contract, settings schema and Classique template"`

---

### Task 15 : Page publique `/c/[slug]`

**Files:**
- Create: `frontend/web/src/app/c/[slug]/{page.tsx, not-found.tsx}`, `frontend/web/src/components/public/InactiveCard.tsx`, `frontend/web/src/lib/{server-api.ts, public-card.ts, og.ts, og.test.ts}`, `frontend/e2e/tests/public-page.spec.ts`
- Modify: déplacer `frontend/web/src/app/{login,auth,dashboard,support}` dans `frontend/web/src/app/(app)/` avec un `(app)/layout.tsx` qui porte `<AuthProvider>` ; `frontend/web/src/app/layout.tsx` (n'enveloppe plus dans `AuthProvider`) ; `frontend/web/messages/fr.json` (`publicCard.inactive`, `publicCard.notFound`)

**Interfaces:**
- Consumes : `renderTemplate`, types générés, `createApiClient`.
- Produces :
  - `serverApiBaseUrl(): string` — `process.env.API_INTERNAL_URL`, défaut `http://localhost:8080` hors profil `production`, erreur si absent en `production` (comme `resolveApiInternalUrl`) ;
  - `fetchPublicCard(slug: string): Promise<PublicCardResponse | null>` (`null` sur 404), enveloppé dans `React.cache`, `cache: "no-store"` ;
  - `buildCardMetadata(card: PublicCard): Metadata` (PUB-028 : `title`, `openGraph { title, description: "poste · entreprise", images: [avatar.jpeg_url], url: card.public_url }`, `twitter.card = "summary"`) · `INACTIVE_METADATA: Metadata` (`robots: { index: false, follow: false }`, aucun champ de carte) ;
  - page : `redirect` → `permanentRedirect("/c/" + slug)` (308) ; `inactive` → `<InactiveCard>` (« Cette carte n'est plus active ») ; `null` → `notFound()` (« Carte introuvable », 404) ; `active` → `renderTemplate(..., mode: "public", events: [])`.

Le déplacement dans `(app)` ne change aucune URL ; il évite de charger le fournisseur d'identité (Clerk) sur la page publique, lue sur un Wi-Fi de salon (PUB-001). Le bandeau « MODE TEST » reste dans le layout racine (ACC-009).

- [ ] **Step 1 : Écrire les tests unitaires** (`og.test.ts`)

```ts
test("PUB-017 PUB-028 open graph uses name, title, company and the 512 jpeg", () => { /* title "Alice Durand", description "Fondatrice · Atelier Durand & Fils", image jpeg_url absolue, url public_url */ });
test("PUB-028 open graph without photo has no image", () => { ... });
test("LNK-027 inactive metadata reveals nothing and asks not to index", () => { /* robots index false ; pas d'openGraph */ });
```

- [ ] **Step 2 : Écrire les tests e2e** (`public-page.spec.ts`, `api.seed("cards")` dans un `beforeEach`)

```ts
for (const template of TEMPLATE_IDS) test.describe(`template ${template}`, () => {
  test.beforeEach(/* api.updateCard("seed-alice", aliceId, { template }) */);
  test("TPL-003 PUB-011 PUB-003 PUB-001 shows the card on mobile", /* nom, poste, description avec ✨ visibles (projets mobile et desktop) */);
  test("PUB-012 PUB-021 links, email and phone", /* card-link-0 href linkedin ; card-email mailto ; card-phone tel:+33612345678 */);
  test("PUB-014 PUB-027 save contact downloads the vCard", /* page.waitForEvent("download") → suggestedFilename "alice-durand.vcf", contenu commence par "BEGIN:VCARD" et contient "FN:Alice Durand" */);
  test("PUB-017 link preview tags", /* meta[property="og:title"] content "Alice Durand" */);
});
test("PUB-002 page is rendered by the server", /* contexte javaScriptEnabled:false → nom visible */);
test("TPL-012 no request to Google Fonts", /* page.on("request") : aucune URL fonts.googleapis.com ni fonts.gstatic.com */);
test("LNK-003 LNK-024 old slug redirects permanently", /* goto /c/alice → page.url() finit par /c/alice-durand ; api.get(`${WEB_URL}/c/alice`, { maxRedirects: 0 }) → 308 */);
test("LNK-021 uppercase slug redirects to lowercase", ...);
test("LNK-006 LNK-027 disabled card shows the neutral page", /* /c/alice-archive : texte neutre, status 200, meta robots noindex, aucun og:title, pas de « Ancien poste » */);
test("LNK-010 support-disabled card shows the same neutral page", /* /c/bob-martin : même texte, aucune mention du support */);
test("ADM-011 suspended owner shows the neutral page", /* /c/dan-moreau */);
test("LNK-012 deleted card shows the neutral page", /* /c/alice-ancienne */);
test("LNK-023 unknown slug is a 404", /* /c/personne → status 404, « Carte introuvable » */);
test("LNK-007 vCard of a disabled card is refused", /* GET /api/public/cards/alice-archive/vcard → 410 */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/lib/og` puis `make e2e ARGS="-g 'PUB-|LNK-|TPL-012|ADM-011'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.** `generateMetadata` et la page appellent le même `fetchPublicCard` (dédupliqué par `cache`).
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes, plus `make e2e ARGS="-g 'ACC-|ADM-00'"` (le déplacement dans `(app)` ne casse pas le plan 1) · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): server-rendered public card page with neutral and not-found states"`

---

### Task 16 : Tableau de bord — liste, création, actions, partage

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/cards/new/page.tsx`, `frontend/web/src/components/cards/{CardList.tsx, CardStatusBadge.tsx, NewCardForm.tsx, SlugField.tsx, CardActions.tsx, ShareCard.tsx, *.test.tsx}`, `frontend/web/src/lib/cards/{status.ts, slug-availability.ts, qr.ts, *.test.ts}`, `frontend/e2e/tests/cards.spec.ts`
- Modify: `frontend/web/src/app/(app)/dashboard/page.tsx`, `frontend/web/package.json` (`qrcode`, `@types/qrcode`), composants shadcn `input`, `label`, `dialog` (`pnpm -C frontend/web dlx shadcn@latest add input label dialog`), `frontend/web/messages/fr.json` (`cards.*`)

**Interfaces:**
- Consumes : routes des tâches 6 et 9, `useApi`, `AccountGate`.
- Produces :
  - `cardStatusLabelKey(status: CardStatus): "cards.status.active" | "cards.status.disabled" | "cards.status.disabledBySupport"` · `canToggle(status): boolean` (faux si `disabled_by_support`) ;
  - `useSlugAvailability(slug: string, cardId?: string): { status: "idle" | "checking" | SlugAvailability["status"]; normalized: string | null }` (attente de 300 ms, ignore une réponse périmée) ;
  - `qrSvg(url: string): Promise<string>` · `qrPng(url: string): Promise<Blob>` (bibliothèque `qrcode`, marge 2, correction `M`) ; noms de fichier `<slug>.svg` et `<slug>.png` ;
  - liste (EDI-012) : nom, lien public, badge d'état, actions « Modifier », « Désactiver » / « Réactiver » (masquées et remplacées par « Désactivée par le support » si bloquée, LNK-011), « Dupliquer » (demande un slug, proposé par `/api/slugs/suggestion`), « Supprimer » (dialogue de confirmation, EDI-002), « Copier le lien », « QR code SVG », « QR code PNG ». Un bouton d'action reste désactivé jusqu'à la fin du rechargement de la liste (suivi Task 13 du plan 1) ;
  - création (EDI-013) : prénom, nom, slug proposé (modifiable, état affiché par `SlugField`), « Créer » → redirection vers `/dashboard/cards/<id>`.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("EDI-012 LNK-011 status labels and toggling", () => { /* disabled_by_support → canToggle false */ });
test("LNK-029 LNK-017 QR code encodes the public url", async () => { /* qrSvg(url) commence par "<svg" ; décodage non requis : le module qrcode est appelé avec public_url (spy) ; qrPng → type image/png */ });
test("LNK-020 slug field shows availability", async () => { /* api mockée : "bob-martin" → « Déjà pris » ; "a" → « Invalide » ; libre → « Disponible » ; réponse périmée ignorée */ });
test("LNK-011 support-disabled card offers no reactivation", () => { /* CardActions : pas de bouton enable, texte « Désactivée par le support » */ });
test("EDI-002 delete asks for confirmation", async () => { /* clic Supprimer → dialogue ; Annuler → aucun appel DELETE ; Confirmer → DELETE */ });
test("LNK-005 action buttons stay disabled until the list reloads", async () => { ... });
```

- [ ] **Step 2 : Écrire les tests e2e** (`cards.spec.ts`, `api.seed("cards")`)

```ts
test("EDI-013 LNK-001 LNK-019 create a card from a suggested slug", /* alice : prénom Alice, nom Durand → slug proposé "alice-durand-2" → Créer → éditeur ouvert ; /c/alice-durand-2 affiche la carte */);
test("LNK-020 taken slug is flagged before saving", /* saisir "bob-martin" → « Déjà pris », bouton Créer désactivé */);
test("EDI-001 LNK-005 LNK-009 disable then enable", /* Désactiver → /c/alice-durand neutre ; Réactiver → carte visible au même lien */);
test("LNK-011 support-disabled card for its owner", /* bob : badge « Désactivée par le support », aucun bouton Réactiver */);
test("EDI-014 duplicate a card", /* Dupliquer, slug "alice-bis" → nouvelle ligne, /c/alice-bis affiche le contenu d'Alice */);
test("EDI-002 LNK-012 delete with confirmation", /* Supprimer → Confirmer → ligne disparue ; /c/alice-durand neutre */);
test("LNK-017 LNK-029 share: link and QR codes", /* lien affiché "http://localhost:13000/c/alice-durand" ; téléchargements alice-durand.svg et alice-durand.png */);
test("ACC-017 another user's card is not reachable", /* bob ouvre /dashboard/cards/<id d'alice> → message « Carte introuvable » */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/lib/cards src/components/cards` puis `make e2e ARGS="-g 'EDI-0|LNK-0|ACC-017'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): card list, creation, actions and sharing"`

---

### Task 17 : Éditeur — contenu, réglages générés, thème, aperçu en direct

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/cards/[id]/page.tsx`, `frontend/web/src/components/editor/{CardEditor.tsx, ContentFields.tsx, LinksEditor.tsx, TemplatePicker.tsx, SettingsForm.tsx, ThemeEditor.tsx, PhonePreview.tsx, *.test.tsx}`, `frontend/web/src/lib/cards/{draft.ts, draft.test.ts}`, `frontend/e2e/tests/editor.spec.ts`
- Modify: `frontend/api-client/src/index.ts` et `index.test.ts` (`ApiError.fields: { field: string; code: string }[]`, lu depuis `error.fields`, `[]` sinon), composants shadcn `textarea`, `switch`, `select`, `slider`, `frontend/web/messages/fr.json` (`editor.*`, `fieldErrors.*`)

**Interfaces:**
- Consumes : `renderTemplate`, `listTemplates`, `parseSettings`, `resolveTheme`, `hasContrastWarning`, `useSlugAvailability`, route `PUT /api/cards/{id}`.
- Produces :
  - `CardDraft { slug; template; settings: Record<string, unknown>; theme: ThemeSettings; content: { first_name; last_name; job_title; company; description; email; phone: string }; links: { kind: LinkKind; url: string; label: string }[]; header: MediaView | null; avatar: MediaView | null }` ;
  - `draftFromCard(card: CardView): CardDraft` · `draftToUpdateBody(draft): UpdateCardBody` (chaînes vides → `null`, `header_media_id`/`avatar_media_id` depuis les médias) · `draftToPublicCard(draft, publicBaseUrl: string): PublicCard` · `isDirty(saved: CardDraft, current: CardDraft): boolean` · `fieldErrors(error: unknown): Record<string, string>` (chemin → clé `fieldErrors.<code>`) · `PREVIEW_EVENT_ID = "preview"` ;
  - `SettingsForm({ schema, value, onChange })` : un contrôle par `kind` (`select` → Select, `boolean` → Switch, `range` → Slider, `color` → `input type=color`), libellés par `labelKey` ; aucune connaissance d'un template précis ;
  - `PhonePreview({ draft, simulateEvent })` : cadre de téléphone (390 × 844, mis à l'échelle), rend `renderTemplate(..., mode: "preview")` avec `events: simulateEvent ? [événement « Événement de démonstration »] : []` ; un `onClickCapture` qui appelle `preventDefault` sur les liens (l'aperçu ne navigue jamais) ;
  - `CardEditor` : formulaire à gauche, aperçu à droite (`lg:grid-cols-2`, empilé en dessous), interrupteur « Simuler un événement en cours », bouton « Enregistrer » ; erreurs affichées sous chaque champ (`aria-describedby`) ; `beforeunload` tant que `isDirty` et confirmation sur le lien « Retour » ;
  - `TemplatePicker` : tous les templates de `listTemplates()`, badge « bêta » si `beta` (TPL-006).

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("EDI-006 draft round trip", () => { /* draftToUpdateBody(draftFromCard(card)) == corps attendu ; "" → null */ });
test("TPL-014 EDI-004 preview card mirrors the draft", () => { /* draftToPublicCard : content, links, avatar, vcard_url */ });
test("EDI-015 field errors map to paths", () => { /* ApiError fields [{links[0].url, invalid_url}] → {"links[0].url": "fieldErrors.invalid_url"} */ });
test("TPL-004 EDI-007 settings form is generated from any schema", () => { /* schéma factice avec les 4 kinds → 4 contrôles, onChange émet la bonne valeur ; aucun import de templates/classique */ });
test("TPL-006 TPL-005 template picker shows beta badge", () => { /* liste injectée avec un template beta → badge « bêta » */ });
test("TPL-013 TPL-018 theme editor warns on low contrast", () => { /* texte #ffffff sur preset clair → avertissement visible ; Enregistrer reste actif */ });
test("TPL-010 theme editor edits every override", () => { /* accent, fond uni/dégradé, texte, intensité, forme des boutons, police → draft.theme */ });
test("EDI-004 preview updates on each keystroke", async () => { /* saisir le poste → texte présent dans l'aperçu, aucun appel PUT */ });
test("EDI-005 EDI-017 simulated event only in preview", async () => { /* interrupteur → event-button-preview dans l'aperçu ; corps du PUT sans événement */ });
test("EDI-015 rejected save keeps the input and shows errors", async () => { /* PUT → 400 fields → message sous le champ lien, valeur saisie intacte */ });
test("EDI-016 leaving with unsaved changes asks first", () => { /* dirty → événement beforeunload preventDefault ; propre → non */ });
test("EDI-003 form and phone preview side by side", () => { /* deux régions (formulaire, aperçu) présentes, aperçu avec data-testid phone-preview */ });
```

- [ ] **Step 2 : Écrire les tests e2e** (`editor.spec.ts`, `api.seed("cards")`, alice ouvre son éditeur)

```ts
test("EDI-004 EDI-006 preview is live, public page changes only on save", /* poste « Directrice » visible dans l'aperçu ; /c/alice-durand (autre onglet) montre encore « Fondatrice » ; Enregistrer → « Directrice » publié */);
test("EDI-005 EDI-017 simulated event never reaches the public page", /* interrupteur → bouton dans l'aperçu ; Enregistrer ; /c/alice-durand sans event-button-* */);
test("EDI-015 PUB-022 invalid link is refused next to its field", /* URL "javascript:alert(1)" → erreur sous le champ, poste saisi conservé, page publique inchangée */);
test("LNK-003 changing the slug keeps the old link working", /* slug "alice-d" → Enregistrer → /c/alice-durand redirige vers /c/alice-d */);
test("TPL-004 template setting shows in the preview", /* links_layout icons → liens sans texte dans l'aperçu */);
test("EDI-016 reload with unsaved changes asks for confirmation", /* page.on("dialog") sur reload */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend test` (web et api-client) puis `make e2e ARGS="-g 'EDI-|TPL-004'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): card editor with schema-driven settings, theme and live preview"`

---

### Task 18 : Éditeur — médias

**Files:**
- Create: `frontend/web/src/components/editor/{MediaField.tsx, AvatarCropper.tsx, MediaField.test.tsx}`, `frontend/web/src/lib/media/{upload.ts, video.ts, crop.ts, upload.test.ts}`, `frontend/e2e/tests/media.spec.ts`, `frontend/e2e/fixtures/{avatar.jpg, header-2s.mp4, header-31s.mp4, README.md}`
- Modify: `frontend/web/src/components/editor/CardEditor.tsx`, `frontend/web/package.json` (`react-easy-crop`), `frontend/web/messages/fr.json` (`media.*`)

**Interfaces:**
- Consumes : `POST /api/cards/{id}/media`, `TemplateDefinition.media`, `CardDraft.header` / `avatar`.
- Produces :
  - `checkBeforeUpload(file: File, slot: "header" | "avatar"): "unsupported" | "too_large" | null` (indication immédiate ; le serveur reste l'arbitre) ;
  - `uploadMedia(getToken, cardId, slot, file: Blob, poster?: Blob): Promise<MediaView>` (`fetch` + `FormData` vers `/api/cards/{id}/media`, erreurs converties en `ApiError` comme le client généré) ;
  - `readVideoDuration(file: File): Promise<number>` · `capturePoster(file: File, atSeconds = 0.1): Promise<Blob>` (élément `<video>` hors DOM, `seeked`, canvas, `toBlob("image/jpeg", 0.85)`) ;
  - `cropToSquare(image: Blob, area: { x; y; width; height }, size = 1024): Promise<Blob>` (JPEG) ;
  - `MediaField` : un champ par média déclaré par le template (`media.header`, `media.avatar`) ; une vidéo passe par `readVideoDuration` (> 30 s → message avant envoi) puis `capturePoster` ; l'avatar passe par `AvatarCropper` (`react-easy-crop`, recadrage carré, masque rond, MED-005) ; « Retirer » met le média à `null` dans le brouillon ; les codes serveur (`video_too_long`, `poster_required`, `image_too_large`, `payload_too_large`, `unsupported_media_type`) ont chacun un message.

Fixtures (commandes dans `fixtures/README.md`) : `ffmpeg -f lavfi -i color=c=0x3366cc:s=640x360:d=2 -c:v libvpx-vp9 -an -f mp4 header-2s.mp4`, idem `d=31` pour `header-31s.mp4` (VP9 : le Chromium de Playwright ne décode pas le H.264), `ffmpeg -f lavfi -i testsrc=s=800x600 -frames:v 1 avatar.jpg`.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("MED-012 MED-002 client-side hints before upload", () => { /* image/gif → unsupported ; image 11 Mo → too_large ; video/mp4 26 Mo → too_large ; video en avatar → unsupported */ });
test("MED-003 upload sends slot, file and poster", async () => { /* fetch mocké : FormData avec slot=header, file, poster ; Authorization Bearer */ });
test("MED-013 server media errors are shown", async () => { /* 400 fields [{file, video_too_long}] → message « La vidéo dépasse 30 secondes » */ });
test("MED-001 a new header replaces the previous one in the draft", ...);
test("TPL-004 only the media slots declared by the template are offered", () => { /* définition factice sans vidéo → input accept sans video/mp4 */ });
```

- [ ] **Step 2 : Écrire les tests e2e** (`media.spec.ts`)

```ts
test("MED-005 MED-006 PUB-014 avatar is cropped, published as WebP and in the vCard", /* envoyer avatar.jpg, valider le recadrage, Enregistrer → /c/alice-durand : card-avatar srcset en .webp ; vCard contient "PHOTO;ENCODING=b;TYPE=JPEG:" */);
test("MED-003 PUB-005 PUB-006 header video with captured poster", /* envoyer header-2s.mp4 → Enregistrer → card-header-video : poster .webp, muted, loop, playsinline */);
test("MED-013 too long video is refused before upload", /* header-31s.mp4 → message, aucune requête POST media */);
test("MED-017 media served through the web origin honours Range", /* api GET http://localhost:13000/media/…/video.mp4 avec Range bytes=0-99 → 206, 100 octets */);
test("MED-012 uploads above 10 MB pass the web rewrite", /* header-2s.mp4 suivi d'une boîte "free" de 11 Mo, envoyé à http://localhost:13000/api/cards/{id}/media avec un poster → 201 */);
test("MED-018 EDI-006 an unsaved upload does not reach the public page", /* envoyer un avatar sans enregistrer → /c/alice-durand sans card-avatar */);
```

Si le projet `mobile` (WebKit) ne décode pas la fixture VP9, les deux tests qui capturent une image d'attente tournent seulement sur `desktop`, avec un commentaire qui le justifie ; les autres restent sur les deux projets.

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/lib/media src/components/editor/MediaField` puis `make e2e ARGS="-g MED-"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.** Si l'envoi de plus de 10 Mo échoue à travers la réécriture Next (limite de corps du proxy), corriger dans `next.config.ts` et noter la cause dans le message de commit.
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): header image/video and avatar upload in the editor"`

---

### Task 19 : Support — cartes d'un utilisateur et modération

**Files:**
- Create: `frontend/web/src/app/(app)/support/users/[id]/page.tsx`, `frontend/web/src/app/(app)/support/cards/[id]/page.tsx`, `frontend/web/src/components/support/{UserCards.tsx, CardModeration.tsx, *.test.tsx}`, `frontend/e2e/tests/support-cards.spec.ts`
- Modify: `frontend/web/src/components/support/UserModerationTable.tsx` (le nom mène à `/support/users/<id>`, `data-testid="user-link-<subject>"`), `frontend/web/messages/fr.json` (`support.cards.*`)

**Interfaces:**
- Consumes : routes de la tâche 11, `PhonePreview` (avec un brouillon construit par `draftFromCard`), `CardStatusBadge`.
- Produces :
  - page utilisateur (ADM-006, ADM-013) : profil (nom, email, statut) et liste des cartes (nom, slug, badge d'état, lien « Voir ») ;
  - page carte : aperçu en lecture seule (aucun champ modifiable, ADM-012), lien vers la page publique, `CardModeration` avec « Désactiver (support) » ou « Lever le blocage » selon l'état ; bouton désactivé jusqu'au rechargement.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("ADM-009 ADM-010 moderation button follows the support state", async () => { /* active → « Désactiver » → POST support-disable ; disabled_by_support → « Lever le blocage » */ });
test("ADM-012 support card page has no editable field", () => { /* aucun input/textarea dans la page carte */ });
```

- [ ] **Step 2 : Écrire les tests e2e** (`support-cards.spec.ts`, `api.seed("cards")`)

```ts
test("ADM-006 ADM-013 admin browses a user's cards, even disabled", /* seed-admin : /support → user-link-seed-alice → 2 cartes ; Voir alice-archive → aperçu avec « Ancien poste » */);
test("ADM-009 LNK-010 LNK-011 admin disables a card", /* Désactiver alice-durand → /c/alice-durand neutre ; alice voit « Désactivée par le support » sans Réactiver */);
test("ADM-010 admin lifts the block", /* bob-martin → Lever le blocage → /c/bob-martin visible */);
test("ADM-001 non-admin cannot open support card pages", /* alice /support/users/<id> → « Accès réservé » */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web test -- src/components/support` puis `make e2e ARGS="-g 'ADM-0'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS (tests ADM du plan 1 compris).
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): support view of a user's cards with moderation"`

---

### Task 20 : Skill « ajouter un template de carte », documentation, statut de la spec, vérification finale

**Files:**
- Create: `.claude/skills/add-card-template/SKILL.md`
- Modify: `CLAUDE.md` (carte du dépôt : `frontend/web/src/templates/`, stockage des médias ; tableau des skills ; retirer la phrase « La skill … viendra avec le plan 2 »), `.claude/skills/change-api/SKILL.md` (erreurs de champ `ApiError::Validation`, multipart `ApiMultipart`, nettoyage de stockage après commit), `.claude/skills/add-seed-scenario/SKILL.md` (`SeedReport { users, cards }`, `TestApi.seed` renvoie le rapport, scénario `cards`), `.claude/skills/dev-env/SKILL.md` (`MEDIA_LOCAL_DIR`, `.data/media`), statut des fichiers `spec/` touchés

**Interfaces:**
- Produces : la skill `add-card-template`, frontmatter `name: add-card-template`, `description: Use when adding a new card template (public page layout) to Cartouche: template folder, settings schema, registry, translations, contract and e2e coverage.` Corps en français :
  1. créer `frontend/web/src/templates/<id>/` (`index.ts` qui exporte la `TemplateDefinition`, le composant, `settings.ts`) en copiant `classique/` ; respecter la règle « sans hook, sans gestionnaire, sans API serveur ou navigateur » et poser tous les `TEMPLATE_TEST_IDS` ;
  2. ajouter l'id à `TEMPLATE_IDS` (`ids.ts`) et la définition à `TEMPLATES` (`registry.ts`) ; `beta: true` tant qu'il est en test (TPL-006) ;
  3. déclarer les réglages dans le schéma (`select`, `boolean`, `range`, `color`) et les médias acceptés : l'éditeur s'adapte seul (TPL-004) ;
  4. ajouter `templates.<id>.*` dans `messages/fr.json` ;
  5. lancer `pnpm -C frontend --filter web test -- src/templates` (la suite de contrat tourne sur le nouveau template) puis `make e2e ARGS="-g TPL-003"` (la boucle de `public-page.spec.ts` le couvre) ; le backend n'a rien à changer (TPL-015).

- [ ] **Step 1 : Écrire la skill et mettre à jour la documentation** listée ci-dessus.
- [ ] **Step 2 : Mettre à jour les statuts de la spec**
  - `card-links.md` : `> Statut : implémenté (plan 2) ; LNK-015 et LNK-016 : plan 4` ;
  - `public-page.md` : `> Statut : implémenté (plan 2) ; PUB-008 à PUB-010 : vérifiés avec un événement simulé, alimentés par les vrais événements au plan 3` ;
  - `templates-themes.md` : `> Statut : implémenté (plan 2) ; TPL-003 : formulaire et consentement vérifiés sur chaque template au plan 3` ;
  - `media.md` : `> Statut : implémenté (plan 2)` ;
  - `dashboard-editor.md` : `> Statut : implémenté (plan 2) ; EDI-009 : plan 3 ; EDI-010 : plan 4` ;
  - `admin-support.md` : `> Statut : implémenté : ADM-001 à ADM-006 et ADM-009 à ADM-015 (plans 1 et 2) ; ADM-007 et ADM-008 : plan 4` ;
  - `account-auth.md` : `> Statut : implémenté (plans 1 et 2) : ACC-001 à ACC-017 ; ACC-018 : plan 4`.
- [ ] **Step 3 : Vérifier la couverture**

Run: `node scripts/spec-lint.mjs --coverage`
Expected : exit 0 ; aucune règle LNK (hors LNK-015, LNK-016), PUB, TPL, MED, EDI (hors EDI-009, EDI-010), ADM-006, ADM-009 à ADM-015 ni ACC-017 dans la liste des règles non citées. Toute règle restante reçoit son test dans la tâche qui la possède avant de continuer.

- [ ] **Step 4 : Vérification complète**

Run: `make lint test` puis `make e2e`
Expected : tout passe (projets `mobile` et `desktop`) ; `git status` propre hormis les fichiers de cette tâche.

- [ ] **Step 5 : Commit** — `git add -A .claude CLAUDE.md spec && git commit -m "docs: add-card-template skill, plan 2 docs and spec status"`
