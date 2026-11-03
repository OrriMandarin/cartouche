---
name: add-card-template
description: Use when adding a new card template (public page layout) to Cartouche: template folder, settings schema, registry, translations, contract and e2e coverage.
---

# Ajouter un template de carte

Un template est un composant React versionné dans `frontend/web/src/templates/` (TPL-001). La page publique (Server Component) et l'aperçu de l'éditeur (client) le rendent avec le même composant (TPL-014). Le backend n'a rien à changer : il ne connaît que l'identifiant, et une carte dont le template est inconnu s'affiche en « classique » (TPL-015).

Fichiers de référence : `contract.ts` (types `TemplateDefinition`, `TemplateProps`, `TEMPLATE_TEST_IDS`), `ids.ts` (`TEMPLATE_IDS`), `registry.ts` (`TEMPLATES`, `renderTemplate`), `settings-schema.ts` (`SettingsSchema`, `parseSettings`), `contact-links.ts` (`isHttpUrl`, `mailtoHref`, `telHref`), `classique/` (le modèle à copier), `contract.test.tsx` (suite de contrat).

## Étapes

1. **Créer `frontend/web/src/templates/<id>/`** en copiant `classique/` : `index.ts` exporte la `TemplateDefinition` (`id`, `nameKey`, `beta`, `supportsTheme`, `media`, `settings`, `Component`), `<Nom>.tsx` le composant, `settings.ts` le schéma et le type des réglages. Le composant respecte la **règle du contrat** : fonction pure, **sans hook, sans gestionnaire d'événement, sans API serveur ou navigateur** (`useState`, `onClick`, `window`, `headers()`…), pour rendre à l'identique côté serveur et dans l'aperçu. Les textes fixes arrivent par `labels` (traduits par l'appelant), le thème par `theme` (variables CSS), les URL de vCard et de formulaire par `urls` (`urls.vcard`, `urls.eventForm(id)`). Poser **tous** les `TEMPLATE_TEST_IDS` (`card-name`, `card-job-title`, `card-company`, `card-description`, `card-email`, `card-phone`, `card-avatar`, `card-header-image`, `card-header-video`, `save-contact`, `card-link-<i>`, `event-button-<id>`) : les tests e2e ne se fient qu'à eux (TPL-003).
   **Événements** : la page publique donne au template les événements en cours dans `events` (`PublicEvent { id, title, startsAt }`) ; l'API les renvoie dans `card.events`, et la page les convertit avec `toPublicEvents` (`src/lib/public-card.ts`). Le template ne rend **que le bouton** de chacun : un lien (`<a>`) `data-testid={TEMPLATE_TEST_IDS.eventButton(event.id)}` vers `urls.eventForm(event.id)`, sans événement, rien ne s'affiche à leur emplacement (PUB-008 à PUB-010, PUB-029). Les boutons sont triés par début puis titre (`classique/` reprend ce tri) et animés (réglage `animate_events` dans `classique/`, `motion-safe:`). Il ne contient ni formulaire, ni code d'accès, ni consentement : le formulaire est **commun à tous les templates** (TPL-020), servi sur `/c/<slug>/e/<id>` (`frontend/web/src/app/c/[slug]/e/[eventId]/`, composants `src/components/event-form/`), et hérite seulement des variables CSS du thème de la carte. Voir `classique/Classique.tsx` pour un exemple.
2. **Utiliser les aides de sûreté partagées**, pas de code maison : `isHttpUrl` avant de mettre une adresse stockée dans un `href` (un lien qui n'est pas `http`/`https` ne produit aucune ancre, PUB-022), `mailtoHref` et `telHref` pour l'e-mail et le téléphone (PUB-021), `linkLabel` pour l'intitulé d'un lien. Un type de lien inconnu doit retomber sur l'icône et l'intitulé « site web » (TPL-016). La suite de contrat vérifie tout cela sur chaque template.
3. **Déclarer le template** : ajouter l'id à `TEMPLATE_IDS` (`ids.ts`, sans import React : le package e2e le lit) et la définition à `TEMPLATES` (`registry.ts`). `beta: true` tant qu'il est en test (TPL-006) : l'éditeur affiche alors l'étiquette « bêta ».
4. **Déclarer les réglages** dans le schéma de `settings.ts` (champs `select`, `boolean`, `range`, `color`, chacun avec `key`, `labelKey` et `default`) et les médias acceptés (`media: { header: ["image", "video"], avatar: true }`) : l'éditeur construit son formulaire à partir du schéma, sans code en plus (TPL-004). `parseSettings` ignore les clés inconnues et remplace une valeur invalide par la valeur par défaut (TPL-016) ; ne jamais relire les réglages bruts dans le composant.
5. **Traductions** : ajouter `templates.<id>.name` et `templates.<id>.settings.*` (une entrée par `labelKey`, y compris les options des `select`) dans `frontend/web/messages/fr.json`, avec les accents.
6. **Tests** :
   ```bash
   pnpm -C frontend --filter web exec vitest run src/templates   # la suite de contrat (contract.test.tsx) tourne sur le nouveau template
   make e2e ARGS="-g TPL-003"                                      # la boucle de public-page.spec.ts (TEMPLATE_IDS) le couvre
   ```
   Pour chaque template, cette boucle charge `api.seedEvents()`, donne ce template à la carte `alice-durand` (`api.updateCard`), l'affiche, vérifie le bouton d'événement (`event-button-<id>`), suit le lien jusqu'au formulaire commun (variable `--card-accent` du thème, présence du texte de consentement avec le nom de la carte), l'envoie et attend la confirmation (TPL-020, FRM-001, FRM-006). Un nouveau template entre dans la boucle sans toucher au test, mais doit poser le bouton avec le bon `data-testid` et le bon lien, sinon elle échoue.
   Ajouter un `<Nom>.test.tsx` à côté du composant pour ce qui lui est propre (réglages, variantes). Le nom d'un test cite sa règle (`TPL-004 …`).
7. **Vérifier** : `make lint test`, puis `make e2e` (les deux projets, `mobile` et `desktop`).

Rien d'autre à toucher : ni l'API, ni l'éditeur, ni la page publique ne nomment un template.
