# Cartouche — Plan 3 : Événements, formulaire prospect et anti-abus — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le propriétaire d'une carte déclare des événements datés (au plus 3 simultanés), avec un formulaire configurable, un code d'accès optionnel et une limite par appareil ; pendant un événement, la page publique affiche un bouton par événement en cours, qui ouvre un formulaire plein écran où le prospect saisit ses coordonnées et donne son consentement ; le serveur protège les envois (fenêtre de 15 minutes, code revérifié, limite par appareil, limite par IP, champ piège) et le propriétaire retrouve les contacts d'un événement, qu'il peut marquer comme spam ou supprimer.

**Architecture:** Les règles pures (périodes, chevauchement, état d'un événement, code d'accès, définition des champs, texte de consentement, validation des réponses, version du formulaire, fenêtre glissante de la limite par IP, décision d'accès public) vont dans `cartouche-domain`. `cartouche-api` ajoute les tables `events` et `leads` (migration `0005`), des routes propriétaire filtrées par `owner_id` dans `db/`, trois routes publiques sous `/api/public/cards/{slug}/events/{event_id}` (formulaire, déverrouillage par code, envoi) et un limiteur en mémoire derrière le trait `RateLimiter`, alimenté par l'extracteur `ClientIp`. L'horloge vient toujours de `state.clock` : la phase d'un événement, la fenêtre d'envoi et la limite par IP sont donc pilotables par `POST /api/test/clock`. Côté web, le formulaire prospect est un composant commun à tous les templates (`/c/[slug]/e/[eventId]`), rendu avec le thème de la carte ; le template ne fournit que le bouton. Le tableau de bord gagne une page d'événements par carte, un éditeur d'événement et la liste des contacts d'un événement.

**Tech Stack:** existant des plans 1 et 2 (Rust 2024, Axum 0.8, SQLx 0.9 hors ligne, utoipa 5, `object_store` 0.14, `image` 0.25 · Next 16, React 19, Tailwind 4, shadcn/ui, next-intl, openapi-fetch, Vitest, Playwright 1.64) + `aws-lc-rs` 1.19 en dépendance directe (déjà dans le `Cargo.lock` par `jsonwebtoken`, pour la signature HMAC des adresses de médias) · `date-fns` 4 et `@date-fns/tz` 1 (conversion entre fuseau de l'utilisateur et UTC).

**Spec:** `spec/` (fait foi) : `events.md` (EVT), `event-form.md` (FRM), `anti-abuse.md` (ABU), `dashboard-editor.md` (EDI-009, EDI-018 à EDI-020), `public-page.md` (PUB-008 à PUB-010, PUB-029), `templates-themes.md` (TPL-003, TPL-020), `media.md` (MED-021 à MED-024), `card-links.md` (LNK-030). Design initial figé : `docs/superpowers/specs/2026-11-02-cartouche-design.md`, sections 5.3 à 5.6, 7 et 8. Règles ajoutées pour ce plan : EVT-016 à EVT-030, FRM-024 à FRM-042, ABU-005 à ABU-010, EDI-018 à EDI-020, PUB-029, TPL-020, MED-021 à MED-024, LNK-030, plus quatre termes du glossaire.

**Chemins :** `backend/` (workspace Cargo : `domain/`, `server/`), `frontend/` (workspace pnpm : `web/`, `api-client/`, `e2e/`). Poste local : `source ~/.cargo/env` et `export PATH="$HOME/.local/bin:$PATH"` avant `make`. La base de développement de cette worktree est `cartouche_plan3` sur le PostgreSQL partagé de `localhost:54320` (fixée dans le `.env` de la worktree) : **ne pas lancer `make dev-db`**, la base tourne déjà ; `make sqlx-prepare` et `make sqlx-check` l'utilisent.

**Suivis :** `docs/superpowers/plans/2026-11-03-cartouche-plan-3-followups.md` (rulings de la phase spec/plan, puis ceux de l'exécution).

---

## Points tranchés sans le porteur

Ce plan s'exécute sans intervention du porteur du projet : chaque question ouverte a été tranchée en faveur de l'option la plus cohérente avec la spec existante et le design figé, écrite en règle numérotée, et consignée comme ruling (`R-S<n>`) dans le fichier de suivis. Aucune ne contredit une règle déjà implémentée, sauf le point 18, qui change un comportement du plan 2 (les médias d'une carte non servie) et le fait par une règle explicite.

1. **Forme de l'API** (R-S1) : routes propriétaire `GET|POST /api/cards/{id}/events`, `GET|PUT|DELETE /api/events/{id}`, `POST /api/events/{id}/end`, `GET /api/events/{id}/leads`, `PUT /api/leads/{id}/spam`, `DELETE /api/leads/{id}` ; routes publiques `GET /api/public/cards/{slug}/events/{event_id}`, `POST …/unlock`, `POST …/leads`. Nouveaux codes : `too_many_simultaneous_events` 409, `event_not_running` 409, `event_closed` 409, `form_changed` 409, `device_limit_reached` 409, `invalid_access_code` 403, `rate_limited` 429. Tâches 7 à 10.
2. **Le formulaire n'est envoyé qu'après le code** (EVT-027, R-S2) : sans code correct, le navigateur ne reçoit que l'identifiant et le titre ; `POST …/unlock` renvoie la définition. Le code est renvoyé avec l'envoi et revérifié (EVT-013, FRM-041). Tâches 8, 9 et 17.
3. **Limite des 3 événements sans course** (EVT-018, R-S3) : création et modification verrouillent la ligne de la carte (`cards::lock_for_owner`, `for update`) avant de lire les autres événements. Test de concurrence (Review Focus 1). Tâche 7.
4. **Fuseau horaire** (EVT-022, EVT-023, R-S4) : celui du navigateur, Europe/Paris s'il n'y en a pas ; nom du fuseau affiché près des dates ; l'API ne parle qu'en UTC RFC 3339 ; Playwright fixe `timezoneId: "Europe/Paris"` et `locale: "fr-FR"`. Pas de préférence stockée en v1. Tâches 11, 13 et 14.
5. **Fenêtre du formulaire = fenêtre d'envoi** (EVT-026, R-S5) : consulter, déverrouiller et envoyer sont possibles du début jusqu'à 15 minutes après la fin, pour qu'un rechargement pendant la grâce de EVT-008 ne perde pas le prospect ; les boutons publics, eux, ne montrent que les événements en cours (PUB-029). Tâches 3, 8, 9 et 17.
6. **Identifiant d'appareil** (EVT-028, EVT-029, R-S6) : UUID créé par le navigateur, cookie `cartouche_device` + stockage local, envoyé dans le corps (`device_id`) ; stocké tel quel (aléatoire, sans lien avec une personne) ; compté par événement, spam compris, contacts supprimés exclus ; course évitée par un verrou consultatif PostgreSQL sur (événement, appareil). Tâches 6, 9 et 16.
7. **Limites par IP** (ABU-006 à ABU-008, R-S7) : 120 envois par IP sur 10 minutes glissantes, 30 codes faux par IP sur 10 minutes ; IP = n-ième entrée de droite de `X-Forwarded-For` avec `TRUSTED_PROXY_HOPS` (défaut 1 : Caddy en production, la réécriture Next en dev et en test), IPv6 regroupée par /64 ; limiteur en mémoire (une seule instance d'API en v1) derrière le trait `RateLimiter`. Tâches 5, 8 et 9.
8. **Champ piège** (ABU-005, R-S8) : champ texte `fax`, hors écran ; un envoi qui le remplit reçoit le même `204` qu'un envoi accepté, rien n'est stocké, il ne compte pas pour l'appareil (il compte pour la limite par IP, vérifiée avant tout). Tâches 9 et 17.
9. **Stockage d'un contact** (FRM-038, R-S9) : colonnes typées pour les champs standards (utile à la recherche du plan 4), `custom_answers jsonb` avec un instantané `{field_id, label, kind, value}` de chaque champ personnalisé présent à l'envoi (`null` si non renseigné), `consent_at` et `consent_text`, `device_id` ; pas d'adresse IP. Tâche 6.
10. **Version du formulaire** (FRM-030, R-S10) : `form_version`, empreinte FNV-1a 64 bits de ce que voit le prospect (titre, description, champs, texte de consentement résolu) ; un envoi d'une autre version reçoit `409 form_changed`. C'est ce qui garantit que le texte enregistré (FRM-008) est bien celui qui a été affiché. Tâches 4, 9, 16 et 17.
11. **Texte de consentement par défaut** (FRM-026, FRM-027, R-S11) : texte français écrit dans la spec, mot pour mot ; il vit dans `cartouche-domain` (`consent.rs`) et non dans `fr.json`, car le serveur doit enregistrer le texte exact accepté : c'est une exception assumée à « aucun texte d'interface en dur ». Une carte a toujours un prénom ou un nom (PUB-018) ; sans email, la phrase sur les droits renvoie au responsable. Tâches 4 et 14.
12. **Valeurs des limites** (EVT-016, EVT-030, FRM-031 à FRM-036, R-S12) : titre 120, description 2 000, code 32, limite par appareil 1 à 100, 30 champs personnalisés, libellé 100, aide 300, 2 à 20 options de 100 caractères, réponses 100/254/200/20/500/5 000 selon le champ, dates entre 1900 et 2100, au moins un champ. Le design (§ 13) laissait ces valeurs au builder ; EVT-030 (bornes de la limite par appareil) a été ajoutée parce que EVT-014 n'en donnait pas (R-S25). Tâches 3 et 4.
13. **Supprimer un événement supprime ses contacts** (EVT-024, R-S13), après une confirmation qui en donne le nombre ; les garder sans événement les rendrait introuvables dans la vue par événement (LEA-001). Tâches 6, 7 et 14.
14. **Carte désactivée** (EVT-025, FRM-024, R-S14) : ses événements restent listés et modifiables (LNK-008), y compris sous un blocage du support (rien n'en est servi) ; côté public, le formulaire montre la page neutre et l'API répond `410 card_inactive`, comme la vCard. Tâches 7, 8, 9 et 17.
15. **Surface « contacts » du plan 3** (EDI-020, R-S15) : une page par événement qui liste ses contacts (date, nom, email, téléphone, étiquette Spam) avec « Marquer comme spam » / « Ce n'est pas un spam » et « Supprimer ». Le plan 4 y ajoute la recherche, la vue détaillée, la vue « toute la carte », les exports et la consultation par le support (LEA-001 à LEA-012, ADM-007, ADM-008). Tâches 10 et 15.
16. **Vouvoiement du prospect** (FRM-025, R-S16) : le tableau de bord tutoie (textes existants), le formulaire public vouvoie le prospect, qui n'est pas un utilisateur de Cartouche. Tâche 17.
17. **Formulaire commun à tous les templates** (TPL-020, R-S17) : le template ne rend que le bouton ; formulaire, code et confirmation sont un composant commun avec le thème de la carte. Le contrat des templates ne change pas (`events: PublicEvent[]`, `urls.eventForm`), et ruling R-T15 (`/c/<slug>/e/<id>`) est confirmé. Tâche 17.
18. **Point ouvert du plan 2 : médias d'une carte non servie** (MED-023, MED-024, R-S18) : la proposition du contrôleur est adoptée **avec un ajout**. En mode local, l'API répond 404 pour `/media/cards/{card_id}/…` quand la carte n'est pas servie ; mais sans plus, l'éditeur du propriétaire (LNK-008) et l'aperçu du support (ADM-013) d'une carte désactivée perdraient leurs images. Les adresses de médias des vues du tableau de bord et du support portent donc une signature HMAC valable au moins 24 h (clé aléatoire tirée au démarrage, aucune variable d'environnement), servie en `Cache-Control: private, max-age=86400`. En mode S3, les fichiers restent à leur adresse non devinable du bucket : limite connue, écrite en règle. Tâche 2.
19. **Scénario de données relatif à l'horloge** (R-S19) : un scénario reçoit l'instant présent (`state.clock.now()` par `/api/test/seed`, l'heure système par `cartouche-seed`) ; le scénario `events` place ses événements autour de cet instant, utile en local comme en e2e (où l'horloge est d'abord figée à `EVENTS_NOW = 2027-03-15T10:00:00Z`). Tâche 11.
20. **Ancien slug sur l'API publique d'un événement** (FRM-024, R-S20) : les trois routes publiques acceptent un ancien slug ou des majuscules sans redirection (un envoi en cours ne doit pas échouer parce que le propriétaire a changé de slug) ; la page web, elle, redirige vers l'adresse du slug courant (308, `no-store`). Tâches 8 et 17.
21. **État d'un événement calculé par le serveur** (EVT-020, R-S21) : `EventView.phase` (`upcoming` | `running` | `past`) ; le tableau de bord groupe selon ce champ, jamais selon l'heure du navigateur (sinon l'horloge de test serait ignorée). Tâches 7 et 14.
22. **« Terminer maintenant » seulement en cours** (EVT-021, R-S22) : `409 event_not_running` sinon ; la grâce de EVT-008 s'applique ensuite. Tâches 3 et 7.
23. **Suivis du plan 2 sans nouvelle question** (MED-021, MED-022, LNK-030, R-S23) : délai de 15 s pour lire une vidéo, liste des marques `ftyp` acceptées, `Cache-Control: no-store` sur toutes les redirections 308 publiques. Tâches 1 et 12.
24. **Nombre décimal** (FRM-036, R-S24) : l'API accepte un nombre JSON ou une chaîne avec point ou virgule ; elle stocke un nombre JSON. Tâches 4 et 16.

## Suivis du plan 2 repris ici

Les six points de `docs/superpowers/plans/2026-11-03-cartouche-plan-2-followups.md` (section « Constats reportés » et « Points ouverts ») :

1. `loadVideo` sans délai maximal → **MED-021**, tâche 12.
2. `JoinError` `.expect` dans `MediaService::run_limited` → une panique du décodeur donne `415 unsupported_media_type` (`ProcessError::Corrupt`, R-T8), jamais une 500 → tâche 1.
3. Logique de décision dans les handlers (`lookup` de `routes/public_cards.rs`, contrôle « déjà dans l'état » de `routes/admin_cards.rs`) → `cartouche_domain::public_access` et `cartouche_domain::check_support_block`, tâche 1.
4. Marque `ftyp` (MOV, 3GP, M4A, HEIC, AVIF acceptés comme MP4) → **MED-022**, tâche 1.
5. `Cache-Control` sur les redirections permanentes de la page et de la vCard → **LNK-030** ; API (vCard) tâche 1, page web tâche 12, formulaire tâche 17.
6. Point ouvert « médias d'une carte non servie » → **MED-023**, **MED-024**, tâche 2 (voir point tranché 18).

Les autres constats mineurs du plan 2 restent dans son fichier de suivis ; ceux qu'une tâche de ce plan touche de toute façon peuvent y être corrigés au passage, sans élargir la tâche.

## Global Constraints

- Code, identifiants, commentaires et commits en **anglais** ; spec, docs et textes d'interface en **français** (avec accents), tous les textes d'interface dans `frontend/web/messages/fr.json`. Seule exception : le texte de consentement par défaut, dans `backend/domain/src/consent.rs` (R-S11).
- Aucune logique métier dans les handlers ni dans les composants : `cartouche-domain` ou `frontend/web/src/lib`. Un handler lit la requête, appelle le domaine et `db/`, formate la réponse.
- Chaque fonction `db/` sur des données d'un utilisateur prend `owner_id` et le met dans le `where` (jointure `events → cards.owner_id`). Exceptions documentées en tête de fichier : `db/public_cards.rs` et `db/admin_cards.rs` (plan 2) ; dans `db/events.rs`, les fonctions `*_public` (lecture d'un événement d'une carte déjà résolue par son slug) ; dans `db/leads.rs`, `lock_device`, `count_for_device` et `insert` (écriture par un prospect anonyme, toujours pour un événement déjà résolu par `find_public`).
- L'heure vient **toujours** de `state.clock.now()` (jamais `Utc::now()` dans `server/src` hors `main.rs` et `bin/`), y compris pour la limite par IP et la date du jour d'une date de naissance (`clock.now().date_naive()`).
- Toute chaîne reçue passe par `normalize` (NFC + trim) ; vide après normalisation = absente. Longueurs comptées en caractères (`chars().count()`) après normalisation.
- Forme des erreurs : `{"error":{"code","message","request_id"}}`, plus `"fields":[{"field","code"}]` seulement pour `400 validation_failed`.
- Chemins de champ d'un événement : `title`, `description`, `starts_at`, `ends_at`, `access_code`, `device_limit`, `standard_fields`, `custom_fields`, `custom_fields[2].label`, `custom_fields[2].help`, `custom_fields[2].id`, `custom_fields[2].options`, `custom_fields[2].options[1]`, `consent_text`. D'un envoi : `answers.first_name`, `answers.last_name`, `answers.birth_date`, `answers.email`, `answers.phone`, `answers.address.street`, `answers.address.postal_code`, `answers.address.city`, `answers.address.country`, `answers.custom.<uuid du champ>`, `consent`.
- Nouveaux codes d'erreur : `too_many_simultaneous_events` 409 · `event_not_running` 409 · `event_closed` 409 · `form_changed` 409 · `device_limit_reached` 409 · `invalid_access_code` 403 · `rate_limited` 429 (avec `Retry-After`) ; `card_inactive` 410 et `not_found` 404 sont réutilisés. Nouveaux codes de champ : `end_before_start`, `out_of_range`, `no_fields`, `too_many_fields`, `duplicate_field_id`, `too_few_options`, `too_many_options`, `duplicate_option`, `invalid_date`, `invalid_number`, `invalid_choice`, `invalid_value` (réponse du mauvais type JSON) ; `required`, `too_long`, `invalid_email`, `invalid_phone` sont réutilisés.
- Limites (constantes du domaine) : titre 120, description 2 000, code 32, `device_limit` 1..=100 (défaut 1), champs personnalisés ≤ 30, libellé ≤ 100, aide ≤ 300, options 2..=20 de ≤ 100, consentement personnalisé ≤ 3 000 ; réponses : prénom, nom, ville, pays ≤ 100, email ≤ 254, rue ≤ 200, code postal ≤ 20, texte ≤ 500, texte long ≤ 5 000 ; dates `1900-01-01..=2100-12-31` ; grâce d'envoi 15 min ; 120 envois / IP / 10 min ; 30 codes faux / IP / 10 min.
- Types sérialisés en snake_case : `EventPhase` (`upcoming`, `running`, `past`), `FieldMode` (`off`, `optional`, `required`), `StandardField` (`first_name`, `last_name`, `birth_date`, `email`, `phone`, `address`), `CustomFieldKind` (`text`, `long_text`, `date`, `number`, `single_choice`, `checkbox`). Tout type du domaine exposé par l'API dérive `ToSchema` sous la feature `utoipa`.
- Variables d'environnement nouvelles : `MAX_SIMULTANEOUS_EVENTS` (défaut 3, entier ≥ 1, EVT-019) et `TRUSTED_PROXY_HOPS` (défaut 1, entier 0..=10, ABU-008), chacune documentée dans `.env.example` (sans accents, comme le reste du fichier). Aucune autre : la clé de signature des médias est tirée au démarrage.
- Routes : propriétaire avec `ApprovedUser`, tags OpenAPI `events` et `leads` ; publiques sans jeton, tag `public`. Après tout changement de route : `make openapi` et commit de `openapi.json` et `schema.d.ts` ; un changement du type généré qui casse la compilation du web est corrigé dans la même tâche.
- Après tout changement de requête ou de migration : `make sqlx-prepare` et commit de `backend/.sqlx/`. On n'édite jamais une migration déjà appliquée : ce plan ajoute `0005_events.sql`.
- Tests : `// spec: XXX-NNN` avant chaque test Rust ; identifiant dans le nom de chaque test TypeScript. Données avec accents, apostrophes typographiques et émojis (« Éloïse D’Aubigné-Müller », « Zoé Lefèvre ✨ »).
- Tests web unitaires lancés par `pnpm -C frontend --filter web exec vitest run <chemin>` (R-P3).
- E2E : l'horloge de l'API se fige **avant** de signer un jeton (`api.setClock` avant `loginAs` et avant `api.token`) : un jeton signé à l'heure réelle est expiré pour une horloge en 2027. `api.seedEvents()` le fait dans le bon ordre.
- Chaque tâche qui touche l'interface finit par `make e2e ARGS="-g <règles de la tâche>"` ; la tâche 19 lance `make lint test` et `make e2e` complets.

## Review Focus

1. **Deux personnes (ou un double clic) créent un événement au même instant sur une carte qui en a déjà 2 simultanés** → exactement une création réussit, l'autre reçoit `409 too_many_simultaneous_events`, jamais 4 événements simultanés ni une 500. Tests dans la tâche 7.
2. **Un prospect tape deux fois sur « Envoyer » (limite 1)** → un seul contact enregistré, la seconde requête reçoit `409 device_limit_reached`. Tests dans les tâches 6 et 9.
3. **Le code d'accès « Château » n'apparaît nulle part côté public** : ni dans le HTML de la page, ni dans aucune réponse de `/api/public/*`, ni dans les logs ; la description et les champs d'un événement à code ne sortent qu'après un code correct. Tests dans les tâches 8, 9 et 17.
4. **Un robot remplit tout, champ piège compris** → il reçoit exactement la réponse d'un envoi accepté (statut, corps, en-têtes), rien n'est stocké et l'appareil peut encore envoyer. Tests dans les tâches 9 et 17.
5. **Un salon de 80 prospects derrière la même IP de Wi-Fi** → aucun n'est bloqué ; un script qui envoie 121 requêtes en 10 minutes reçoit `429` avec `Retry-After` ; une adresse ajoutée à gauche de `X-Forwarded-For` par le client ne change pas l'IP retenue. Tests dans les tâches 5 et 9.
6. **Le propriétaire renomme, change de type ou supprime un champ alors que des contacts existent** → les anciens contacts gardent leurs réponses avec le libellé et le type d'origine. Tests dans la tâche 10.
7. **Une carte désactivée par le support** → ses fichiers `/media` répondent 404 au public, mais son propriétaire et le support voient toujours ses images dans le tableau de bord. Tests dans la tâche 2.
8. **Envoi à la limite de la grâce** : fin + 15 min → accepté ; fin + 15 min + 1 s → `409 event_closed`. Tests dans les tâches 3 et 9.
9. **Le texte de consentement enregistré est exactement celui affiché** : si le propriétaire change la carte (email) ou l'événement pendant la saisie, l'envoi est refusé (`form_changed`) au lieu d'enregistrer un texte que le prospect n'a pas vu. Tests dans les tâches 9 et 17.

---

## Structure des fichiers

```
backend/domain/src/
  public_access.rs     SlugMatch, PublicAccess, public_access (suivi 3)
  card_status.rs       + SupportBlockUnchanged, check_support_block (suivi 3)
  media.rs             + is_mp4_ftyp ; sniff ne reconnaît que les marques MP4 (MED-022)
  media_files.rs       + card_of_key
  event.rs             Period, EventPhase, max_simultaneous, EventInput, ValidEvent, validate_event, limites
  access_code.rs       fold_access_code, access_code_matches
  form.rs              FieldMode, StandardField, StandardFields, CustomFieldKind, CustomField, FormDefinition
  consent.rs           default_consent_text, consent_text
  lead.rs              AnswersInput, AddressInput, StandardAnswers, AnswerSnapshot, ValidLead, validate_lead, PublicForm, form_version
  rate_limit.rs        RateLimit, SlidingWindow, rate_limit_key, limites par IP
backend/server/
  migrations/0005_events.sql
  src/db/{events.rs, leads.rs}           + db/public_cards.rs::card_is_served
  src/media/signing.rs                   UrlSigner
  src/{rate_limit.rs, client_ip.rs}      RateLimiter, InMemoryRateLimiter, Bucket, ClientIp
  src/routes/{events.rs, leads.rs, public_events.rs}
  tests/{db_events.rs, events.rs, public_events.rs, leads_submit.rs, leads.rs}
  tests/common/events.rs
frontend/web/src/
  app/(app)/dashboard/cards/[id]/events/{page.tsx, new/page.tsx, [eventId]/page.tsx, [eventId]/leads/page.tsx}
  app/c/[slug]/e/[eventId]/{page.tsx, not-found.tsx}
  components/events/     EventList, EventEditor, StandardFieldsEditor, CustomFieldsEditor, ConsentEditor, EventActions, LeadList
  components/event-form/ EventFormPage, AccessCodeScreen, LeadForm, ConsentField, Honeypot, Confirmation, ClosedEvent
  lib/events/            time.ts, draft.ts, groups.ts, types.ts
  lib/event-form/        device.ts, answers.ts, persist.ts, outcome.ts
  lib/public-event.ts
frontend/e2e/
  tests/{events,leads,event-form}.spec.ts   + public-page.spec.ts étendu
```

---

### Task 1 : Suivis du plan 2 côté API — décisions dans le domaine, panique du décodeur, marques `ftyp`, cache des redirections de la vCard

**Files:**
- Create: `backend/domain/src/public_access.rs`
- Modify: `backend/domain/src/{lib.rs, card_status.rs, media.rs}`, `backend/server/src/routes/{public_cards.rs, admin_cards.rs}`, `backend/server/src/media/service.rs`, `backend/server/tests/{public_cards.rs, media.rs}`, `backend/server/tests/common/media_fixtures.rs`

**Interfaces:**
- Produces (domaine) :
  - `pub enum SlugMatch { Current { served: bool }, Old { served: bool }, Deleted }` · `pub enum PublicAccess { Serve, Redirect, Inactive }` · `pub fn public_access(found: SlugMatch, typed_as_stored: bool) -> PublicAccess` : supprimée ou non servie → `Inactive` (depuis toute adresse, R-T10) ; ancien slug → `Redirect` ; slug courant saisi autrement (majuscules) → `Redirect` ; sinon `Serve` ;
  - `pub struct SupportBlockUnchanged;` · `pub fn check_support_block(blocked_now: bool, block: bool) -> Result<(), SupportBlockUnchanged>` (ADM-015) ;
  - `pub fn is_mp4_ftyp(bytes: &[u8]) -> bool` (MED-022) : lit la boîte `ftyp` (marque principale aux octets 8..12, marques compatibles de 16 à la fin de la boîte) ; `sniff` ne renvoie `Some(MediaFormat::Mp4)` que si `is_mp4_ftyp` ; marques MP4 : `isom`, `iso2`…`iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `dash` ; marques principales exclues : `qt  `, toute marque qui commence par `3gp` ou `3g2`, `M4A `, `M4B `, `heic`, `heix`, `mif1`, `msf1`, `avif`.
- Produces (serveur) :
  - `lookup` de `routes/public_cards.rs` ne fait plus que traduire `Resolution` en `SlugMatch` (avec `is_served(card.status(), owner)`) et appeler `public_access` ; `set_support_block` appelle `check_support_block` (erreur → `ApiError::InvalidTransition`) ;
  - `MediaService::run_limited<T>(…) -> Result<T, Panicked>` (`pub struct Panicked;`) ; `process_image` transforme `Err(Panicked)` en `Err(ProcessError::Corrupt)` après `tracing::error!` → `415` (R-T8) ;
  - la réponse 308 de `get_public_vcard` porte `Cache-Control: no-store` (LNK-030).
- `media_fixtures.rs` : `mp4_with_brands(major: &[u8; 4], compatible: &[&[u8; 4]], duration_ms: u32) -> Vec<u8>` ; `mp4(duration_ms)` devient `mp4_with_brands(b"isom", &[b"isom", b"mp41"], duration_ms)`.

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: LNK-003, LNK-021, LNK-026, LNK-027 (public_access.rs, en ligne)
#[test] fn public_access_decisions() {
    /* Current{served:true}, true → Serve ; Current{served:true}, false → Redirect ; Old{served:true} → Redirect ;
       Current{served:false} / Old{served:false} (quel que soit typed_as_stored) → Inactive ; Deleted → Inactive */ }
// spec: ADM-015 (card_status.rs)
#[test] fn support_block_must_change_state() { /* (false,true) Ok ; (true,false) Ok ; (true,true) Err ; (false,false) Err */ }
// spec: MED-008, MED-022 (media.rs)
#[test] fn only_mp4_brands_are_videos() {
    /* majeure isom / mp42 / "M4V " / dash → Mp4 ; majeure inconnue "abcd" + compatible "mp41" → Mp4 ;
       majeure "qt  ", "3gp4", "3g2a", "M4A ", "heic", "avif" → None, même avec "isom" en compatible ; ftyp tronqué → None */ }
// spec: MED-022 (tests/media.rs)
#[sqlx::test] async fn quicktime_3gp_and_heic_are_refused(pool) { /* mp4_with_brands("qt  ") , ("3gp4"), ("heic") en header → 415 unsupported_media_type ; ("mp42") → 201 */ }
// spec: MED-012 (service.rs, en ligne)
#[tokio::test] async fn a_panicking_job_is_reported_not_propagated() { /* run_limited(|| panic!("decoder")) → Err(Panicked) ; un second run_limited réussit (permis rendu) */ }
// spec: LNK-024, LNK-030 (tests/public_cards.rs)
#[sqlx::test] async fn vcard_redirects_are_not_cached(pool) { /* /alice/vcard et /Alice-Durand/vcard → 308, cache-control "no-store" */ }
```

Les tests existants qui citent LNK-003, LNK-021, LNK-026, LNK-027 et ADM-015 doivent toujours passer sans changement.

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test --workspace --all-features -- public_access support_block mp4 panicking vcard_redirects quicktime` · Expected : FAIL (compilation).
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend && git commit -m "refactor(api): move public access and support block decisions to the domain; refuse non-MP4 ftyp brands; map decoder panics to 415"`

---

### Task 2 : Médias d'une carte non servie

**Files:**
- Create: `backend/server/src/media/signing.rs`
- Modify: `backend/server/Cargo.toml` (`aws-lc-rs = "1.19"`), `backend/domain/src/media_files.rs`, `backend/server/src/media/{mod.rs, service.rs}`, `backend/server/src/views.rs`, `backend/server/src/db/public_cards.rs`, `backend/server/src/routes/{cards.rs, card_media.rs, admin_cards.rs, public_cards.rs, media_files.rs}`, `backend/server/tests/media.rs`

**Interfaces:**
- Consumes : `is_served`, `state.clock`.
- Produces :
  - domaine : `pub fn card_of_key(key: &str) -> Option<Uuid>` (premier segment après `cards/`, voir `storage_key`) ;
  - `media::signing::UrlSigner` : `random() -> UrlSigner` (32 octets de `aws_lc_rs::rand::fill`) · `sign(&self, key: &str, expires_at: i64) -> String` (HMAC-SHA256 de `"{key}\n{expires_at}"`, base64url sans remplissage) · `verify(&self, key: &str, expires_at: i64, signature: &str, now: DateTime<Utc>) -> bool` (`aws_lc_rs::hmac::verify`, temps constant, et `expires_at > now`) ;
  - `MediaService` porte un `UrlSigner` (tiré dans `new`) ; `dashboard_url(&self, key: &str, now: DateTime<Utc>) -> String` : en local `"{url}?exp={e}&sig={s}"` avec `e` = début de l'heure suivant `now`, plus 24 h (adresses stables pendant une heure, donc cachables) ; en S3, identique à `url` ; `verify_signature(&self, key, exp: i64, sig: &str, now) -> bool` ;
  - `views::Audience { Public, Dashboard(DateTime<Utc>) }` ; `MediaView::new(record, media, audience)` ; `CardView::new(card, attached, config, media, now: DateTime<Utc>)` (adresses `Dashboard(now)`) ; `PublicCard::new` reste en `Public` ; l'envoi d'un média (`POST /api/cards/{id}/media`) répond avec `Dashboard(now)` ;
  - `db::public_cards::card_is_served(pool, card_id) -> Result<Option<bool>, sqlx::Error>` (`None` : carte inconnue ; jointure `users` pour le statut, `is_served`) ;
  - `GET /media/{*key}` gagne `ApiQuery<MediaQuery { exp: Option<i64>, sig: Option<String> }>` : signature valide → servi avec `Cache-Control: private, max-age=86400` ; sinon `card_of_key` → `card_is_served` → `Some(true)` servi avec l'en-tête de MED-016, autrement `404 not_found`. La décision « signée ou servie » est une fonction du domaine : `pub fn media_access(signed: bool, served: Option<bool>) -> Option<MediaCache>` avec `pub enum MediaCache { Immutable, Private }` (dans `media_files.rs`).

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: MED-023 (media_files.rs, en ligne)
#[test] fn media_access_decisions() { /* signée → Private (même non servie) ; non signée servie → Immutable ; non servie / inconnue → None */ }
#[test] fn card_id_is_read_from_the_key() { /* storage_key(c, m, "s128.webp") → Some(c) ; "cards/x/…" → None */ }
// spec: MED-023 (signing.rs, en ligne)
#[test] fn signature_round_trip() { /* verify(sign) vrai ; autre clé de média, autre exp, signature altérée, exp ≤ now → faux */ }
// spec: MED-023, LNK-026, LNK-027 (tests/media.rs)
#[sqlx::test] async fn media_of_an_unserved_card_is_404_without_signature(pool) {
    /* avatar envoyé et enregistré ; adresse lue dans GET /api/public/cards/{slug} → 200 ;
       désactivée par le propriétaire → même adresse 404 ; réactivée → 200 ; bloquée par le support → 404 ; propriétaire suspendu → 404 */ }
// spec: MED-023, LNK-008, ADM-013
#[sqlx::test] async fn dashboard_and_support_urls_stay_readable(pool) {
    /* carte désactivée : GET /api/cards/{id} → avatar.images[0].url porte exp et sig → 200, cache-control "private, max-age=86400" ;
       GET /api/admin/cards/{id} → idem ; Range bytes=0-1 sur l'adresse signée → 206 */ }
#[sqlx::test] async fn forged_or_expired_signatures_are_ignored(pool) { /* sig modifiée → 404 (carte désactivée) ; clock.advance(25 h) → 404 */ }
// spec: MED-024, MED-011
#[sqlx::test] async fn s3_urls_are_never_signed(pool) { /* MediaService::in_memory_remote → CardView sans "?" dans les adresses */ }
```

Les tests du plan 2 qui comparent des adresses de médias sont adaptés seulement là où ils comparent une adresse du tableau de bord à une adresse publique (la requête signée diffère) ; ceux qui citent MED-010, MED-016 et MED-017 doivent toujours passer.

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test --workspace --all-features media` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare` ; `make openapi` (les schémas ne changent pas : vérifier qu'`openapi.json` reste identique).
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend && git commit -m "feat(api): stop serving media of unserved cards, with signed dashboard URLs"`

---

### Task 3 : Domaine — périodes, chevauchement, code d'accès, définition des champs

**Files:**
- Create: `backend/domain/src/{event.rs, access_code.rs, form.rs}`
- Modify: `backend/domain/src/lib.rs`

**Interfaces:**
- Consumes : `FieldError`, `normalize`, `Uuid`.
- Produces :
  - `event.rs` :
    - `pub const MAX_EVENT_TITLE_CHARS: usize = 120; MAX_EVENT_DESCRIPTION_CHARS: usize = 2_000; MAX_ACCESS_CODE_CHARS: usize = 32; MIN_DEVICE_LIMIT: u32 = 1; MAX_DEVICE_LIMIT: u32 = 100; DEFAULT_DEVICE_LIMIT: u32 = 1;` · `pub fn submission_grace() -> TimeDelta` (15 minutes) ;
    - `pub struct Period { pub starts_at: DateTime<Utc>, pub ends_at: Option<DateTime<Utc>> }` avec `phase(&self, now) -> EventPhase` (EVT-020), `is_running(&self, now) -> bool` (EVT-002 : `starts_at <= now && ends_at.is_none_or(|e| now < e)`), `accepts_submissions(&self, now) -> bool` (EVT-008, EVT-026 : `starts_at <= now && ends_at.is_none_or(|e| now <= e + grace)`), `end_now(&self, now) -> Result<Period, EventNotRunning>` (EVT-006, EVT-021) ;
    - `pub enum EventPhase { Upcoming, Running, Past }` (serde snake_case, `ToSchema`) · `pub struct EventNotRunning;` ;
    - `pub fn max_simultaneous(candidate: &Period, others: &[Period]) -> usize` : nombre maximal d'événements en cours au même instant pendant `candidate`, `candidate` compris ; périodes demi-ouvertes `[début, fin)`, fin absente = infini (EVT-005) ; balayage des bornes ;
    - `#[derive(Deserialize, ToSchema)] pub struct EventInput { pub title: String, pub description: Option<String>, pub starts_at: DateTime<Utc>, pub ends_at: Option<DateTime<Utc>>, pub access_code: Option<String>, pub device_limit: u32, pub standard_fields: StandardFields, pub custom_fields: Vec<CustomField>, pub consent_text: Option<String> }` (c'est aussi le corps des routes, comme `ContentInput`, R-T6) ;
    - `pub struct ValidEvent { pub title: String, pub description: Option<String>, pub period: Period, pub access_code: Option<String>, pub device_limit: u32, pub form: FormDefinition, pub consent_text: Option<String> }` ;
    - `pub fn validate_event(input: EventInput) -> Result<ValidEvent, Vec<FieldError>>` : renvoie **toutes** les erreurs (EVT-016, EVT-017, EVT-030, FRM-028, FRM-031, FRM-032) ;
  - `access_code.rs` : `pub fn fold_access_code(input: &str) -> String` (NFD, marques combinantes retirées comme `suggest_base`, minuscules Unicode, trim) · `pub fn access_code_matches(stored: &str, typed: &str) -> bool` (EVT-011) ;
  - `form.rs` :
    - `pub enum FieldMode { Off, Optional, Required }` · `pub enum StandardField { FirstName, LastName, BirthDate, Email, Phone, Address }` · `pub enum CustomFieldKind { Text, LongText, Date, Number, SingleChoice, Checkbox }` (serde snake_case, `ToSchema`) ;
    - `#[serde(deny_unknown_fields)] pub struct StandardFields { pub first_name: FieldMode, pub last_name: FieldMode, pub birth_date: FieldMode, pub email: FieldMode, pub phone: FieldMode, pub address: FieldMode }` avec `enabled(&self) -> Vec<(StandardField, bool /* required */)>` dans l'ordre de FRM-017 ;
    - `pub struct CustomField { pub id: Uuid, pub label: String, pub kind: CustomFieldKind, pub required: bool, pub help: Option<String>, pub options: Vec<String> }` (`Serialize`, `Deserialize`, `ToSchema`) ;
    - `pub struct FormDefinition { pub standard: StandardFields, pub custom: Vec<CustomField> }` (`Serialize`, `Deserialize`) ;
    - `pub const MAX_CUSTOM_FIELDS: usize = 30; MAX_FIELD_LABEL_CHARS: usize = 100; MAX_FIELD_HELP_CHARS: usize = 300; MIN_CHOICE_OPTIONS: usize = 2; MAX_CHOICE_OPTIONS: usize = 20; MAX_OPTION_CHARS: usize = 100;` ; la validation normalise libellés, aides et options (NFC, FRM-016), vide les options d'un champ qui n'est pas `single_choice`, et compare les doublons d'options après normalisation.

- [ ] **Step 1 : Écrire les tests** (en ligne)

```rust
// spec: EVT-002, EVT-003, EVT-020
#[test] fn phases_follow_the_clock() { /* début == now → Running ; fin == now → Past ; sans fin → Running à +100 ans ; début futur → Upcoming */ }
// spec: EVT-008, EVT-026, Review Focus 8
#[test] fn submissions_are_accepted_up_to_15_minutes_after_the_end() { /* fin + 15 min → true ; + 15 min 1 s → false ; avant début → false ; sans fin → true */ }
// spec: EVT-006, EVT-021
#[test] fn end_now_only_while_running() { /* en cours → ends_at = now ; à venir → Err ; passé → Err */ }
// spec: EVT-004, EVT-005
#[test] fn max_simultaneous_is_the_peak_over_the_whole_period() {
    /* aucune autre → 1 ; [8h,10h) et [10h,12h) → 1 (bornes qui se touchent) ;
       candidat [8h,18h), autres [9h,10h) et [11h,12h) → 2 (jamais ensemble) ; autres [9h,12h) et [10h,11h) → 3 ;
       candidat sans fin, autre dans 3 ans → 2 ; candidat passé contre un événement futur → 1 */ }
// spec: EVT-001, EVT-016, EVT-017, EVT-030
#[test] fn event_input_is_validated_and_normalized() {
    /* titre "  Salon E\u{301}té " → "Salon Été" ; titre "  " → title required ; 121 caractères → title too_long ;
       description 2 001 → too_long ; code de 33 → access_code too_long ; code "  " → None ;
       ends_at == starts_at → ends_at end_before_start ; device_limit 0 et 101 → device_limit out_of_range ;
       titre vide + fin avant début + limite 0 → 3 erreurs ensemble */ }
// spec: EVT-011
#[test] fn access_code_ignores_case_spaces_and_accents() {
    /* ("Château", "  chateau ") → vrai ; ("Château", "CHÂTEAU") → vrai ; ("Œuf", "œuf") → vrai ; ("Château", "chateaux") → faux ; ("Châ teau", "chateau") → faux */ }
// spec: FRM-017, FRM-019
#[test] fn standard_fields_keep_the_fixed_order() { /* address Required, first_name Optional, email Off → [(FirstName,false), (Address,true)] */ }
// spec: FRM-020, FRM-021, FRM-031, FRM-032
#[test] fn custom_fields_are_validated() {
    /* 31 champs → custom_fields too_many_fields ; libellé "" → custom_fields[0].label required ; 101 → too_long ; aide 301 → custom_fields[0].help too_long ;
       même id deux fois → custom_fields[1].id duplicate_field_id ; single_choice à 1 option → custom_fields[0].options too_few_options ; 21 → too_many_options ;
       option "" → custom_fields[0].options[1] required ; "Prestige" et "Prestige " → custom_fields[0].options[1] duplicate_option ;
       text avec options → options vidées ; tous les standards Off et aucun personnalisé → standard_fields no_fields */ }
// spec: FRM-016
#[test] fn field_texts_are_stored_in_nfc() { /* libellé "Date du marie\u{301}" → "Date du marié" */ }
// spec: FRM-028
#[test] fn custom_consent_text_is_limited() { /* 3 001 caractères → consent_text too_long ; "   " → None */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-domain` · Expected : FAIL (compilation).
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend/domain && git commit -m "feat(domain): event periods, overlap, access code and form definition rules"`

---

### Task 4 : Domaine — consentement, réponses du prospect, version du formulaire

**Files:**
- Create: `backend/domain/src/{consent.rs, lead.rs}`
- Modify: `backend/domain/src/lib.rs`

**Interfaces:**
- Consumes : `CardContent`, `FormDefinition`, `StandardFields`, `CustomField`, `normalize`, `is_valid_email`, `normalize_phone`.
- Produces :
  - `consent.rs` : `pub const MAX_CONSENT_TEXT_CHARS: usize = 3_000;` · `pub fn default_consent_text(card: &CardContent, event_title: &str) -> String` (FRM-026, FRM-027 ; guillemets « » entourés d'espaces insécables U+00A0) · `pub fn consent_text(custom: Option<&str>, card: &CardContent, event_title: &str) -> String` (le texte personnalisé l'emporte, FRM-007, FRM-028) ;
  - `lead.rs` :
    - `#[derive(Deserialize, Default, ToSchema)] pub struct AddressInput { pub street: Option<String>, pub postal_code: Option<String>, pub city: Option<String>, pub country: Option<String> }` ;
    - `#[derive(Deserialize, Default, ToSchema)] pub struct AnswersInput { pub first_name: Option<String>, pub last_name: Option<String>, pub birth_date: Option<String>, pub email: Option<String>, pub phone: Option<String>, pub address: Option<AddressInput>, #[serde(default)] pub custom: BTreeMap<Uuid, serde_json::Value> }` ;
    - `pub struct StandardAnswers { pub first_name, pub last_name: Option<String>, pub birth_date: Option<NaiveDate>, pub email: Option<String>, pub phone: Option<String> /* E.164 */, pub street, pub postal_code, pub city, pub country: Option<String> }` (`Serialize`, `Deserialize`, `ToSchema`) ;
    - `pub struct AnswerSnapshot { pub field_id: Uuid, pub label: String, pub kind: CustomFieldKind, pub value: serde_json::Value }` (`Serialize`, `Deserialize`, `ToSchema`) : `value` est une chaîne (`text`, `long_text`, `single_choice`, `date` en `AAAA-MM-JJ`), un nombre (`number`), un booléen (`checkbox`, `false` si non coché) ou `null` (non renseigné) ;
    - `pub struct ValidLead { pub standard: StandardAnswers, pub custom: Vec<AnswerSnapshot> }` ;
    - `pub fn validate_lead(form: &FormDefinition, answers: AnswersInput, consent: bool, today: NaiveDate) -> Result<ValidLead, Vec<FieldError>>` : toutes les erreurs ensemble (FRM-012 à FRM-016, FRM-033 à FRM-037) ; réponses aux champs standards `Off` et aux identifiants inconnus ignorées ; un instantané par champ personnalisé de la définition, dans son ordre (FRM-022, FRM-038) ; `consent == false` → `consent: required` ;
    - `pub struct PublicForm<'a> { pub title: &'a str, pub description: Option<&'a str>, pub standard: &'a StandardFields, pub custom: &'a [CustomField], pub consent_text: &'a str }` (`Serialize`) · `pub fn form_version(form: &PublicForm) -> String` : FNV-1a 64 bits de `serde_json::to_vec(form)`, 16 chiffres hexadécimaux en minuscules (FRM-030).

- [ ] **Step 1 : Écrire les tests** (en ligne)

```rust
// spec: FRM-007, FRM-009, FRM-010, FRM-026, FRM-027
#[test] fn default_text_names_the_card_owner() {
    /* Alice Durand, « Atelier Durand & Fils », alice@example.test, « Salon du Mariage Clermont 2027 » →
       "En cochant cette case, j'accepte que Alice Durand (Atelier Durand & Fils) conserve les informations saisies dans ce formulaire afin de me recontacter à des fins commerciales en lien avec l'événement «\u{a0}Salon du Mariage Clermont 2027\u{a0}». Alice Durand (Atelier Durand & Fils) est responsable de ce traitement. Je peux à tout moment demander l'accès à mes données, leur rectification ou leur suppression en écrivant à alice@example.test." (égalité exacte) */ }
#[test] fn default_text_without_company_or_email() { /* seulement le prénom « Éloïse », sans email → "… que Éloïse conserve …" et "… leur suppression auprès de Éloïse." */ }
// spec: FRM-011
#[test] fn default_text_commits_to_no_retention_period() { /* avec un titre sans chiffre : aucun chiffre, ni « pendant », ni « durée », ni « jours », ni « mois », ni « an » isolé */ }
// spec: FRM-007, FRM-028
#[test] fn custom_text_wins() { /* Some("Vos coordonnées restent chez nous.") → tel quel ; None → texte par défaut */ }
// spec: FRM-012, FRM-013, FRM-016, FRM-034
#[test] fn standard_answers_are_validated_and_normalized() {
    /* email "éloïse@" → answers.email invalid_email ; téléphone "06 12 34 56 78" → "+33612345678" ; "12" → answers.phone invalid_phone ;
       prénom "E\u{301}loi\u{308}se" → "Éloïse" ; prénom de 101 → too_long ; email de 255 → too_long ; prénom Required vide → required ;
       nom fourni alors que last_name est Off → ignoré (None) */ }
// spec: FRM-014, FRM-035
#[test] fn dates_are_checked() { /* "1990-02-30", "30/01/1990", "1899-12-31" → invalid_date ; naissance demain (today) → invalid_date ; champ date "2100-12-31" → OK, "2101-01-01" → invalid_date */ }
// spec: FRM-018, FRM-033
#[test] fn a_required_address_needs_every_part() { /* rue + ville sans code postal ni pays → answers.address.postal_code et answers.address.country required */ }
// spec: FRM-021, FRM-036
#[test] fn custom_answers_follow_their_type() {
    /* number 12.5 et "12,5" → 12.5 ; "abc" → answers.custom.<id> invalid_number ; single_choice "Luxe" (hors options) → invalid_choice ;
       checkbox obligatoire false → required ; text reçu en nombre → invalid_value ; long_text de 5 001 → too_long ; id inconnu → ignoré */ }
// spec: FRM-022, FRM-038
#[test] fn every_custom_field_gets_a_snapshot() { /* 3 champs dont 1 répondu → 3 instantanés dans l'ordre, libellé et type copiés, value null pour les 2 autres (false pour une case) */ }
// spec: FRM-006, FRM-037
#[test] fn consent_is_required() { /* consent false → [consent: required], avec les autres erreurs */ }
// spec: FRM-030
#[test] fn form_version_changes_with_anything_shown() { /* même formulaire → même version ; titre, description, libellé, obligatoire, option, texte de consentement modifié → version différente ; 16 caractères hexadécimaux */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-domain -- consent lead` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — `cd backend && cargo test -p cartouche-domain` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend/domain && git commit -m "feat(domain): default consent text, lead answer validation and form version"`

---

### Task 5 : Anti-abus — limite par IP et adresse du client

**Files:**
- Create: `backend/domain/src/rate_limit.rs`, `backend/server/src/{rate_limit.rs, client_ip.rs}`
- Modify: `backend/domain/src/lib.rs`, `backend/server/src/{lib.rs, state.rs, config.rs, error.rs, main.rs}`, `backend/server/tests/common/mod.rs`, `.env.example`

**Interfaces:**
- Produces (domaine) : `pub struct RateLimit { pub max: usize, pub window: TimeDelta }` · `pub fn lead_submissions_per_ip() -> RateLimit` (120 / 10 min, ABU-006) · `pub fn failed_access_codes_per_ip() -> RateLimit` (30 / 10 min, ABU-007) · `#[derive(Default)] pub struct SlidingWindow` avec `check(&mut self, now, limit: &RateLimit) -> Result<(), TimeDelta /* attente */>` (retire les entrées plus vieilles que `now - window` ; plein → `Err(plus ancienne + window - now)`), `record(&mut self, now)`, `is_idle(&mut self, now, limit) -> bool` · `pub fn rate_limit_key(ip: IpAddr) -> IpAddr` (IPv6 → préfixe /64, IPv4 inchangée, ABU-008).
- Produces (serveur) :
  - `client_ip::client_ip(forwarded_for: Option<&str>, peer: Option<IpAddr>, trusted_hops: usize) -> Option<IpAddr>` (ABU-008 : n-ième entrée en partant de la droite ; entrée illisible ou trop peu d'entrées → `peer`) ; extracteur `pub struct ClientIp(pub IpAddr)` (`FromRequestParts<AppState>`) : toutes les lignes `x-forwarded-for` jointes par `,`, `ConnectInfo<SocketAddr>` s'il est présent, `config.trusted_proxy_hops` ; à défaut `Ipv4Addr::UNSPECIFIED` ;
  - `rate_limit::Bucket { LeadSubmission, FailedAccessCode }` avec `limit(self) -> RateLimit` · `pub struct RetryAfter(pub u64 /* secondes, au moins 1, arrondi au-dessus */)` · `pub trait RateLimiter: Send + Sync { fn check(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter>; fn record(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>); }` · `pub struct InMemoryRateLimiter` (`Mutex<HashMap<(Bucket, IpAddr), SlidingWindow>>`, clé passée par `rate_limit_key`, purge des fenêtres inactives toutes les 1 024 requêtes) ;
  - `AppState::rate_limiter: Arc<dyn RateLimiter>` ; `main.rs` sert avec `into_make_service_with_connect_info::<SocketAddr>()` ;
  - `Config::trusted_proxy_hops: usize` (`TRUSTED_PROXY_HOPS`, défaut 1, 0..=10, sinon `ConfigError::Invalid`) ;
  - `ApiError::RateLimited { retry_after_secs: u64 }` → `429 rate_limited` avec l'en-tête `Retry-After` ;
  - `tests/common/mod.rs` : l'état de test porte un `InMemoryRateLimiter::default()` ; `TestApp::request_from(ip: &str, method, path, token, body)` ajoute `x-forwarded-for: <ip>`.
- `.env.example` : `TRUSTED_PROXY_HOPS` commenté (« Nombre de reverse proxies de confiance devant l'API … 1 derrière Caddy, 0 si l'API est exposée directement »).

- [ ] **Step 1 : Écrire les tests**

```rust
// spec: ABU-006 (domaine, en ligne)
#[test] fn window_admits_up_to_max_then_says_when_to_retry() { /* 120 check+record à t → Ok ; 121e → Err(10 min) ; à t + 10 min → Ok */ }
#[test] fn window_slides() { /* 60 à t, 60 à t+5 min ; à t+10 min → 60 libérées : 60 de plus passent, puis refus avec attente 5 min */ }
// spec: ABU-008
#[test] fn ipv6_counts_for_its_64_prefix() { /* 2001:db8::1 et 2001:db8::ffff:1 → même clé ; 2001:db8:0:1::1 → autre ; 203.0.113.7 inchangée */ }
// spec: ABU-008 (client_ip.rs, en ligne)
#[test] fn client_ip_from_forwarded_for() {
    /* hops 1 : "203.0.113.7" → 203.0.113.7 ; "198.51.100.1, 203.0.113.7" → 203.0.113.7 (l'entrée ajoutée par le client est ignorée) ;
       hops 2 → 198.51.100.1 ; hops 0 → peer ; "n'importe quoi" → peer ; absent → peer ; hops 3 avec 2 entrées → peer */ }
// spec: ABU-006, ABU-007 (rate_limit.rs, en ligne)
#[test] fn buckets_and_addresses_are_counted_apart() { /* LeadSubmission plein pour une IP : FailedAccessCode de la même IP et LeadSubmission d'une autre IP passent */ }
#[test] fn idle_windows_are_purged() { /* 2 000 IP, horloge + 11 min, 1 024 appels → la table ne garde que les fenêtres actives */ }
// spec: ABU-008 (config.rs)
#[test] fn trusted_proxy_hops_configuration() { /* absent → 1 ; "0" → 0 ; "x" et "11" → Invalid */ }
// spec: ABU-006 (error.rs)
#[tokio::test] async fn rate_limited_is_429_with_retry_after() { /* RateLimited{retry_after_secs: 42} → 429, code "rate_limited", retry-after "42" */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test --workspace --all-features -- rate client_ip trusted_proxy` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend .env.example && git commit -m "feat(api): per-IP sliding-window rate limiter and trusted client address"`

---

### Task 6 : Schéma et `db/` des événements et des contacts

**Files:**
- Create: `backend/server/migrations/0005_events.sql`, `backend/server/src/db/{events.rs, leads.rs}`, `backend/server/tests/db_events.rs`
- Modify: `backend/server/src/db/mod.rs`, `backend/server/src/test_support/seed.rs` (`RESET_TABLES = ["audit_log", "leads", "events", "media", "card_slugs", "cards", "users"]`)

**Interfaces:**
- Consumes : `ValidEvent`, `Period`, `FormDefinition`, `ValidLead`, `StandardAnswers`, `AnswerSnapshot`.
- Migration :
  - `events(id uuid primary key, card_id uuid not null references cards(id) on delete cascade, title text not null, description text, starts_at timestamptz not null, ends_at timestamptz, access_code text, device_limit integer not null check (device_limit between 1 and 100), standard_fields jsonb not null, custom_fields jsonb not null default '[]', consent_text text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at is null or ends_at >= starts_at))` (`>=` : « Terminer maintenant » à l'instant du début), index `(card_id, starts_at)` ;
  - `leads(id uuid primary key, event_id uuid not null references events(id) on delete cascade, device_id uuid not null, submitted_at timestamptz not null, first_name text, last_name text, birth_date date, email text, phone text, street text, postal_code text, city text, country text, custom_answers jsonb not null default '[]', consent_at timestamptz not null, consent_text text not null, spam_at timestamptz, created_at timestamptz not null default now())`, index `(event_id, submitted_at desc)` et `(event_id, device_id)`.
- Produces :
  - `db::events::Event { id, card_id, title, description: Option<String>, period: Period, access_code: Option<String>, device_limit: u32, form: FormDefinition, consent_text: Option<String>, created_at, updated_at }` · `EventWithCount { event: Event, lead_count: i64 }` ;
  - propriétaire : `list_for_card(pool, owner_id, card_id) -> Vec<EventWithCount>` (tri `starts_at`, `id`) · `find_for_owner(pool, owner_id, event_id) -> Option<EventWithCount>` · `lock_card_of_event(tx, owner_id, event_id) -> Option<Uuid>` (`select c.id … for update of c` : même verrou que `cards::lock_for_owner`, pris en premier pour éviter un interblocage) · `periods_of_card(tx, owner_id, card_id, except: Option<Uuid>) -> Vec<Period>` · `insert(tx, owner_id, card_id, id, &ValidEvent) -> Option<Event>` (`insert … select … from cards where id = $card and owner_id = $owner`) · `update(tx, owner_id, event_id, &ValidEvent) -> Option<Event>` · `set_end(tx, owner_id, event_id, ends_at) -> Option<Event>` · `delete_for_owner(pool, owner_id, event_id) -> bool` ;
  - public (exception documentée) : `find_public(pool, card_id, event_id) -> Option<Event>` · `running_public(pool, card_id, now) -> Vec<(Uuid, String, DateTime<Utc>)>` (en cours selon EVT-002, tri `starts_at`, `title`, `id`, PUB-029) ;
  - `db::leads::Lead { id, event_id, device_id, submitted_at, standard: StandardAnswers, custom: Vec<AnswerSnapshot>, consent_at, consent_text, spam_at: Option<DateTime<Utc>> }` · `NewLead<'a> { id, event_id, device_id, submitted_at, lead: &'a ValidLead, consent_text: &'a str }` ;
  - public : `lock_device(tx, event_id, device_id)` (`pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`) · `count_for_device(tx, event_id, device_id) -> i64` · `insert(tx, &NewLead)` ;
  - propriétaire : `list_for_event(pool, owner_id, event_id) -> Option<Vec<Lead>>` (`None` si l'événement n'est pas au propriétaire ; tri `submitted_at desc`, `id desc`) · `set_spam(pool, owner_id, lead_id, at: Option<DateTime<Utc>>) -> Option<Lead>` · `delete_for_owner(pool, owner_id, lead_id) -> bool`.

- [ ] **Step 1 : Écrire les tests d'intégration** (`tests/db_events.rs`)

```rust
// spec: ACC-017
#[sqlx::test(migrations = "./migrations")] async fn events_are_owner_scoped(pool) { /* événement d'Alice : find_for_owner(bob) None ; update/set_end/delete par bob None/false, ligne intacte ; list_for_card(bob, carte d'Alice) vide ; insert par bob sur la carte d'Alice → None */ }
// spec: EVT-009, EVT-024
#[sqlx::test] async fn deleting_an_event_deletes_its_leads(pool) { ... }
// spec: LNK-012, MED-019
#[sqlx::test] async fn deleting_a_card_deletes_its_events_and_leads(pool) { ... }
// spec: FRM-022, FRM-038, FRM-016
#[sqlx::test] async fn lead_round_trip_keeps_snapshots(pool) { /* « Éloïse D’Aubigné-Müller », « Zoé ✨ », instantanés date/nombre/choix/case → relus à l'identique, consent_text exact, birth_date */ }
// spec: EVT-029, Review Focus 2
#[sqlx::test] async fn device_lock_serializes_submissions(pool) { /* tx1 lock_device + insert (non validée) ; tx2 lock_device attend ; commit tx1 → tx2 count_for_device == 1 */ }
// spec: ABU-003, ABU-004, ACC-017
#[sqlx::test] async fn spam_and_delete_are_owner_scoped(pool) { /* bob set_spam / delete d'un contact d'Alice → None / false */ }
// spec: PUB-029
#[sqlx::test] async fn running_public_lists_running_events_by_start_then_title(pool) { /* deux au même début (« B », « A ») + un plus tôt + un futur + un terminé → [plus tôt, A, B] */ }
#[sqlx::test] async fn reset_empties_event_tables(pool) { /* test-support : reset → 0 ligne dans events et leads */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test db_events` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** la migration et les fonctions ; `make sqlx-prepare`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make sqlx-check` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend && git commit -m "feat(api): events and leads tables with owner-scoped queries"`

---

### Task 7 : Routes propriétaire des événements

**Files:**
- Create: `backend/server/src/routes/events.rs`, `backend/server/tests/events.rs`, `backend/server/tests/common/events.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, error.rs, config.rs, views.rs, routes/mod.rs}`, `backend/server/tests/common/mod.rs`, `.env.example`

**Interfaces:**
- Consumes : `ApprovedUser`, `validate_event`, `max_simultaneous`, `Period::end_now`, `consent_text`, `cards::lock_for_owner`, `cards::find_for_owner`, `db::events`.
- Produces :
  - `ApiError::TooManySimultaneousEvents` (409 `too_many_simultaneous_events`) · `ApiError::EventNotRunning` (409 `event_not_running`) ;
  - `Config::max_simultaneous_events: usize` (`MAX_SIMULTANEOUS_EVENTS`, défaut 3, entier ≥ 1, sinon `ConfigError::Invalid`, EVT-019) ;
  - `views::EventView { id, card_id, title, description: Option<String>, starts_at, ends_at: Option<DateTime<Utc>>, phase: EventPhase, access_code: Option<String>, device_limit: u32, standard_fields: StandardFields, custom_fields: Vec<CustomField>, consent_text: Option<String> /* personnalisé */, default_consent_text: String /* FRM-029 */, lead_count: i64, created_at, updated_at }` (phase calculée avec `state.clock`) ;
  - `GET /api/cards/{id}/events` → `EventList { events: Vec<EventView> }` (tri par début) ;
  - `POST /api/cards/{id}/events` corps `EventInput` → `201 EventView`. Une transaction : `cards::lock_for_owner` (404) → `validate_event` (400, toutes les erreurs) → `periods_of_card(…, None)` → `max_simultaneous > config.max_simultaneous_events` → 409 → `insert` (id UUID v7) ;
  - `GET /api/events/{id}` → `EventView` ;
  - `PUT /api/events/{id}` corps `EventInput` → `EventView` : `lock_card_of_event` (404) → validation → `periods_of_card(…, Some(id))` → contrôle → `update` ;
  - `POST /api/events/{id}/end` → `EventView` : `lock_card_of_event` → `Period::end_now(now)` (409 `event_not_running`) → `set_end` ;
  - `DELETE /api/events/{id}` → `204` (EVT-024) ;
  - `tests/common/events.rs` : `event_body(starts_at, ends_at) -> Value` (titre « Salon du Mariage Clermont 2027 », prénom/nom/email obligatoires, téléphone facultatif, un champ `single_choice` « Formule »), `create_event(app, sub, card_id, body) -> Value`, `put_event(app, sub, id, patch) -> TestResponse`.
- `.env.example` : `MAX_SIMULTANEOUS_EVENTS` commenté (« Nombre maximal d'evenements simultanes par carte, 3 par defaut »).

- [ ] **Step 1 : Écrire les tests** (`tests/events.rs`)

```rust
// spec: EVT-001, EVT-009, EDI-009
#[sqlx::test] async fn owner_creates_reads_updates_and_deletes_an_event(pool) { /* POST → 201 ; GET liste ; PUT titre ; DELETE → 204 ; GET → 404 */ }
// spec: EVT-007, EVT-022
#[sqlx::test] async fn dates_are_exchanged_in_utc(pool) { /* starts_at "2026-01-15T13:00:00+01:00" → GET "2026-01-15T12:00:00Z" */ }
// spec: EVT-020, EDI-018
#[sqlx::test] async fn phase_follows_the_server_clock(pool) { /* à venir → clock.advance → running → past ; lead_count 0 */ }
// spec: EVT-004, EVT-005, EVT-018
#[sqlx::test] async fn a_fourth_simultaneous_event_is_refused(pool) {
    /* 3 événements sans fin → 4e : 409 too_many_simultaneous_events, toujours 3 ; un 4e qui commence après la fin de l'un → 201 ;
       PUT qui déplace un événement dans le chevauchement → 409, inchangé */ }
// spec: EVT-018, Review Focus 1
#[sqlx::test] async fn concurrent_creations_cannot_exceed_the_limit(pool) { /* 6 POST simultanés (join_all), même carte, sans fin → exactement 3×201 et 3×409, aucun 500, 3 en base */ }
// spec: EVT-019
#[sqlx::test] async fn the_limit_comes_from_the_configuration(pool) { /* MAX_SIMULTANEOUS_EVENTS=1 → 2e 409 */ }
#[test] fn max_simultaneous_events_configuration() { /* absent → 3 ; "0" et "x" → Invalid (config.rs, en ligne) */ }
// spec: EVT-006, EVT-021, EVT-008
#[sqlx::test] async fn end_now(pool) { /* en cours → ends_at == clock.now(), phase past ; à venir → 409 event_not_running ; passé → 409 */ }
// spec: EVT-010
#[sqlx::test] async fn the_owner_sees_the_access_code(pool) { /* code "Château" → access_code "Château" à GET et dans la liste */ }
// spec: EVT-016, EVT-017, EVT-030, FRM-031, FRM-032
#[sqlx::test] async fn invalid_events_list_field_errors(pool) { /* titre vide + fin avant début + 2 options identiques → 400 avec les 3 chemins */ }
// spec: FRM-029, FRM-026
#[sqlx::test] async fn the_view_carries_the_default_consent_text(pool) { /* default_consent_text contient « Alice Durand » et l'email de la carte ; consent_text null */ }
// spec: EVT-025, LNK-008
#[sqlx::test] async fn events_of_a_disabled_card_stay_editable(pool) { /* carte désactivée, puis bloquée par le support → GET, PUT, POST event : 2xx */ }
// spec: ACC-017
#[sqlx::test] async fn other_users_events_are_404(pool) { /* bob : GET/PUT/DELETE/end événement d'Alice et POST sur sa carte → 404 ; sa liste ne le montre pas */ }
// spec: EDI-014
#[sqlx::test] async fn duplicating_a_card_copies_no_event(pool) { /* carte avec 2 événements → duplicate → GET /api/cards/{copie}/events vide */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test events` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** avec `#[utoipa::path]` complets (skill `change-api`), tag `events` ; `make sqlx-prepare` puis `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client .env.example && git commit -m "feat(api): owner event CRUD with race-free simultaneous-event limit"`

---

### Task 8 : API publique — boutons d'événement, formulaire et code d'accès

**Files:**
- Create: `backend/server/src/routes/public_events.rs`, `backend/server/tests/public_events.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, error.rs, views.rs, routes/public_cards.rs, routes/mod.rs}`, `frontend/web/src/lib/cards/draft.ts` et `frontend/web/src/templates/fixtures.ts` (seulement `events: []` dans les `PublicCard` construites, pour que le type généré compile)

**Interfaces:**
- Consumes : `public_access`, `db::events::{find_public, running_public}`, `Period::accepts_submissions`, `access_code_matches`, `consent_text`, `form_version`, `ClientIp`, `RateLimiter`.
- Produces :
  - `ApiError::EventClosed` (409 `event_closed`) · `ApiError::InvalidAccessCode` (403 `invalid_access_code`) ;
  - `views::PublicEventButton { id: Uuid, title: String, starts_at: DateTime<Utc> }` ; `PublicCard` gagne `events: Vec<PublicEventButton>` (PUB-008, PUB-009, PUB-029), lus par `running_public` avec `state.clock.now()` ;
  - `routes::public_cards::serve_card(state, slug) -> Result<Card, ApiError>` (`pub(crate)`) : comme `lookup`, mais `Redirect` vaut `Serve` (R-S20) ; `Inactive` → `CardInactive` ; inconnu → `NotFound` ;
  - `views::PublicEventHeading { id, title }` · `views::PublicStandardField { field: StandardField, required: bool }` · `views::PublicEventForm { id, title, description: Option<String>, standard_fields: Vec<PublicStandardField>, custom_fields: Vec<CustomField>, consent_text: String, form_version: String }` (construit par une fonction du domaine ou de `views`, jamais dans le handler) ;
  - `GET /api/public/cards/{slug}/events/{event_id}` → `PublicEventResponse`, `#[serde(tag = "state", rename_all = "snake_case")]` : `Open { event: PublicEventForm }` | `CodeRequired { event: PublicEventHeading }` | `Closed { event: PublicEventHeading }` ; erreurs 404 (slug inconnu, événement inconnu ou d'une autre carte), 410 `card_inactive` ;
  - `POST /api/public/cards/{slug}/events/{event_id}/unlock` corps `UnlockBody { access_code: String }` → `200 PublicEventForm`. Ordre : `ClientIp` + `check(FailedAccessCode)` (429) → `serve_card` (404/410) → `find_public` (404) → `accepts_submissions` (409 `event_closed`) → pas de code sur l'événement : le formulaire ; code faux : `record(FailedAccessCode)` puis 403 `invalid_access_code`.

- [ ] **Step 1 : Écrire les tests** (`tests/public_events.rs`)

```rust
// spec: PUB-008, PUB-009, PUB-010, PUB-029, EVT-002
#[sqlx::test] async fn public_card_lists_running_events_in_order(pool) {
    /* 3 en cours (dont 2 au même début, « Brocante » puis « Atelier »), 1 à venir, 1 terminé → events = [plus tôt, « Atelier », « Brocante »] avec id, title, starts_at ;
       carte sans événement → [] ; clock après les fins → [] */ }
// spec: FRM-003, FRM-017, FRM-024, FRM-026
#[sqlx::test] async fn an_open_event_returns_its_form(pool) { /* state "open", standard_fields activés dans l'ordre, custom_fields, consent_text = texte par défaut résolu, form_version de 16 caractères */ }
// spec: EVT-012, EVT-027, FRM-002, Review Focus 3
#[sqlx::test] async fn a_coded_event_hides_its_form_until_unlocked(pool) {
    /* GET → {"state":"code_required","event":{"id","title"}} exactement ; aucune description, aucun libellé de champ ;
       unlock "moulin" → 403 invalid_access_code ; unlock "  chateau " → 200 PublicEventForm ;
       aucun corps de GET carte, GET événement, unlock (succès et échec) ne contient "Château" ni "chateau" */ }
// spec: EVT-008, EVT-026, FRM-024
#[sqlx::test] async fn closed_and_upcoming_events(pool) { /* à venir → closed ; terminé il y a 10 min → open ; il y a 16 min → closed ; unlock sur fermé → 409 event_closed */ }
// spec: FRM-024, ACC-017
#[sqlx::test] async fn unknown_or_foreign_events_are_404(pool) { /* événement d'une autre carte via le slug d'Alice → 404 ; uuid inconnu → 404 ; événement supprimé → 404 ; slug inconnu → 404 */ }
// spec: LNK-007, LNK-026
#[sqlx::test] async fn an_unserved_card_refuses_its_forms(pool) { /* désactivée, bloquée par le support, propriétaire suspendu → GET et unlock : 410 card_inactive */ }
// spec: LNK-003, FRM-024
#[sqlx::test] async fn an_old_slug_still_reaches_the_event(pool) { /* GET et unlock par l'ancien slug et par "Alice-Durand" → 200, pas de redirection */ }
// spec: ABU-007
#[sqlx::test] async fn failed_codes_are_limited_per_ip(pool) { /* 30 codes faux depuis 203.0.113.7 → 403 ; 31e (même correct) → 429 avec retry-after ; depuis 198.51.100.2 → 200 ; 100 codes corrects d'une IP → jamais 429 */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test public_events` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; tag `public`, sans `security` ; `make sqlx-prepare`, `make openapi`, puis `pnpm -C frontend -r typecheck` (les `PublicCard` construites côté web reçoivent `events: []`).
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, `make test-api` et `make test-web` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend && git commit -m "feat(api): public running events, event form and access code unlock"`

---

### Task 9 : Envoi du formulaire

**Files:**
- Create: `backend/server/tests/leads_submit.rs`
- Modify: `backend/server/src/{routes/public_events.rs, error.rs, app.rs, openapi.rs}`, `backend/server/tests/common/events.rs` (`submission(form: &Value, overrides: Value) -> Value` : réponses valides pour chaque champ du formulaire reçu, `consent: true`, `device_id` aléatoire, `form_version` du formulaire)

**Interfaces:**
- Consumes : tout ce qui précède, `validate_lead`, `db::leads`.
- Produces :
  - `ApiError::FormChanged` (409 `form_changed`) · `ApiError::DeviceLimitReached` (409 `device_limit_reached`) ;
  - `POST /api/public/cards/{slug}/events/{event_id}/leads` corps `LeadSubmission { device_id: Uuid, form_version: String, access_code: Option<String>, consent: bool, answers: AnswersInput, fax: Option<String> }` → `204`. Ordre (chaque étape est un appel au domaine ou à `db/`) :
    1. `ClientIp` ; `check` puis `record` (`LeadSubmission`) → 429 ;
    2. `serve_card` → 404 / 410 ; `find_public` → 404 ;
    3. `accepts_submissions(now)` → 409 `event_closed` ;
    4. champ piège non vide après trim → `204` immédiat, rien d'écrit, `tracing::info!("honeypot")` sans les réponses (ABU-005) ;
    5. événement avec code : `check(FailedAccessCode)` (429) ; code absent ou faux → `record(FailedAccessCode)` puis 403 `invalid_access_code` (EVT-013, FRM-041) ;
    6. `form_version` recalculé ≠ reçu → 409 `form_changed` (FRM-030) ;
    7. `validate_lead(…, consent, now.date_naive())` → 400 `validation_failed` (toutes les erreurs) ;
    8. transaction : `lock_device` → `count_for_device >= device_limit` → 409 `device_limit_reached` (EVT-029) → `insert` (`submitted_at = consent_at = now`, `consent_text` recalculé) → commit → `204`.
  - Aucune ligne de log ne contient le code d'accès ni les réponses.

- [ ] **Step 1 : Écrire les tests** (`tests/leads_submit.rs`)

```rust
// spec: FRM-004, FRM-008, FRM-038, FRM-013, FRM-016
#[sqlx::test] async fn a_valid_submission_is_stored_with_its_consent(pool) {
    /* 204 sans corps ; en base : consent_at == submitted_at == clock.now(), consent_text == consent_text du formulaire servi, device_id,
       prénom NFC « Éloïse », téléphone "+33612345678", un instantané par champ personnalisé ; la table n'a pas de colonne d'adresse IP */ }
// spec: FRM-006, FRM-012, FRM-015, FRM-037
#[sqlx::test] async fn an_invalid_submission_reports_every_field(pool) { /* consent false + email invalide + choix obligatoire vide → 400 avec consent, answers.email, answers.custom.<id> ; 0 contact */ }
// spec: EVT-008, EVT-026, Review Focus 8
#[sqlx::test] async fn grace_window_boundary(pool) { /* fin + 15 min → 204 ; fin + 15 min + 1 s → 409 event_closed ; à venir → 409 event_closed */ }
// spec: EVT-013, FRM-041
#[sqlx::test] async fn a_changed_code_is_checked_again(pool) { /* déverrouillé avec « Château », le propriétaire passe à « Moulin » ; envoi avec « Château » → 403 invalid_access_code ; avec « moulin » → 204 ; sans code → 403 */ }
// spec: EVT-014, EVT-029
#[sqlx::test] async fn the_device_limit_is_enforced(pool) {
    /* limite 1 : 2e envoi du même appareil → 409 device_limit_reached ; autre appareil → 204 ;
       le contact marqué spam compte encore ; supprimé, il libère la place ; limite 2 → 3e refusé */ }
// spec: EVT-029, Review Focus 2
#[sqlx::test] async fn simultaneous_submissions_from_one_device(pool) { /* 5 POST simultanés, même appareil, limite 1 → 1×204, 4×409, 1 contact */ }
// spec: ABU-002, ABU-005, Review Focus 4
#[sqlx::test] async fn a_filled_honeypot_is_ignored_silently(pool) { /* fax "http://spam" → 204, mêmes statut, corps et en-têtes (hors x-request-id) qu'un envoi accepté ; 0 contact ; le même appareil envoie ensuite normalement → 204 */ }
// spec: FRM-030, Review Focus 9
#[sqlx::test] async fn a_changed_form_is_refused(pool) { /* form_version lu, puis le propriétaire renomme un champ → 409 form_changed ; idem après un changement d'email de la carte (texte par défaut) */ }
// spec: ABU-001, ABU-006, ABU-008, Review Focus 5
#[sqlx::test] async fn submissions_are_limited_per_ip(pool) {
    /* 80 envois valides (80 appareils) depuis 203.0.113.7 → 80×204 ; puis 40 de plus (refusés ou non) passent le limiteur ; 121e → 429 avec retry-after ;
       depuis 198.51.100.2 → 204 ; "x-forwarded-for: 192.0.2.1, 203.0.113.7" compte pour 203.0.113.7 → 429 */ }
// spec: LNK-007
#[sqlx::test] async fn submitting_to_an_unserved_card_is_410(pool) { /* carte désactivée pendant la saisie → 410 card_inactive, 0 contact */ }
// spec: EVT-012, Review Focus 3
#[sqlx::test] async fn the_access_code_never_reaches_the_logs(pool) { /* capture_logs ; envois avec code correct et faux → les logs ne contiennent ni « Château » ni les réponses */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test leads_submit` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`, `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): lead submission with grace window, code recheck, device limit, IP limit and honeypot"`

---

### Task 10 : Contacts côté propriétaire — liste par événement, spam, suppression

**Files:**
- Create: `backend/server/src/routes/leads.rs`, `backend/server/tests/leads.rs`
- Modify: `backend/server/src/{app.rs, openapi.rs, views.rs, routes/mod.rs}`

**Interfaces:**
- Consumes : `db::leads::{list_for_event, set_spam, delete_for_owner}`.
- Produces :
  - `views::LeadView { id, event_id, submitted_at, spam: bool, answers: StandardAnswers, phone_display: Option<String>, custom: Vec<AnswerSnapshot>, consent_at, consent_text }` ;
  - `GET /api/events/{id}/leads` → `LeadList { leads: Vec<LeadView> }` (du plus récent au plus ancien, spam compris, EDI-020) ;
  - `PUT /api/leads/{id}/spam` corps `SpamBody { spam: bool }` → `LeadView` (`spam_at = now` ou `null`, idempotent, ABU-003, ABU-009) ;
  - `DELETE /api/leads/{id}` → `204` (ABU-004, ABU-010) ;
  - tag OpenAPI `leads`. Le plan 4 ajoutera ici recherche, détail, vue « toute la carte » et exports, sans changer ces routes.

- [ ] **Step 1 : Écrire les tests** (`tests/leads.rs`)

```rust
// spec: EDI-020, FRM-038
#[sqlx::test] async fn event_leads_are_listed_newest_first(pool) { /* 3 envois à t, t+1, t+2 → ordre inverse ; réponses, consent_text, phone_display "+33 6 12 34 56 78" */ }
// spec: ABU-003, ABU-009
#[sqlx::test] async fn spam_can_be_set_and_cleared(pool) { /* spam true → spam true ; encore true → 200 ; false → false ; toujours listé */ }
// spec: ABU-004, ABU-010
#[sqlx::test] async fn deleting_a_lead(pool) { /* 204 ; absent de la liste ; lead_count de l'événement décrémenté ; 2e DELETE → 404 */ }
// spec: FRM-022, FRM-023, Review Focus 6
#[sqlx::test] async fn editing_fields_never_breaks_existing_leads(pool) {
    /* contact avec « Formule » = « Prestige » et « Nombre d'invités » = 120 ; le propriétaire renomme « Formule » en « Offre », retire « Prestige » des options,
       passe « Nombre d'invités » en texte et supprime un 3e champ → l'ancien contact garde ses 3 instantanés d'origine ;
       un nouveau contact suit la nouvelle définition */ }
// spec: ACC-017
#[sqlx::test] async fn other_users_leads_are_404(pool) { /* bob : GET leads d'un événement d'Alice, PUT spam, DELETE → 404 */ }
// spec: LNK-008
#[sqlx::test] async fn leads_of_a_disabled_card_stay_visible(pool) { /* carte désactivée → GET leads 200 */ }
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test leads` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`, `make openapi`.
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `make test-api` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add backend frontend/api-client && git commit -m "feat(api): owner lead list per event, spam flag and deletion"`

---

### Task 11 : Données de test et harnais e2e des événements

**Files:**
- Modify: `backend/server/src/test_support/{seed.rs, routes.rs}`, `backend/server/src/bin/cartouche-seed.rs`, `backend/server/tests/test_support.rs`, `frontend/e2e/{env.ts, fixtures.ts, playwright.config.ts}`

**Interfaces:**
- Produces :
  - `pub type Scenario = fn(&PgPool, DateTime<Utc>) -> BoxFuture<'_, Result<SeedReport, sqlx::Error>>` : `/api/test/seed` passe `state.clock.now()`, `cartouche-seed` passe `Utc::now()` ; `base` et `cards` l'ignorent (`cards` l'utilise pour ses dates de désactivation) ;
  - `SeedReport` gagne `events: Vec<SeededEvent { id: Uuid, card_slug: String, title: String }>` ;
  - scénario `events` (complète `cards`, à charger après lui), identifiants fixes, dates relatives à `now` (T0), chaînes passées par `normalize`, `on conflict` pour rester rejouable :

| clé | carte | titre | début | fin | code | limite | champs | contacts |
|---|---|---|---|---|---|---|---|---|
| `mariage` | `alice-durand` | « Salon du Mariage Clermont 2027 » | T0 − 2 h | T0 + 6 h | — | 1 | prénom, nom, email obligatoires ; téléphone et adresse facultatifs ; « Date du mariage » (date), « Nombre d'invités » (nombre), « Formule » (choix unique : « Essentielle », « Prestige »), « Recevoir la brochure » (case à cocher) ; texte par défaut | « Éloïse D’Aubigné-Müller » (T0 − 90 min, +33612345678, Formule Prestige), « Zoé Lefèvre ✨ » (T0 − 60 min), « Bot Spam » marqué spam (T0 − 30 min) |
| `portes-ouvertes` | `alice-durand` | « Portes ouvertes de l'Atelier » | T0 − 1 h | sans fin | « Château » | 2 | prénom et email obligatoires ; consentement personnalisé « Vos coordonnées restent chez l'Atelier Durand & Fils, qui ne les partage avec personne. » | — |
| `demonstration` | `alice-durand` | « Démonstration en boutique » | T0 − 5 min | T0 + 2 h | — | 1 | email obligatoire | — |
| `decouverte` | `alice-durand` | « Atelier découverte » | T0 − 3 h | T0 − 10 min | — | 1 | prénom et email obligatoires | — |
| `lyon` | `alice-durand` | « Foire de Lyon » | T0 + 10 j | T0 + 12 j | — | 1 | email obligatoire | — |
| `paris-2026` | `alice-durand` | « Salon de Paris 2026 » | T0 − 40 j | T0 − 38 j | — | 1 | prénom, nom, email obligatoires | « Jean-Michel Hébert » |
| `archive` | `alice-archive` | « Événement archivé » | T0 − 1 h | T0 + 1 h | — | 1 | email obligatoire | — |
| `bloque` | `bob-martin` | « Salon bloqué » | T0 − 1 h | T0 + 1 h | — | 1 | email obligatoire | — |

    À T0, `alice-durand` a exactement 3 événements en cours (`mariage`, `portes-ouvertes`, `demonstration`) et le chevauchement maximal de ses événements est 3 (EVT-004) ; `decouverte` est dans sa fenêtre de grâce (EVT-008).
  - `frontend/e2e/env.ts` : `export const EVENTS_NOW = "2027-03-15T10:00:00.000Z";` ;
  - `fixtures.ts` : `SeededEvent`, `SeedReport.events` ; `TestApi.seedEvents(): Promise<SeedReport>` (`setClock(EVENTS_NOW)`, `seed("cards")`, `seed("events")`, rapports fusionnés) ; `TestApi.eventId(report, key)` n'est pas nécessaire : les tests cherchent par titre ; `TestApi.updateEvent(subject, id, patch)` (GET puis PUT fusionné, échoue si non 2xx) ; `TestApi.leads(subject, eventId): Promise<LeadView[]>` ; interfaces locales `EventView`, `LeadView` (R-P2) ;
  - `playwright.config.ts` : `use: { …, timezoneId: "Europe/Paris", locale: "fr-FR" }` (R-S4).

- [ ] **Step 1 : Écrire les tests** (`tests/test_support.rs`)

```rust
// spec: EVT-004, PUB-029, EVT-008
#[sqlx::test] async fn events_scenario_is_relative_to_the_clock(pool) {
    /* clock = T0 ; seed base, cards, events → GET public alice-durand : events = [mariage, portes-ouvertes, demonstration] ;
       decouverte : open ; lyon : closed ; alice-archive : 410 ; 4 contacts dont 1 spam ; max_simultaneous de chaque événement d'Alice ≤ 3 ;
       SeedReport.events contient les 8 titres */ }
#[sqlx::test] async fn events_scenario_is_replayable(pool) { /* seed events deux fois → mêmes 8 événements et 4 contacts */ }
```

  Les tests de scénario existants sont adaptés à la nouvelle signature, sans changer ce qu'ils vérifient.

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `cd backend && cargo test -p cartouche-api --all-features --test test_support` · Expected : FAIL.
- [ ] **Step 3 : Implémenter** ; `make sqlx-prepare`.
- [ ] **Step 4 : Vérifier**
  - Run: `cd backend && cargo test -p cartouche-api --all-features --test test_support` · Expected : PASS.
  - Run: `make e2e` · Expected : les tests e2e des plans 1 et 2 passent toujours avec le fuseau et la langue fixés.
- [ ] **Step 5 : Commit** — `git add backend frontend/e2e && git commit -m "test: clock-relative events seed scenario and e2e event helpers"`

---

### Task 12 : Suivis du plan 2 côté web — délai de lecture d'une vidéo, cache des redirections de la page

**Files:**
- Create: `frontend/web/src/lib/media/video.test.ts`
- Modify: `frontend/web/src/lib/media/video.ts`, `frontend/web/src/components/editor/MediaField.tsx` (et son test), `frontend/web/messages/fr.json` (`media.errors.videoUnreadable` : « Impossible de lire cette vidéo. Essaie un autre fichier MP4. »), `frontend/e2e/tests/public-page.spec.ts` ; si nécessaire `frontend/web/next.config.ts`

**Interfaces:**
- Produces :
  - `export const VIDEO_LOAD_TIMEOUT_MS = 15_000;` · `export class VideoLoadTimeout extends Error` ; `loadVideo(file, timeoutMs = VIDEO_LOAD_TIMEOUT_MS)` rejette avec `VideoLoadTimeout` et appelle `release()` quand ni `loadeddata` ni `error` n'arrive à temps (MED-021) ; `readVideoDuration` et `capturePoster` propagent l'erreur ;
  - `MediaField` : sur `VideoLoadTimeout` ou toute erreur de lecture, message `media.errors.videoUnreadable` et le bouton redevient utilisable ;
  - la redirection 308 de `/c/<ancien slug>` et `/c/<Majuscules>` porte `Cache-Control: no-store` (LNK-030). Next envoie déjà `no-store` sur une page dynamique ; si l'e2e montre le contraire, ajouter `headers()` dans `next.config.ts` pour `/c/:path*` et noter la cause dans le message de commit.

- [ ] **Step 1 : Écrire les tests**

```ts
// video.test.ts (vi.useFakeTimers, élément <video> factice qui ne déclenche rien)
test("MED-021 loading a video gives up after 15 seconds", async () => { /* readVideoDuration rejette VideoLoadTimeout après 15 000 ms ; URL.revokeObjectURL appelé */ });
test("MED-021 a video that loads in time is read", async () => { ... });
// MediaField.test.tsx
test("MED-021 an unreadable video shows a message and the field is usable again", async () => { ... });
// public-page.spec.ts
test("LNK-024 LNK-030 permanent redirects are not cached", /* api.get(`${WEB_URL}/c/alice`, { maxRedirects: 0 }) → 308, cache-control contient "no-store" ; idem /c/Alice-Durand ; vCard /api/public/cards/alice/vcard par l'origine web → 308 no-store */);
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/lib/media src/components/editor/MediaField` puis `make e2e ARGS="-g 'MED-0|LNK-030'"` · Expected : FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add frontend && git commit -m "fix(web): time out unreadable videos and keep permanent redirects out of caches"`

---

### Task 13 : Web — dates dans le fuseau de l'utilisateur et brouillon d'événement

**Files:**
- Create: `frontend/web/src/lib/events/{types.ts, time.ts, time.test.ts, draft.ts, draft.test.ts, groups.ts, groups.test.ts}`
- Modify: `frontend/web/package.json` (`date-fns` 4, `@date-fns/tz` 1), `frontend/pnpm-lock.yaml`

**Interfaces:**
- Consumes : types générés `EventView`, `EventInput`, `StandardFields`, `CustomField`, `CustomFieldKind`, `FieldMode` (réexportés par `types.ts`) ; `fieldErrors` de `lib/cards/draft.ts`.
- Produces :
  - `time.ts` : `userTimeZone(): string` (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `"Europe/Paris"` à défaut, EVT-022) · `toLocalInput(iso: string, zone: string): string` (`AAAA-MM-JJTHH:mm` pour `<input type="datetime-local">`) · `fromLocalInput(local: string, zone: string): string` (instant UTC ISO ; heure inexistante avancée d'une heure, heure ambiguë = première occurrence, EVT-023) · `formatEventDate(iso: string, zone: string): string` (`Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone })`, par exemple « 15 mars 2027 à 11:00 ») · `zoneLabel(zone: string): string` (nom lisible, par exemple « Europe/Paris ») ;
  - `draft.ts` : `CustomFieldDraft { id: string; label: string; kind: CustomFieldKind; required: boolean; help: string; options: string[] }` · `EventDraft { title; description; startsAt: string /* local */; endsAt: string /* local ou "" */; accessCode; deviceLimit: string; standardFields: StandardFields; customFields: CustomFieldDraft[]; consentMode: "default" | "custom"; consentText: string }` · `newEventDraft(zone: string, now: Date): EventDraft` (début = prochaine heure pleine, sans fin, limite "1", prénom/nom/email obligatoires, téléphone facultatif, le reste non demandé, consentement par défaut) · `draftFromEvent(event: EventView, zone: string): EventDraft` · `draftToBody(draft: EventDraft, zone: string): EventInput` (chaînes vides → `null`, `consent_text` `null` en mode défaut ou vide, FRM-028) · `addCustomField(draft, kind): EventDraft` (`crypto.randomUUID()`, FRM-032) · `moveCustomField(draft, index, delta): EventDraft` · `removeCustomField(draft, index): EventDraft` · `eventFieldErrors(error: unknown): Record<string, string>` (chemin → clé `fieldErrors.<code>`) ;
  - `groups.ts` : `groupEvents(events: EventView[]): { running: EventView[]; upcoming: EventView[]; past: EventView[] }` selon `phase` (jamais l'heure du navigateur, R-S21) : en cours et à venir par début croissant, passés par début décroissant.

- [ ] **Step 1 : Écrire les tests**

```ts
test("EVT-007 EVT-022 local input round trip in the user's zone", () => { /* "2027-03-15T11:00" Europe/Paris ↔ "2027-03-15T10:00:00.000Z" ; "2027-04-02T10:00" → "2027-04-02T08:00:00.000Z" (heure d'été) ; America/New_York */ });
test("EVT-022 the zone falls back to Europe/Paris", () => { /* resolvedOptions().timeZone undefined (mock) → "Europe/Paris" */ });
test("EVT-023 a local time that does not exist moves forward one hour", () => { /* "2027-03-28T02:30" Europe/Paris → "2027-03-28T01:30:00.000Z" */ });
test("EVT-023 an ambiguous local time is the first occurrence", () => { /* "2027-10-31T02:30" Europe/Paris → "2027-10-31T00:30:00.000Z" */ });
test("EVT-007 dates are shown in French", () => { /* formatEventDate("2027-03-15T10:00:00Z", "Europe/Paris") === "15 mars 2027 à 11:00" */ });
test("EDI-009 EVT-020 events are grouped by their server phase", () => { /* phases mélangées → trois groupes ordonnés ; un événement « running » dont les dates sont passées pour le navigateur reste en cours */ });
test("EDI-019 draft round trip", () => { /* draftToBody(draftFromEvent(e)) reproduit le corps attendu */ });
test("EVT-014 FRM-019 new event defaults", () => { /* deviceLimit "1", first_name/last_name/email required, phone optional, consentMode default */ });
test("FRM-020 FRM-032 custom fields keep their id when moved", () => { /* add ×3, move(2, -2), remove(1) → ids d'origine conservés, ordre attendu */ });
test("FRM-028 a blank custom consent goes back to the default", () => { /* consentMode custom, texte "  " → consent_text null */ });
test("EDI-019 EDI-015 field errors map to event paths", () => { /* ApiError fields [{custom_fields[0].options[1], duplicate_option}] → clé fieldErrors.duplicate_option */ });
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/lib/events` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus** (`pnpm -C frontend --filter web add date-fns@^4 @date-fns/tz@^1`).
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `pnpm -C frontend -r typecheck` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add frontend && git commit -m "feat(web): event dates in the user's time zone and event draft model"`

---

### Task 14 : Tableau de bord — événements d'une carte et éditeur d'événement

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/cards/[id]/events/{page.tsx, new/page.tsx, [eventId]/page.tsx}`, `frontend/web/src/components/events/{EventList.tsx, EventActions.tsx, EventEditor.tsx, StandardFieldsEditor.tsx, CustomFieldsEditor.tsx, ConsentEditor.tsx, *.test.tsx}`, `frontend/e2e/tests/events.spec.ts`
- Modify: `frontend/web/src/components/cards/CardActions.tsx` (lien « Événements »), `frontend/web/src/components/editor/CardEditor.tsx` (lien « Événements » dans l'en-tête), `frontend/web/messages/fr.json` (`events.*`, `fieldErrors.*` des nouveaux codes, message de `too_many_simultaneous_events` et `event_not_running`)

**Interfaces:**
- Consumes : routes de la tâche 7, `lib/events/*`, `useApi`, `AccountGate`, composants shadcn existants (`Input`, `Textarea`, `Select`, `Switch`, `Dialog`, `Badge`, `Button`).
- Produces :
  - page liste (EDI-009, EDI-018) : trois sections « En cours », « À venir », « Passés » (`data-testid="events-group-running|upcoming|past"`, texte « Aucun événement » si vide) ; une ligne par événement (`data-testid="event-row-<id>"`) avec titre, début, fin ou « Sans fin » (`formatEventDate` dans `userTimeZone()`), badge d'état, « N contacts », liens « Modifier » et « Contacts », « Terminer maintenant » (`event-end-now-<id>`, seulement en cours, EVT-021), « Supprimer » (`event-delete-<id>`, dialogue qui affiche le nombre de contacts, EVT-024) ; bouton « Nouvel événement » (`new-event`) ; boutons désactivés jusqu'au rechargement (suivi du plan 1) ;
  - `EventEditor({ cardId, event?, card })` (EDI-019) : titre, description, début et fin (`datetime-local`, case « Sans fin »), nom du fuseau affiché à côté (`data-testid="event-zone"`, EVT-022), code d'accès en clair, limite par appareil (`type="number"` 1 à 100), `StandardFieldsEditor` (un `Select` Non demandé / Facultatif / Obligatoire par champ standard, FRM-017, FRM-019), `CustomFieldsEditor` (ajouter par type, monter, descendre, retirer, libellé, aide, obligatoire, options d'un choix unique, FRM-020, FRM-021), `ConsentEditor` (« Texte par défaut » qui affiche `default_consent_text`, ou « Texte personnalisé » ; avertissement si la carte n'a pas d'email, FRM-029) ; « Enregistrer » → POST ou PUT ; erreurs sous chaque champ (`aria-describedby`), saisie conservée (EDI-015) ; `409 too_many_simultaneous_events` → message en tête du formulaire ; à la création, le texte par défaut est prévisualisé avec le contenu de la carte (lu par `GET /api/cards/{id}`), car l'événement n'existe pas encore ;
  - toute la logique (conversion, regroupement, brouillon) reste dans `lib/events` ; les composants ne font qu'afficher et appeler.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("EDI-018 event row shows title, dates, phase and lead count", () => { ... });
test("EDI-009 three groups, empty ones say so", () => { ... });
test("EVT-006 EVT-021 end now is offered on running events only", () => { ... });
test("EVT-024 delete asks for confirmation with the lead count", async () => { /* « 3 contacts seront supprimés » ; Annuler → aucun DELETE ; Confirmer → DELETE */ });
test("FRM-017 FRM-019 standard field modes", () => { ... });
test("FRM-020 FRM-021 custom fields: add, type, options, reorder, remove", () => { ... });
test("FRM-029 default consent text is shown, with a warning when the card has no email", () => { ... });
test("EVT-022 the time zone is shown next to the dates", () => { ... });
test("EDI-019 EDI-015 a rejected save keeps the input and shows errors", async () => { ... });
test("EVT-018 too many simultaneous events is explained", async () => { ... });
```

- [ ] **Step 2 : Écrire les tests e2e** (`events.spec.ts` ; `api.seedEvents()` puis `loginAs("seed-alice")` dans un `beforeEach`)

```ts
test("EDI-009 EDI-018 EVT-020 the events of a card in three groups", /* En cours : Salon du Mariage…, Portes ouvertes…, Démonstration… ; À venir : Foire de Lyon ; Passés : Atelier découverte, Salon de Paris 2026 ; « 3 contacts » sur le Salon du Mariage ; début affiché « 15 mars 2027 à 09:00 » */);
test("EVT-001 EVT-007 EVT-022 create an event in the user's time zone", /* « Europe/Paris » affiché ; début 2027-04-02 10:00, fin 18:00 → ligne dans À venir ; api GET → starts_at "2027-04-02T08:00:00Z" */);
test("EVT-004 EVT-018 a fourth simultaneous event is refused", /* début 2027-03-15 11:00, fin 12:00 → message, aucun nouvel événement */);
test("EVT-006 EVT-021 PUB-029 end an event now", /* Démonstration en boutique → Terminer maintenant → dans Passés ; /c/alice-durand n'a plus son bouton */);
test("EVT-009 EVT-010 EDI-019 edit an event", /* Portes ouvertes : code « Château » affiché ; titre « Portes ouvertes ✨ » → Enregistrer → le bouton public porte le nouveau titre */);
test("FRM-020 FRM-021 FRM-032 custom fields are saved in order", /* ajouter « Votre budget » (choix unique : « < 5 000 € », « > 5 000 € ») et le monter en premier → recharger → ordre conservé */);
test("EVT-024 delete an event and its leads", /* Salon de Paris 2026 → dialogue « 1 contact » → Confirmer → ligne disparue ; api.leads → 404 */);
test("EVT-025 LNK-008 events of a disabled card are still listed", /* /dashboard/cards/<alice-archive>/events → Événement archivé, modifiable */);
test("ACC-017 another user's events are not reachable", /* bob → /dashboard/cards/<alice-durand>/events → « Carte introuvable » */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/components/events` puis `make e2e ARGS="-g 'EDI-009|EDI-018|EDI-019|EVT-0|FRM-02|FRM-03|ACC-017'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): card events page and event editor"`

---

### Task 15 : Tableau de bord — contacts d'un événement

**Files:**
- Create: `frontend/web/src/app/(app)/dashboard/cards/[id]/events/[eventId]/leads/page.tsx`, `frontend/web/src/components/events/{LeadList.tsx, LeadList.test.tsx}`, `frontend/web/src/lib/events/leads.ts` (+ test), `frontend/e2e/tests/leads.spec.ts`
- Modify: `frontend/web/messages/fr.json` (`leads.*`)

**Interfaces:**
- Consumes : routes de la tâche 10.
- Produces :
  - `leadDisplayName(lead: LeadView): string` (prénom et nom, sinon email, sinon « Contact sans nom ») dans `lib/events/leads.ts` ;
  - `LeadList({ eventId })` (EDI-020) : une ligne par contact (`data-testid="lead-row-<id>"`) avec date d'envoi (`formatEventDate`), nom, email, téléphone (`phone_display`), badge « Spam » (`lead-spam-badge-<id>`) ; « Marquer comme spam » / « Ce n'est pas un spam » (`lead-spam-<id>`, ABU-003, ABU-009) ; « Supprimer » (`lead-delete-<id>`) avec un dialogue de confirmation « Ce contact sera supprimé définitivement. » (ABU-004, ABU-010) ; boutons désactivés jusqu'au rechargement ; titre de l'événement en en-tête, lien de retour vers les événements.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("EDI-020 leads newest first with name, email, phone and spam label", () => { ... });
test("ABU-003 ABU-009 the spam flag can be set and cleared", async () => { /* PUT {spam:true} puis {spam:false} */ });
test("ABU-004 ABU-010 deleting asks for confirmation", async () => { /* Annuler → aucun DELETE ; Confirmer → DELETE */ });
test("EDI-020 a lead without a name shows its email", () => { ... });
```

- [ ] **Step 2 : Écrire les tests e2e** (`leads.spec.ts`, `api.seedEvents()` puis `loginAs("seed-alice")`)

```ts
test("EDI-020 FRM-016 leads of an event, accents intact", /* Salon du Mariage → Contacts : « Bot Spam » (Spam), « Zoé Lefèvre ✨ », « Éloïse D’Aubigné-Müller » dans cet ordre ; « +33 6 12 34 56 78 » */);
test("ABU-003 ABU-009 mark and unmark spam", /* Zoé → Marquer comme spam → badge ; recharger → badge ; Ce n'est pas un spam → plus de badge */);
test("ABU-004 ABU-010 delete a lead", /* Bot Spam → Supprimer → Confirmer → disparu ; page des événements : « 2 contacts » */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/components/events/LeadList src/lib/events/leads` puis `make e2e ARGS="-g 'EDI-020|ABU-00'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): event leads list with spam flag and deletion"`

---

### Task 16 : Web — logique du formulaire prospect

**Files:**
- Create: `frontend/web/src/lib/event-form/{device.ts, answers.ts, persist.ts, outcome.ts, device.test.ts, answers.test.ts, persist.test.ts, outcome.test.ts}`, `frontend/web/src/lib/public-event.ts`, `frontend/web/src/lib/public-event.test.ts`
- Modify: `frontend/web/src/lib/public-card.ts` (`toPublicEvents`), `frontend/web/src/lib/public-card.test.ts`

**Interfaces:**
- Consumes : types générés `PublicEventResponse`, `PublicEventForm`, `LeadSubmission`, `PublicEventButton`.
- Produces :
  - `device.ts` : `DEVICE_COOKIE = "cartouche_device"`, `DEVICE_STORAGE_KEY = "cartouche.device"` · `getDeviceId(env?: { storage?: Storage; cookies?: { get(): string; set(value: string): void } }): string` (EVT-028 : stockage local, puis cookie, sinon `crypto.randomUUID()` ; réécrit les deux, `path=/; max-age=34560000; SameSite=Lax` ; toute exception de stockage est ignorée) ;
  - `answers.ts` : `LeadDraft { answers: { first_name; last_name; birth_date; email; phone: string; address: { street; postal_code; city; country: string } }; custom: Record<string, string | boolean>; consent: boolean; fax: string }` · `emptyLeadDraft(form: PublicEventForm): LeadDraft` (pays « France », FRM-033) · `refreshDraft(draft, form): LeadDraft` (FRM-030 : garde les réponses des champs qui existent encore, décoche le consentement) · `checkLeadDraft(form, draft, today: string): Record<string, string>` (chemin → clé de message, miroir de FRM-033 à FRM-037 ; le serveur reste l'arbitre) · `draftToSubmission(form, draft, deviceId, accessCode: string | null): LeadSubmission` (`"12,5"` → `12.5` ; vides omis ; case → booléen) ;
  - `persist.ts` : `loadDraft(eventId): LeadDraft | null` · `saveDraft(eventId, draft)` · `clearDraft(eventId)` (stockage de session, clé `cartouche.lead.<eventId>`, exceptions ignorées, FRM-040) ;
  - `outcome.ts` : `submissionOutcome(error: unknown): { kind: "fields"; fields: Record<string, string> } | { kind: "code_changed" } | { kind: "form_changed" } | { kind: "closed" } | { kind: "device_limit" } | { kind: "rate_limited" } | { kind: "inactive" } | { kind: "network" } | { kind: "unknown" }` (FRM-041, FRM-042) ;
  - `public-event.ts` : `fetchPublicEvent(slug, eventId): Promise<PublicEventResponse | { state: "inactive" } | null>` (`React.cache`, `no-store` ; 400 et 404 → `null` ; 410 → `{ state: "inactive" }`) ;
  - `public-card.ts` : `toPublicEvents(card: PublicCard): PublicEvent[]` (`starts_at` → `startsAt`, ordre conservé).

- [ ] **Step 1 : Écrire les tests**

```ts
test("EVT-015 EVT-028 the device id is created once and kept in both stores", () => { ... });
test("EVT-028 an id found in one store is copied to the other", () => { /* cookie seul → stockage local rempli ; stockage seul → cookie écrit */ });
test("EVT-028 storage failures still give an id", () => { /* localStorage qui jette (navigation privée) → UUID */ });
test("FRM-033 a required address needs every part and defaults to France", () => { ... });
test("FRM-034 FRM-035 FRM-036 FRM-037 client checks mirror the server rules", () => { /* email, longueurs, dates, nombre, choix, consentement */ });
test("FRM-036 numbers accept a comma", () => { /* draftToSubmission : "12,5" → 12.5 */ });
test("FRM-040 the draft survives a reload and is cleared after success", () => { ... });
test("FRM-030 a refreshed form keeps the answers that still apply and unchecks consent", () => { ... });
test("FRM-041 FRM-042 server refusals become outcomes", () => { /* 403 invalid_access_code → code_changed ; 409 form_changed, event_closed, device_limit_reached ; 429 ; 410 ; TypeError fetch → network ; 400 fields */ });
test("PUB-008 PUB-029 public events come from the card", () => { ... });
test("FRM-024 fetchPublicEvent maps 404 and 400 to null and 410 to inactive", async () => { ... });
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/lib/event-form src/lib/public-event src/lib/public-card` · Expected : FAIL.
- [ ] **Step 3 : Implémenter les signatures ci-dessus.**
- [ ] **Step 4 : Lancer et vérifier le succès** — même commande, puis `pnpm -C frontend -r typecheck` · Expected : PASS.
- [ ] **Step 5 : Commit** — `git add frontend && git commit -m "feat(web): prospect form logic — device id, answers, draft persistence and outcomes"`

---

### Task 17 : Page du formulaire prospect et boutons d'événement réels

**Files:**
- Create: `frontend/web/src/app/c/[slug]/e/[eventId]/{page.tsx, not-found.tsx, page.test.tsx}`, `frontend/web/src/components/event-form/{EventFormPage.tsx, AccessCodeScreen.tsx, LeadForm.tsx, ConsentField.tsx, Honeypot.tsx, Confirmation.tsx, ClosedEvent.tsx, *.test.tsx}`, `frontend/e2e/tests/event-form.spec.ts`
- Modify: `frontend/web/src/app/c/[slug]/page.tsx` (`events: toPublicEvents(card)`), `frontend/web/messages/fr.json` (`eventForm.*`, en vouvoyant), `frontend/e2e/tests/public-page.spec.ts`

**Interfaces:**
- Consumes : `fetchPublicCard`, `fetchPublicEvent`, `lib/event-form/*`, `resolveTheme`, `themeStyle`, `createApiClient` (navigateur, sans jeton).
- Produces :
  - page `/c/[slug]/e/[eventId]` (Server Component, FRM-024) : carte `null` → `notFound()` (« Formulaire introuvable ») ; `redirect` → `permanentRedirect("/c/<courant>/e/<id>")` (LNK-030 : vérifier `no-store` comme à la tâche 12) ; `inactive` → `<InactiveCard />` ; événement `null` → `notFound()` ; `{state:"inactive"}` → `<InactiveCard />` ; `closed` → `<ClosedEvent>` (« Ce formulaire n'est pas ouvert en ce moment. », retour à la carte) ; sinon `<EventFormPage>` dans un conteneur plein écran qui porte `themeStyle(resolveTheme(card.theme))` (TPL-020) ; métadonnées `robots: noindex` ;
  - `EventFormPage({ slug, card, initial: PublicEventResponse })` (client) : machine d'états `code` → `form` → `sent` ; bouton de retour vers `/c/<slug>` (`event-form-back`, FRM-001) ; `AccessCodeScreen` (`access-code-input`, `access-code-submit`, message `invalid_access_code`, FRM-002) ; `LeadForm` (`event-form`, `event-form-title`, `event-form-description`, `field-<chemin>` et `field-error-<chemin>` pour chaque champ, par exemple `field-answers.email`, attributs de FRM-039, FRM-005, FRM-003) ; `ConsentField` (`consent-checkbox` étiqueté par `consent-text`, FRM-006) ; `Honeypot` (`name="fax"`, hors écran par position absolue, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`, ABU-005) ; `event-form-submit` ; après succès : `clearDraft` et `Confirmation` (`event-form-confirmation`, `confirmation-save-contact` vers `card.vcard_url` avec `download`, `confirmation-back`, FRM-004) ; chaque `submissionOutcome` a son message (FRM-041, FRM-042) ; erreur réseau → message et « Réessayer » (FRM-040) ; brouillon sauvé à chaque saisie ;
  - toute décision (validation, transformation, résultat) appelle `lib/event-form` ; les composants n'ont pas de logique métier.

- [ ] **Step 1 : Écrire les tests unitaires**

```ts
test("FRM-003 FRM-017 FRM-018 title, description, standard then custom fields", () => { ... });
test("FRM-005 FRM-039 every input has a label, a type and autocomplete", () => { ... });
test("FRM-006 FRM-037 the consent checkbox is labelled by the exact text", () => { ... });
test("ABU-002 ABU-005 the honeypot is off-screen, untabbable and hidden from screen readers", () => { ... });
test("FRM-015 errors sit next to each field and the input stays", async () => { ... });
test("FRM-002 the code screen comes first", async () => { ... });
test("FRM-041 a changed code goes back to the code screen, answers kept", async () => { ... });
test("FRM-004 the confirmation offers the vCard and the way back", async () => { ... });
test("FRM-042 FRM-040 each refusal and a network error have their message", async () => { ... });
test("TPL-020 FRM-025 the form carries the card theme", () => { /* style avec --card-accent du thème de la carte */ });
test("FRM-024 PUB-002 the form page renders on the server", async () => { /* page.test.tsx : renderToString avec fetch mocké ; closed → texte fermé ; null → notFound */ });
```

- [ ] **Step 2 : Écrire les tests e2e** (`event-form.spec.ts`, projets `mobile` et `desktop` ; `api.seedEvents()` dans un `beforeEach`, avant toute signature de jeton)

```ts
test("FRM-001 PUB-008 the event button opens the full-screen form with a way back", ...);
test("FRM-003 FRM-012 FRM-013 FRM-015 FRM-004 FRM-016 fill, fix, send, confirm", /* Salon du Mariage : email « eloise@ » → erreur sous l'email, prénom « Éloïse » toujours là ; corriger ; téléphone « 06 12 34 56 78 » ; consentement ; Envoyer → confirmation ; « Enregistrer le contact » télécharge alice-durand.vcf ; api.leads : « Éloïse D’Aubigné-Müller », "+33612345678", consent_text = texte affiché */);
test("FRM-002 EVT-011 the access code ignores case, spaces and accents", /* Portes ouvertes : « chateau » → formulaire */);
test("EVT-012 EVT-027 the access code is never sent to the browser", /* page.on("response") sur /api/public/* et page.content() → jamais « Château » ; avant le code, ni description ni champ */);
test("FRM-041 EVT-013 a changed code sends the prospect back to the code screen", /* déverrouiller, api.updateEvent code « Moulin », Envoyer → écran du code avec message ; « moulin » → Envoyer → confirmation sans ressaisie */);
test("EVT-014 FRM-042 a second submission from the same device is refused", ...);
test("EVT-015 a new private context can submit again", /* browser.newContext() → envoi accepté */);
test("EVT-008 EVT-026 a form opened during the grace period can still be sent", /* Atelier découverte (fini il y a 10 min) s'ouvre ; setClock(T0 + 4 min) → Envoyer → confirmation ; nouveau formulaire, setClock(T0 + 6 min) → Envoyer → message « fermé » */);
test("FRM-024 an upcoming event shows the closed screen", /* Foire de Lyon */);
test("FRM-024 an unknown event is a 404", /* /c/alice-durand/e/<uuid inconnu> → 404, « Formulaire introuvable » ; /c/alice-durand/e/abc → 404 */);
test("LNK-007 FRM-024 the form of an unserved card shows the neutral page", /* Événement archivé (alice-archive), Salon bloqué (bob-martin) → « Cette carte n'est plus active » */);
test("FRM-024 LNK-030 an old slug redirects to the current form address", /* /c/alice/e/<mariage> → /c/alice-durand/e/<mariage> ; 308 avec no-store */);
test("FRM-005 FRM-039 the form works with the keyboard alone", /* Tab de champ en champ, Espace sur le consentement, Entrée pour envoyer → confirmation */);
test("FRM-040 a reload keeps the answers", ...);
test("ABU-002 ABU-005 a filled honeypot shows the confirmation but stores nothing", /* remplir [name=fax] par locator.fill({force:true}) → confirmation ; api.leads inchangé */);
test("FRM-030 a form changed while filling reloads with the answers kept", /* api.updateEvent titre → Envoyer → message, consentement décoché, réponses présentes ; cocher → Envoyer → confirmation */);
```

  Dans `public-page.spec.ts` :

```ts
test("PUB-008 PUB-009 PUB-029 running events are buttons sorted by start", /* seedEvents : event-button-<mariage>, <portes-ouvertes>, <demonstration> dans cet ordre, avec leurs titres ; pas de bouton pour Atelier découverte ni Foire de Lyon */);
test("PUB-010 no running event, no button", /* seed cards seul → aucun event-button-* */);
// dans la boucle `for (const template of TEMPLATE_IDS)` :
test("TPL-003 TPL-020 FRM-001 FRM-006 event button, form and consent on every template", /* seedEvents ; template ; clic sur event-button-<mariage> → /c/alice-durand/e/<mariage> ; consent-text contient « Alice Durand (Atelier Durand & Fils) » ; remplir, consentir, Envoyer → event-form-confirmation */);
```

- [ ] **Step 3 : Lancer et vérifier l'échec** — Run: `pnpm -C frontend --filter web exec vitest run src/components/event-form "src/app/c"` puis `make e2e ARGS="-g 'FRM-|PUB-0|TPL-0|LNK-007|LNK-030|EVT-0|ABU-00'"` · Expected : FAIL.
- [ ] **Step 4 : Implémenter.**
- [ ] **Step 5 : Lancer et vérifier le succès** — mêmes commandes, plus `make e2e ARGS="-g 'PUB-|LNK-|EDI-005|EDI-017'"` (la page publique et l'aperçu du plan 2 ne régressent pas) · Expected : PASS.
- [ ] **Step 6 : Commit** — `git add frontend && git commit -m "feat(web): shared prospect event form and real event buttons on the public page"`

---

### Task 18 : Skills et documentation

**Files:**
- Modify: `.claude/skills/change-api/SKILL.md`, `.claude/skills/add-seed-scenario/SKILL.md`, `.claude/skills/add-card-template/SKILL.md`, `.claude/skills/dev-env/SKILL.md`, `.claude/skills/run-tests/SKILL.md`, `CLAUDE.md`

**Interfaces:**
- Produces :
  - `change-api` : route publique d'un objet rattaché à une carte (`serve_card`, exceptions documentées de `db/`, codes `410 card_inactive` / `404`) ; limite par IP (`ClientIp`, `RateLimiter`, `Bucket`, `ApiError::RateLimited` et `Retry-After`, tests par `request_from`) ; heure toujours par `state.clock` ; adresses de médias : `Audience::Dashboard(now)` pour les vues propriétaire et support, `Audience::Public` pour le public ; course entre requêtes concurrentes (verrou de la carte, verrou consultatif) et test `join_all` ; liste des nouveaux codes d'erreur ;
  - `add-seed-scenario` : nouvelle signature `fn(&PgPool, DateTime<Utc>)` et pourquoi (dates relatives à l'horloge) ; scénario `events` et son tableau ; `SeedReport { users, cards, events }` ; `api.seedEvents()` et l'ordre `setClock` avant `loginAs` ;
  - `add-card-template` : les événements arrivent par `card.events` → `events` (le template ne rend que le bouton `TEMPLATE_TEST_IDS.eventButton(id)` vers `urls.eventForm(id)`) ; le formulaire est commun (TPL-020) ; la boucle de `public-page.spec.ts` vérifie maintenant bouton, formulaire et consentement (`make e2e ARGS="-g TPL-003"`) ;
  - `dev-env` : `MAX_SIMULTANEOUS_EVENTS`, `TRUSTED_PROXY_HOPS` ; `make seed SCENARIO=cards` puis `SCENARIO=events` (dates autour de l'heure courante) ; ouvrir un formulaire en local (`/c/alice-durand/e/<id>`, code « Château ») ; figer l'horloge pour voir un événement commencer ou finir ;
  - `run-tests` : l'e2e tourne en `Europe/Paris` et `fr-FR` ; règles EVT/FRM/ABU et fichiers de tests correspondants ;
  - `CLAUDE.md` : carte du dépôt (`src/lib/events`, `src/lib/event-form`, `src/components/events`, `src/components/event-form`, formulaire `/c/<slug>/e/<id>`), exception du texte de consentement par défaut dans la règle « Aucun texte d'interface en dur », mention des deux nouvelles variables dans la phrase sur `.env.example`.

- [ ] **Step 1 : Écrire les mises à jour** listées ci-dessus, en français, en suivant la forme actuelle de chaque skill.
- [ ] **Step 2 : Vérifier** — Run: `node scripts/spec-lint.mjs` · Expected : exit 0 (aucune citation inconnue dans la doc n'est vérifiée, mais la spec reste intacte).
- [ ] **Step 3 : Commit** — `git add .claude CLAUDE.md && git commit -m "docs: skills and CLAUDE.md for events, prospect form and anti-abuse"`

---

### Task 19 : Statut de la spec, couverture et vérification finale

**Files:**
- Modify: `spec/events.md`, `spec/event-form.md`, `spec/anti-abuse.md`, `spec/dashboard-editor.md`, `spec/public-page.md`, `spec/templates-themes.md`, `spec/media.md`, `spec/card-links.md`, `spec/leads-exports.md`

- [ ] **Step 1 : Mettre à jour les lignes de statut**, exactement :
  - `events.md` : `> Statut : implémenté (plan 3)`
  - `event-form.md` : `> Statut : implémenté (plan 3)`
  - `anti-abuse.md` : `> Statut : implémenté (plan 3)`
  - `dashboard-editor.md` : `> Statut : implémenté (plans 2 et 3) ; EDI-010 : plan 4`
  - `public-page.md` : `> Statut : implémenté (plans 2 et 3)`
  - `templates-themes.md` : `> Statut : implémenté (plans 2 et 3)`
  - `media.md` : `> Statut : implémenté (plans 2 et 3)`
  - `card-links.md` : `> Statut : implémenté (plans 2 et 3) ; LNK-015 et LNK-016 : plan 4`
  - `leads-exports.md` : `> Statut : spécifié, non implémenté (plan 4) ; la liste des contacts d'un événement, avec marquage spam et suppression, existe depuis le plan 3 (EDI-020)`
- [ ] **Step 2 : Vérifier la couverture**

Run: `node scripts/spec-lint.mjs --coverage`
Expected : exit 0 ; aucune règle EVT, FRM, ABU, ni EDI-009, EDI-018 à EDI-020, PUB-008 à PUB-010, PUB-029, TPL-003, TPL-020, MED-021 à MED-024, LNK-030 dans la liste des règles non citées. Toute règle restante reçoit son test dans la tâche qui la possède avant de continuer (les règles de principe sans comportement isolé, comme EVT-015, sont citées par le test qui les exerce : `device.test.ts` et l'e2e `EVT-015`).

- [ ] **Step 3 : Vérification complète**

Run: `make lint test` puis `make e2e`
Expected : tout passe (projets `mobile` et `desktop`) ; `git status` propre hormis les fichiers de cette tâche.

- [ ] **Step 4 : Commit** — `git add spec && git commit -m "docs(spec): mark events, prospect form and anti-abuse as implemented"`
