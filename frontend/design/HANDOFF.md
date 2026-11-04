# Cartouche — dossier de design à implémenter

Brief pour Claude Code. Il décrit tout ce qui a été conçu (page publique de carte, thèmes, formulaire d'événement, tableau de bord) et les règles à respecter. En cas de doute, les maquettes du dossier `design/` font foi pour le visuel ; ce document fait foi pour le comportement.

## 0. Contenu du dossier

| Chemin | Rôle |
|---|---|
| `HANDOFF.md` | Ce document. |
| `tokens/app-tokens.css` | Tokens du tableau de bord (`--app-*`) + mapping Tailwind 4 `@theme inline`. Prêt à importer. |
| `tokens/card-classique.css` | Implémentation de référence du template de carte « Classique », pilotée uniquement par des variables `--c-*`. |
| `tokens/themes.json` | Les 8 thèmes prêts à l'emploi, les 4 paires de polices, les formes de boutons, les contrastes mesurés. |
| `design/*.dc.html` | Maquettes sources (export du canvas de design). Ouvrables pour lire le HTML/CSS ; voir § 0.1. |

### 0.1 Lire les maquettes `design/*.dc.html`

Ce sont des maquettes statiques au format « Design Component » : le CSS utile est dans `<helmet><style>`, le balisage dans `<x-dc>`. **Ignorer** : `<script src="./support.js">`, `<sc-for>` / `<sc-if>` (boucles et conditions de maquette), les `{{…}}` (données d'exemple), les URL `/_blob/…` (médias de démo hébergés dans le canvas), la classe `.b`, `.b-*`, `.f-d`, `.f-m` (cadres de présentation). Ne pas copier ces fichiers tels quels : s'en servir comme référence de structure, d'espacements et de textes.

| Fichier | Contenu |
|---|---|
| `Main.dc.html` | Page publique interactive (mobile), tous réglages de thème. |
| `Bureau.dc.html` | Page publique sur ordinateur (carte 28rem centrée). |
| `Etats.dc.html` | États de la page : 1/2/0 événement, chargement, sans photo, sans média, nom long, carte indisponible. |
| `Themes.dc.html`, `Valeurs.dc.html` | Planche des 8 thèmes ; tableau des valeurs. |
| `Formulaire.dc.html`, `FormulaireEtats.dc.html` | Formulaire de contact d'un événement (interactif) et ses états. |
| `AppTokens.dc.html` | Tokens et composants du tableau de bord. |
| `AppAcces.dc.html` | Connexion (habillage Clerk) et pages d'état du compte. |
| `AppCartes.dc.html` | Mes cartes, état vide, chargement, suppression, création. |
| `AppEditeur.dc.html` | Éditeur de carte (+ erreurs, contraste, quitter sans enregistrer). |
| `AppRecadrage.dc.html` | Recadrage en-tête (photo, vidéo) et photo de profil. |
| `AppEvenements.dc.html` | Événements d'une carte + éditeur d'événement. |
| `AppContacts.dc.html` | Contacts collectés, fiche, export, état vide. |
| `AppCompte.dc.html` | Mon compte, suppression du compte. |

## 1. Pile et contraintes

- React 19, Tailwind CSS 4, composants dans l'esprit shadcn/ui (Radix), icônes `lucide-react`.
- Aucune ressource externe à l'exécution : pas de CDN, pas de Google Fonts. Polices via `@fontsource-variable/*` (OFL 1.1).
- Textes en français, tutoiement dans le tableau de bord. Typographie française : espace insécable avant `: ; ? !`, guillemets « », apostrophe typographique ’.
- Accessibilité : contraste AA, cibles tactiles ≥ 44 px, focus visible, vraies étiquettes de champs, confirmations dans de vraies boîtes de dialogue (Radix `AlertDialog`), `prefers-reduced-motion` respecté.

## 2. Deux couches de tokens, jamais mélangées

1. **Tableau de bord** : `--app-*` (fichier `tokens/app-tokens.css`). Identité « Atelier » : papier `#F5F4F1`, encre `#1C1B19`, une seule couleur de marque ocre `#9A5B13` réservée au logo et à l'élément de navigation actif.
2. **Carte publique** : `--c-*`, posées sur la racine de la carte à partir du thème choisi. Elles ne doivent jamais être définies sur `:root` ni fuiter dans l'app.

Dans l'éditeur (aperçu) et dans les vignettes de « Mes cartes », les variables `--c-*` sont posées sur l'élément d'aperçu uniquement.

## 3. Thèmes de carte

Un thème = exactement : accent, fond (uni **ou** dégradé deux couleurs + angle), couleur du texte, intensité du fondu de l'en-tête (0–100), forme des boutons (`square` 2px / `rounded` 12px / `pill` 999px), paire de polices. Valeurs exactes : `tokens/themes.json`.

### 3.1 Du thème aux variables CSS

```ts
// Esquisse : à placer dans le module des thèmes
export function themeToCssVars(t: Theme, pair: FontPair): React.CSSProperties {
  const bg1 = t.background.type === 'solid' ? t.background.color : t.background.from;
  const bg2 = t.background.type === 'solid' ? t.background.color : t.background.to;
  const angle = t.background.type === 'solid' ? 180 : t.background.angle;
  return {
    '--c-accent': t.accent,
    '--c-on-accent': t.onAccent,          // calculé à l'enregistrement, voir 3.2
    '--c-bg': bg1, '--c-bg-2': bg2, '--bg-angle': `${angle}deg`,
    '--c-text': t.text,
    '--fade': String(t.headerFade),       // sans unité
    '--radius-btn': { square: '2px', rounded: '12px', pill: '999px' }[t.buttonShape],
    '--font-title': `'${pair.title} Variable', '${pair.title}', ${pair.title === 'Inter' ? 'system-ui, sans-serif' : 'Georgia, serif'}`,
    '--font-body': `'${pair.body} Variable', '${pair.body}', system-ui, sans-serif`,
    '--title-weight': String(pair.titleWeight),
    '--title-tracking': pair.titleTracking,
    '--c-danger': t.colorScheme === 'dark' ? '#FF8A80' : '#B3261E',
    colorScheme: t.colorScheme,           // pour que les sélecteurs de date natifs passent en sombre
  } as React.CSSProperties;
}
```

(Adapter les piles de secours des polices : serif pour Playfair et Fraunces, sans-serif pour les autres.)

### 3.2 Validation quand l'utilisateur ajuste un thème (bloquante)

Implémenter la formule de contraste WCAG 2.x (luminance relative sRGB) et `color-mix(in oklab, …)` côté JS pour les couleurs dérivées.

- `onAccent` = `#FFFFFF` ou `#111111`, celui qui contraste le plus avec l'accent ; si aucun n'atteint **4,5:1**, l'accent est refusé.
- Texte / fond ≥ **4,5:1** sur **les deux** couleurs du dégradé.
- Texte atténué (`--c-muted` = texte 78 % mélangé au fond) ≥ **4,5:1** sur une rangée survolée (texte à 12 % sur le fond), pour les deux couleurs du fond.
- Accent / fond ≥ **3:1** (icônes des liens, repérage des boutons).
- Si une règle échoue : message sous le réglage (« Texte illisible sur ce fond. Contraste 2,0:1, il faut au moins 4,5:1 »), bouton « Utiliser une couleur lisible », enregistrement impossible.

### 3.3 Polices

| Paire | Titre | Texte | Paquets |
|---|---|---|---|
| Sobre | Inter 700 | Inter | `@fontsource-variable/inter` |
| Éditoriale | Playfair Display 600 | Source Sans 3 | `@fontsource-variable/playfair-display`, `@fontsource-variable/source-sans-3` |
| Douce | Fraunces 600 | Nunito Sans | `@fontsource-variable/fraunces`, `@fontsource-variable/nunito-sans` |
| Graphique | Bricolage Grotesque 700 | Instrument Sans | `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/instrument-sans` |

Sous-ensembles `latin` (couvre déjà é è ê à ù ç œ Œ « » ’ et l'espace fine insécable) + `latin-ext` (noms étrangers). Sur la page publique, ne charger que la paire du thème de la carte. Vérifier que chaque paquet existe bien sous ce nom avant de l'ajouter.

## 4. Page publique — template « Classique »

Référence CSS : `tokens/card-classique.css`. Maquettes : `Main`, `Bureau`, `Etats`, `Themes`.

Ordre de haut en bas :
1. **En-tête** : image ou vidéo plein cadre, ratio 4:3. Le fondu vers le contenu est un **`mask-image`** dont la hauteur dépend de `--fade` (et non un voile coloré : ça fonctionne aussi sur fond dégradé).
2. **Photo de profil** ronde 112 px, à cheval sur la transition (`margin-top: -64px`), anneau de 4 px couleur `--c-bg`. Sans photo : initiales sur la couleur d'accent. Sans média : bandeau court (128 px) teinté par l'accent.
3. **Boutons d'événement** : un par événement en cours, couleur d'accent, petit libellé « Événement en cours » avec point animé + nom de l'événement + chevron. Animations (reflet, pulsation) coupées si `prefers-reduced-motion`. Deux événements : animations décalées de 1,6 s. Zéro événement : rien n'est rendu. Le bouton ouvre le formulaire de l'événement.
4. **Identité** : nom (police de titre, jamais tronqué, `text-wrap: balance`), poste, entreprise (texte atténué), description courte.
5. **« Enregistrer le contact »** (télécharge une vCard) : **juste sous l'identité**, en couleurs inversées (fond = texte, texte = fond).
6. **Coordonnées** : e-mail et téléphone en rangées (`mailto:`, `tel:`).
7. **Liens** : par défaut **en icônes** (rangée de boutons 48 px, `aria-label` = « Instagram — @compte ») ; les **liens libres gardent une rangée avec leur intitulé** sous les icônes. Disposition « liste » disponible en réglage du template.

Vidéo d'en-tête :
- Muette, en boucle, `playsInline`, avec `poster` (image d'attente). En React, `muted` doit être posé **sur la propriété DOM** (ref : `el.muted = true` puis `el.play()`), sinon la lecture automatique est bloquée.
- Bouton pause/lecture 44 px en haut à droite (exigence WCAG 2.2.2), libellé « Mettre la vidéo en pause » / « Lire la vidéo ».
- `prefers-reduced-motion` : pas de lecture automatique, l'image d'attente reste.
- Pendant le chargement : affiche floutée + reflet (`.cc-shimmer`), `aria-busy`.

Mise en page : sur mobile la carte remplit l'écran ; dès que le conteneur fait 40rem, carte de **28rem** centrée, coins 28 px, ombre, fond de page = fond de carte assombri de 14 %.

Carte désactivée **ou** inexistante : même page neutre « Cette carte n'est pas disponible », même code **HTTP 404**, `noindex`, aucune information sur le propriétaire.

Icônes de marque : lucide n'a ni TikTok ni X et ses icônes de marques sont dépréciées → utiliser Simple Icons (CC0) ou les icônes de marques de Tabler, dessinées au même trait.

## 5. Formulaire d'un événement (public)

Maquettes : `Formulaire`, `FormulaireEtats`. Ouvert par le bouton d'événement de la carte.

- Retour vers la carte (avatar + nom), bandeau à la couleur d'accent avec « Événement en cours », titre et description de l'événement.
- « Tous les champs sont obligatoires, sauf mention « facultatif » » (on marque le facultatif, pas l'obligatoire).
- Section « Vos coordonnées » (champs standards selon la config de l'événement), section « Votre projet » (champs personnalisés), case de consentement obligatoire, bouton « Envoyer mes coordonnées » (accent), mention « Vos informations sont transmises uniquement à … ».
- Champs : 52 px de haut, `font-size: 16px` (évite le zoom iOS), bord `--c-field-border`, sélecteurs natifs pour date et nombre (`inputMode`), `autoComplete` renseigné.
- Validation à l'envoi : récapitulatif en haut (`role="alert"`, « Vos coordonnées n'ont pas été envoyées : 3 champs sont à corriger. »), message sous chaque champ (`aria-invalid`, `aria-describedby`), focus sur le premier champ en erreur. Messages exacts dans `Formulaire.dc.html`.
- Confirmation : « Merci Inès, c'est envoyé ! » + bouton « Enregistrer le contact de Camille » + « Retour à la carte ».
- Si l'événement a un code d'accès, le demander avant le formulaire (écran non dessiné : un seul champ + bouton, mêmes styles).

## 6. Tableau de bord

Coquille (ordinateur) : barre latérale 248 px (logo, navigation Mes cartes / Contacts / Mon compte, utilisateur en bas), barre haute 68 px avec fil d'Ariane dans les écrans d'une carte, contenu max 1160 px. Mobile : barre d'app 56 px (retour + titre + action), **barre d'onglets en bas** à 3 entrées ; dans l'éditeur et les formulaires, la barre d'onglets est remplacée par une barre « Enregistrer » collante.

Les maquettes `AppEvenements`, `AppContacts`, `AppCompte` utilisent les **mêmes balises** pour ordinateur et mobile, réarrangées par **requêtes de conteneur** (`container-type: inline-size` sur la zone principale, bascule à 600 px). Reprendre ce principe avec `@container` de Tailwind 4.

Composants Radix/shadcn à utiliser : `Dialog`, `AlertDialog` (confirmations), `Sheet` (fiche contact sur ordinateur, feuilles du bas sur mobile), `DropdownMenu` (actions d'une carte), `Select`, `Switch`, `Tabs`, `Slider`, `RadioGroup` (sélecteurs segmentés), toasts (Sonner). Styles : voir `AppTokens.dc.html`.

### 6.1 Connexion (Clerk) — `AppAcces`

Habillage : ordinateur en deux colonnes (à gauche accroche « Ta carte de visite, toujours à jour. », trois arguments, aperçu de vraie carte ; à droite le composant Clerk), mobile en une colonne. Liens CGU et Politique de confidentialité sous le bloc.

```ts
// appearance Clerk (noms de variables en vigueur depuis juillet 2025)
export const clerkAppearance = {
  variables: {
    colorPrimary: '#1C1B19', colorPrimaryForeground: '#FFFFFF',
    colorForeground: '#1C1B19', colorMutedForeground: '#5C5850',
    colorBackground: '#FFFFFF', colorInput: '#FFFFFF', colorInputForeground: '#1C1B19',
    colorBorder: '#8C877E', colorNeutral: '#1C1B19', colorRing: '#1C1B19', colorShadow: '#1C1B19',
    colorDanger: '#B3261E', colorSuccess: '#1D6B43', colorWarning: '#8A4500',
    colorModalBackdrop: 'rgb(28 27 25 / .5)',
    borderRadius: '0.625rem',
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    fontFamilyButtons: "'Inter Variable', Inter, system-ui, sans-serif",
    fontSize: '0.9375rem',
    fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  },
  elements: {
    // à ajuster selon la version : hauteur minimale 44 px des champs et boutons
    formFieldInput: { minHeight: '44px' },
    formButtonPrimary: { minHeight: '44px' },
    socialButtonsBlockButton: { minHeight: '44px' },
  },
};
```

Vérifier les noms d'`elements` dans la documentation de la version installée de Clerk.

### 6.2 États du compte — `AppAcces`

Trois pages courtes, centrées, avec bouton « Se déconnecter » : en attente (« Ton compte est en attente de validation », e-mail de l'utilisateur rappelé), refusé (+ « Contacter le support »), suspendu (+ « Contacter le support »). Textes exacts dans la maquette. L'adresse du support est à fournir.

### 6.3 Mes cartes — `AppCartes`

- Liste : vignette aux couleurs de la carte (variables `--c-*` sur la vignette), nom + poste, lien public en police mono + bouton « Copier » (toast « Lien copié »), badge d'état (`Active` succès, `Désactivée` neutre, `Désactivée par le support` attention + lien support), lien « Événements » avec résumé (« 1 en cours · 1 à venir »), « Modifier » + menu (Ouvrir la page publique, Dupliquer, Désactiver/Réactiver, Supprimer…).
- Carte désactivée par le support : ni modifiable ni réactivable par l'utilisateur.
- Suppression : `AlertDialog` qui annonce le nombre d'événements et de contacts supprimés et prévient que les tags NFC/QR afficheront la page « indisponible ».
- État vide : « Crée ta première carte » + un seul bouton. Chargement : squelettes.
- Création : prénom, nom, lien proposé `cartouche.jicorp.fr/c/prenom-nom` (préfixe affiché, partie modifiable en mono), vérification de disponibilité à la saisie (succès « Ce lien est disponible. » / erreur « Ce lien est déjà pris » + 3 suggestions cliquables). Rappel : le lien sera inscrit dans les tags NFC et QR codes.

### 6.4 Éditeur de carte — `AppEditeur` (écran principal)

- Ordinateur : formulaire à gauche (onglets d'ancrage Identité · Coordonnées · Liens · Médias · Apparence), aperçu en direct à droite dans un cadre de téléphone (le vrai composant de carte), interrupteur « Simuler un événement en cours ».
- Mobile : onglets segmentés **Modifier / Aperçu**, sections repliables avec résumé, barre « Enregistrer » collante.
- Sections : Identité (prénom, nom, poste, entreprise, description) ; Coordonnées (e-mail, téléphone) ; Liens (réseaux connus avec icône + liens libres intitulé/adresse, **réordonnables** à la souris et au clavier : poignée focalisable, flèches haut/bas, annonce `aria-live`) ; Médias (en-tête, photo de profil, boutons Recadrer / Remplacer / Retirer) ; Template (Classique + réglage « Disposition des liens » Icônes/Liste) ; Thème (8 vignettes puis réglages : accent, fond uni/dégradé + 2 couleurs + angle, texte, intensité du fondu, forme des boutons, paire de polices, état du contraste en direct).
- Rien n'est publié avant « Enregistrer ». Badge « Modifications non enregistrées » dès qu'il y a une différence. Erreurs : récapitulatif avec liens vers les champs + message sous chaque champ ; contraste insuffisant bloquant (§ 3.2).
- Quitter avec des modifications (navigation interne **et** `beforeunload`) : `AlertDialog` « Quitter sans enregistrer ? » avec Rester / Quitter sans enregistrer / Enregistrer et quitter.
- Toast après enregistrement : « Carte enregistrée et publiée ».

### 6.5 Recadrage des médias — `AppRecadrage`

- En-tête (photo ou vidéo) : cadre 4:3 fixe, on déplace et on zoome le média ; grille des tiers ; **zones couvertes en pointillés** (fondu selon `--fade`, emplacement de la photo de profil, bouton pause), désactivables ; aperçu « Sur ta carte ». S'ouvre aussi automatiquement après l'envoi d'un fichier qui n'est pas en 4:3.
- Vidéo : frise de vignettes avec tête de lecture, poignées de début/fin de l'extrait en boucle, case « Utiliser l'image affichée comme image d'attente ».
- Photo de profil : masque rond, aperçus à 112 px et 36 px.
- Clavier : flèches = déplacer, + / − = zoom. Poignées de 16 px visibles mais zone tactile de 44 px. Mobile : plein écran, pincer pour zoomer.
- Données : conserver l'original et stocker le recadrage en proportions de l'original `{ x, y, width, height }` (0–1), plus `{ start, end }` en secondes et `posterTime` pour la vidéo. Le serveur génère les fichiers finaux, ce qui permet de recadrer à nouveau.

### 6.6 Événements — `AppEvenements`

- Trois groupes : En cours, À venir, Passés. Pour chacun : titre, début, fin ou « Sans fin », badge d'état, nombre de contacts (lien), Modifier, « Terminer » (seulement en cours), Supprimer.
- Suppression : `AlertDialog` « Supprimer « … » ? » qui annonce « Les 57 contacts collectés pendant cet événement seront supprimés avec lui », propose « Exporter les contacts », bouton « Supprimer l'événement et 57 contacts ».
- Limite : 3 événements en cours par carte. Message quand elle est atteinte ; programmer un événement à venir reste possible.
- État vide (« Aucun événement ») avec bouton de création.
- Éditeur : titre, description ; début et fin (date + heure) avec le fuseau affiché (« Fuseau : Europe/Paris »), interrupteur « Sans fin » ; code d'accès facultatif affiché en clair ; envois par appareil (défaut 1) ; champs standards (Prénom et nom, E-mail, Téléphone, Entreprise, Message), chacun Non demandé / Facultatif / Obligatoire ; champs personnalisés réordonnables avec type (texte, texte long, date, nombre, choix unique avec liste de choix, case à cocher), libellé, aide, obligatoire ; aperçu de la case de consentement. Panneau d'état (En cours, voir les contacts, Terminer maintenant, Supprimer).

### 6.7 Contacts — `AppContacts`

- Filtre par carte, puis vue « Toute la carte » ou par événement (onglets sur ordinateur, menu sur mobile) ; recherche nom / e-mail / téléphone ; tri du plus récent au plus ancien.
- Colonnes : date, nom, e-mail, téléphone, événement, badge « Spam » (le contact reste lisible, grisé).
- Fiche : `Sheet` latéral sur ordinateur, page sur mobile. Coordonnées cliquables, toutes les réponses, consentement (date et heure + texte exact accepté). Actions : Marquer / Retirer le marquage spam (toast avec « Annuler »), Supprimer (confirmation).
- Export : CSV / XLSX / JSON de la vue courante, case « Inclure les contacts marqués comme spam (n) » décochée par défaut, le bouton annonce le nombre exact. Une ligne par contact, une colonne par champ (personnalisés et consentement compris).
- État vide : « Aucun contact pour l'instant » + lien vers les événements.

### 6.8 Mon compte — `AppCompte`

Profil (géré par Clerk), « Gérer l'e-mail et la connexion », « Se déconnecter ». Zone de suppression : récapitulatif chiffré (cartes, événements, contacts), « Exporter mes contacts d'abord », puis `AlertDialog` de confirmation forte : liste de ce qui disparaît + saisie du mot **SUPPRIMER** pour activer le bouton.

## 7. Médias : formats et traitement

| | En-tête photo | En-tête vidéo | Photo de profil |
|---|---|---|---|
| Ratio | 4:3 | 4:3 | 1:1 |
| Sortie | 1440 × 1080, AVIF/WebP + JPEG, variantes 750/1125/1440 | 1280 × 960 (960 × 720 suffit), H.264, sans audio, 24–30 i/s | 512 × 512 WebP/JPEG |
| Poids visé | < 200 Ko | < 2 Mo, + affiche JPEG/WebP | < 40 Ko |

```bash
ffmpeg -i source.mp4 -ss START -to END -an \
  -vf "crop=W:H:X:Y,scale=1280:960,fps=30" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset slow \
  -movflags +faststart entete.mp4
ffmpeg -ss POSTER_TIME -i source.mp4 -frames:v 1 -vf "crop=W:H:X:Y,scale=1280:960" -q:v 3 entete-poster.jpg
```

## 8. Points encore ouverts

- Le formulaire public dessiné contient un champ « date et heure » ; ce type n'est pas dans la liste des champs personnalisés. Soit l'ajouter, soit le retirer.
- Écran du code d'accès d'un événement : non dessiné (un champ + un bouton).
- Adresse du support et URL des CGU / de la politique de confidentialité à fournir.
- Base légale RGPD du consentement à confirmer (case obligatoire retenue dans les maquettes).

## 9. Ordre d'implémentation conseillé

1. Tokens de l'app + polices + composants de base (bouton, champ, badge, dialogues, toasts).
2. Module des thèmes (`themes.json`, `themeToCssVars`, validation des contrastes) avec tests unitaires des ratios du tableau `contrastChecks`.
3. Composant de carte Classique + page publique + page indisponible + vCard.
4. Formulaire public d'événement.
5. Connexion Clerk et états du compte.
6. Mes cartes, création, éditeur de carte avec aperçu, recadrage.
7. Événements, contacts, export, Mon compte.
