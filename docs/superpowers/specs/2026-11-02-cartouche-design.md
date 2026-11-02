# Cartouche — Document de design initial

> Date : 2026-11-02 · Statut : brouillon à valider
> Ce document fixe les bases du projet. Une fois validé, son contenu produit sera éclaté dans le dossier `spec/` (la référence vivante) et servira à écrire le plan d'implémentation.
>
> Convention : ce qui est marqué **(choix Claude)** est une décision prise par Claude, pas par le porteur du projet. À contester librement.

---

## 1. Intention

**Cartouche** — « des cartes pour toucher les gens ».

Sur les salons, les cartes de visite papier finissent perdues ou à la poubelle, et récupérer les coordonnées des prospects crée une file d'attente devant l'unique tablette du stand, avec des fautes de frappe à la clé.

Cartouche remplace tout ça par une **carte de visite digitale** :

- Le prospect approche son téléphone d'une carte NFC (ou scanne un QR code). Une page web s'ouvre avec le profil du porteur de la carte et un bouton pour l'ajouter à ses contacts.
- Pendant un **événement** (un salon), cette même page propose un formulaire. Chaque prospect saisit **lui-même** ses coordonnées sur **son propre téléphone**. C'est scalable (pas de file d'attente) et ça évite les fautes de frappe.
- Le porteur retrouve ensuite ses contacts dans un tableau de bord et les exporte (CSV, Excel, JSON) vers Notion, un CRM ou un LLM.

**Pourquoi open source (MIT) :** les solutions existantes vendent très cher quelque chose de simple. Cartouche doit être gratuit, auto-hébergeable facilement, et aussi abouti visuellement que les produits payants.

## 2. Utilisateurs

Par ordre de priorité :

1. **Le porteur du projet et un ami**, sur une instance hébergée sur un VPS OVH (vps-1). Chacun gère son propre espace, totalement isolé de celui de l'autre.
2. **Des auto-hébergeurs**, qui récupèrent le dépôt et déploient leur instance (`docker compose up` + un fichier de config + une doc claire).
3. **Des inscrits sur l'instance publique**, qui ne veulent pas héberger eux-mêmes. Ils créent simplement un compte.

Il y a aussi les **prospects** : visiteurs anonymes de la page publique, sur mobile, souvent sur un Wi-Fi de salon médiocre.

Il y a aussi les **administrateurs (support)** de l'instance. Ils valident les inscriptions et peuvent tout consulter pour aider ou modérer (voir 5.8).

Il n'y a pas d'équipes ni d'espaces partagés. Un utilisateur ne voit que ses propres données ; seul un administrateur voit tout.

## 3. Objectifs, non-objectifs, anti-objectifs

### Objectifs (v1)
- Créer un compte, gérer une ou plusieurs cartes digitales, chacune avec son lien public stable.
- Personnaliser chaque carte (template, thème, médias, contenu), avec un aperçu en direct.
- Page publique rapide et belle sur mobile, avec ajout aux contacts (vCard).
- Déclarer des événements datés sur une carte, avec un formulaire de collecte configurable.
- Consulter, nettoyer et exporter les contacts collectés (CSV, XLSX, JSON).
- Base de tests solide (unitaires, intégration, bout en bout) et environnement reproductible avec des données de test, pilotable par un agent.
- Dossier `spec/` comme référence du comportement produit.
- Inscription ouverte, mais soumise à validation par un administrateur, avec une page de support.

### Non-objectifs (v1, à garder possibles plus tard)
- Connexion intégrée par email et mot de passe, ou serveur d'identité embarqué. Les auto-hébergeurs utilisent Clerk ou leur propre fournisseur OIDC.
- Déploiement automatique : en v1, le déploiement est manuel.
- Copie des sauvegardes hors du serveur (à traiter plus tard).
- Paiement et abonnements.
- Envoi de cartes NFC physiques et tutoriels de commande.
- Synchronisation directe vers Notion ou webhooks à chaque nouveau contact. Le format des données doit rendre ces ajouts simples.
- Puces NFC à URL dynamique signée (NTAG 424 DNA / SUN), qui prouveraient la présence physique.
- Statistiques de consultation des cartes.
- Équipes et partage de cartes entre utilisateurs. Il n'y a que deux rôles : utilisateur et administrateur.
- Écriture de puces NFC depuis le navigateur (Web NFC). En v1, l'utilisateur copie le lien dans une app comme NFC Tools.

### Anti-objectifs (échec même si « ça marche »)
- Un rendu générique ou moche : Cartouche doit pouvoir rivaliser visuellement avec les offres payantes.
- Une installation pénible pour un auto-hébergeur.
- Un utilisateur qui voit, même partiellement, les données d'un autre.
- Un lien de carte qui casse : un lien imprimé ou écrit sur une puce NFC doit fonctionner indéfiniment, tant que la carte existe.
- Un formulaire pénible pour le prospect (lent, mal adapté au mobile, qui perd la saisie).
- Des accents corrompus où que ce soit. Le public est francophone.

## 4. Concepts du domaine

| Concept | Définition |
|---|---|
| **Utilisateur** | Titulaire d'un compte. Identifié par le `sub` du JWT de son fournisseur d'identité (avec Clerk, c'est l'identifiant utilisateur Clerk, `user_…`), et enregistré dans la table `users` à la première connexion. Il a un **statut** : `en attente`, `validé`, `refusé` ou `suspendu`. |
| **Administrateur** | Un utilisateur dont l'identifiant figure dans la configuration de l'instance. Il valide les inscriptions et peut tout consulter. |
| **Carte** | Une carte de visite digitale. Appartient à un utilisateur. Possède un slug (lien public), un template, des réglages de thème, des médias, un contenu et un état actif/désactivé. |
| **Template** | La mise en page complète d'une carte publique (structure, disposition, animations). C'est du code dans le dépôt. |
| **Thème** | Les réglages visuels appliqués à l'intérieur d'un template (couleurs, police, styles). Ce sont des données. |
| **Événement** | Une période de collecte de contacts rattachée à une carte : titre, description, début, fin optionnelle, champs du formulaire, code d'accès optionnel, limite d'envois par appareil. |
| **Contact collecté** (*lead*) | Une soumission du formulaire d'un événement par un prospect. |

## 5. Comportements produit

### 5.1 Le lien public d'une carte
- Format : `https://<domaine>/c/<slug>`. Le slug est choisi par l'utilisateur ; une proposition est faite à partir de son nom.
- Un slug est unique sur l'instance.
- **Le lien ne casse jamais.** Si l'utilisateur change le slug, tous les anciens slugs de la carte redirigent de façon permanente vers le nouveau. Un ancien slug reste réservé à cette carte, personne d'autre ne peut le prendre.
- **Désactiver une carte** : le propriétaire peut désactiver ou réactiver une carte à tout moment depuis le tableau de bord, en un clic.
  - Une carte désactivée affiche à son lien une page neutre « Cette carte n'est plus active », et non une erreur 404. La vCard et les formulaires d'événement sont inaccessibles, y compris pour un événement encore en cours, et le serveur refuse les envois.
  - Les données (contenu, événements, contacts collectés) sont conservées, et restent visibles et exportables dans le tableau de bord.
  - Réactiver la carte remet le même lien en service, sans rien changer d'autre.
  - **Désactivation par le support** : c'est un état distinct. La carte affiche la même page neutre côté public, mais le propriétaire voit dans son tableau de bord « Désactivée par le support » et **ne peut pas la réactiver lui-même**. Seul un administrateur peut lever ce blocage **(choix Claude)**.
- **Carte supprimée :** suppression définitive après confirmation. Le lien affiche la même page neutre. Les slugs restent réservés et ne sont jamais réattribués à quelqu'un d'autre **(choix Claude)**, pour éviter qu'une vieille puce NFC pointe vers la carte d'un inconnu. Le même utilisateur peut rattacher l'un de ses slugs réservés à une nouvelle carte.
- **Compte supprimé :** les slugs de l'utilisateur sont conservés uniquement sous forme d'**empreinte (hash)** dans une table de slugs bloqués, sans lien avec une personne. Ils restent bloqués définitivement, et plus personne, y compris l'ancien utilisateur, ne peut les reprendre **(choix Claude)**. Aucune donnée personnelle n'est conservée, et aucun ancien lien ne peut pointer vers un inconnu.
- Le tableau de bord propose de **copier le lien** et de **télécharger un QR code** (SVG et PNG) **(choix Claude)**.

### 5.2 La page publique (template « Classique », le template de référence)
Pensée pour le mobile d'abord. Le visuel final sera conçu avec Claude Design.

1. **En-tête** : une image ou une vidéo en pleine largeur. La vidéo est muette, en lecture automatique et en boucle, avec `playsinline` pour qu'elle ne passe jamais en plein écran sur iOS. Une image d'attente s'affiche pendant le chargement.
2. **Transition** : un dégradé fond l'en-tête dans le contenu. La **photo de profil** (ronde) est centrée sur ce dégradé, à cheval entre le média et le contenu.
3. **Bouton(s) d'événement** : si un ou plusieurs événements sont en cours, chacun apparaît comme un bouton très visible, animé, portant le nom de l'événement (« Salon du Mariage Clermont 2027 »). Les boutons sont triés par date de début. Sans événement en cours, il n'y a rien à cet endroit.
4. **Informations** : nom, poste, entreprise, description, coordonnées.
5. **Liens** cliquables avec leur icône : site perso, LinkedIn, Instagram, Facebook, TikTok, YouTube, X, plus des liens libres avec un intitulé. Ils ouvrent l'application native quand elle est installée.
6. **Bouton « Enregistrer le contact »** : télécharge une vCard (`.vcf`, vCard 3.0, UTF-8) avec la photo incluse. Elle contient uniquement les éléments visibles sur la carte.
7. **Aperçu de lien** (balises OpenGraph) : nom, poste et photo, pour un bel aperçu quand le lien est partagé (WhatsApp, LinkedIn…).

### 5.3 Le formulaire d'événement (côté prospect)
- Un clic sur le bouton d'événement ouvre le formulaire **en plein écran**, avec un bouton retour vers la carte.
- **Si l'événement a un code d'accès**, un écran demande le code *avant* le formulaire. La comparaison ignore la casse, les espaces en début et fin, et les accents. Le code est vérifié par le serveur et n'est jamais envoyé au navigateur. Il est aussi revérifié au moment de l'envoi : si le propriétaire l'a changé entre-temps, le prospect doit saisir le nouveau.
- Contenu du formulaire : titre et description de l'événement, puis les champs standards activés, puis les champs personnalisés.
- **Consentement obligatoire** : une case à cocher avec un texte de mentions légales. Un texte par défaut (en français, conforme à l'esprit du RGPD) est fourni et peut être remplacé par événement. On enregistre l'horodatage du consentement et **le texte exact accepté**.
  - **Le responsable des données est le propriétaire de la carte**, pas l'opérateur de l'instance **(choix Claude)**. Le texte par défaut est donc rempli automatiquement avec le nom ou l'entreprise et l'email de la carte. Il précise la finalité (recontact commercial lié à l'événement) et le droit d'accès et de suppression.
  - **Durée de conservation** : le texte par défaut ne s'engage sur aucune durée chiffrée. En v1, il n'y a pas de suppression automatique ; la suppression reste manuelle **(choix Claude)**. Une purge automatique configurable est une piste pour plus tard.
- **Validation** : email valide ; téléphone validé et normalisé au format international E.164, la France étant le pays par défaut ; dates valides. Les erreurs s'affichent à côté de chaque champ, et la saisie n'est jamais perdue.
- **Après l'envoi** : un écran de confirmation, qui propose d'enregistrer la vCard du porteur, puis un retour à la carte.
- **Le formulaire est accessible** : libellés, navigation au clavier, types de clavier mobile adaptés (`type="email"`, `inputmode="tel"`…).

### 5.4 Les champs du formulaire
- **Champs standards** que l'on peut cocher : prénom, nom, date de naissance, email, téléphone, adresse postale. L'adresse postale se décompose en rue, code postal, ville et pays.
- Chaque champ coché peut être **obligatoire ou facultatif** **(choix Claude)**.
- **Champs personnalisés** (autant que voulu, ordonnables), avec un libellé, un type, un caractère obligatoire ou non, et un texte d'aide optionnel. Les types sont : `texte`, `texte long`, `date`, `nombre`, `choix unique` (avec une liste d'options) et `case à cocher` **(choix Claude : le porteur a cité texte et date, les autres sont des ajouts)**.
- **Modifier les champs alors que des contacts existent déjà** : ça ne doit jamais casser les contacts existants. Chaque contact conserve ses réponses avec le libellé et le type du champ au moment de l'envoi. Un champ supprimé reste visible sur les anciens contacts et dans les exports.

### 5.5 Les événements (côté propriétaire)
- Un événement appartient à une carte. Il a un titre, une description, une date de **début** (obligatoire) et une date de **fin** (optionnelle).
- **Il est en cours** si `début <= maintenant` et (`fin` absente ou `maintenant < fin`). Une fin absente signifie que l'événement dure jusqu'à sa clôture manuelle.
- **Plusieurs événements peuvent être en cours en même temps sur une carte**, avec une limite : **au plus 3 événements simultanés** à n'importe quel instant. Le chiffre est réglable dans la configuration de l'instance. La règle est vérifiée à chaque création ou modification, en calculant le chevauchement maximal sur toute la période de l'événement (une fin absente compte comme l'infini).
- **Clôture rapide** : un bouton « Terminer maintenant » fixe la fin à l'instant présent.
- **Fuseau horaire** : les dates sont saisies et affichées dans le fuseau de l'utilisateur (Europe/Paris par défaut) et stockées en UTC.
- **Envoi juste après la fin** : un formulaire ouvert pendant l'événement peut encore être envoyé **jusqu'à 15 minutes après la fin** **(choix Claude)**, pour ne pas perdre un prospect en train de remplir.
- **Code d'accès** : optionnel, modifiable à tout moment, stocké de façon à pouvoir être réaffiché au propriétaire. Ce n'est pas un mot de passe de compte, c'est un code temporaire affiché sur le stand.
- **Limite d'envois par appareil** : réglable par événement, **1 par défaut** **(choix Claude)**. L'appareil est reconnu par un identifiant aléatoire conservé dans un cookie et dans le stockage local. C'est une protection légère, assumée : elle se contourne en navigation privée.

### 5.6 Protections anti-abus (toujours actives)
- Une **limite large par adresse IP** sur les envois, seulement pour stopper les rafales automatiques. Sur un salon, des dizaines de prospects partagent la même IP du Wi-Fi.
- Un **champ piège** invisible : un envoi qui le remplit est ignoré silencieusement.
- Dans le tableau de bord, le propriétaire peut **marquer un contact comme spam** ou le **supprimer**.

### 5.7 Le tableau de bord
- **Compte** : connexion et inscription via le fournisseur d'identité, déconnexion, et suppression du compte qui supprime toutes les données de l'utilisateur.
- **Cartes** : liste, création, édition, duplication **(choix Claude)**, désactivation et réactivation, suppression.
- **Éditeur de carte** : un formulaire à gauche et un **aperçu en direct dans un cadre de téléphone** à droite (empilés sur mobile). L'aperçu se met à jour à chaque modification, sans enregistrer. Un interrupteur simule « événement en cours ». Les changements ne sont publiés qu'à l'enregistrement.
- **Événements** d'une carte : liste (en cours, à venir, passés), création, édition, clôture, suppression.
- **Contacts collectés** : liste par événement (et vue « toute la carte »), recherche, vue détaillée, marquage spam et suppression. La suppression sert aussi à répondre à une demande d'effacement RGPD.
- **Exports** par événement ou pour toute la carte :
  - **CSV** en UTF-8 **avec BOM**, pour que les accents s'affichent correctement dans Excel, et compatible avec l'import de Notion ;
  - **XLSX** natif ;
  - **JSON** structuré, qui conserve les types des champs (idéal pour un LLM).
  - Une ligne par contact. Les colonnes sont, dans l'ordre : les champs standards, les champs personnalisés, puis les métadonnées (événement, date d'envoi, consentement, texte du consentement, spam). Les contacts marqués spam sont exclus par défaut, avec une option pour les inclure.

### 5.8 Inscription, validation et support (administrateur)
- **Désigner un administrateur** : par configuration (`ADMIN_USER_IDS`), une liste d'identifiants utilisateur, c'est-à-dire le `sub` du jeton (l'identifiant utilisateur Clerk par défaut). Il n'y a pas d'écran pour nommer un administrateur : c'est l'opérateur de l'instance qui décide. Un administrateur est automatiquement validé.
- **Inscription** : n'importe qui peut créer un compte via le fournisseur d'identité. Le compte Cartouche est alors **en attente**. L'utilisateur voit une page « Ton compte est en attente de validation » et ne peut rien créer.
- **Mode d'inscription réglable** (`SIGNUP_MODE`) **(choix Claude)** :
  - `approval` (par défaut) : validation par un administrateur ;
  - `open` : validation automatique ;
  - `closed` : nouvelles inscriptions refusées.
  Un auto-hébergeur seul peut ainsi éviter l'étape de validation.
- **La page de support** (réservée aux administrateurs) permet de :
  - voir les utilisateurs par statut, avec un compteur des comptes en attente bien visible ;
  - **valider** ou **refuser** une inscription ;
  - **suspendre** ou **réactiver** un compte. Un compte suspendu ne peut plus se connecter au tableau de bord, et toutes ses cartes affichent la page neutre « Cette carte n'est plus active » ;
  - **tout consulter** pour un utilisateur donné : son profil, ses cartes, ses événements et ses contacts collectés (en lecture seule) ;
  - **désactiver une carte abusive**, puis lever ce blocage (voir 5.1).
- Les administrateurs ne modifient pas le contenu des utilisateurs : ils peuvent seulement le consulter, désactiver une carte, et valider, refuser ou suspendre un compte **(choix Claude)**.
- **Journal d'audit** **(choix Claude)** : chaque action et chaque consultation des contacts d'un autre utilisateur par un administrateur est enregistrée (qui, quoi, quand). Ce sont des données personnelles de prospects, il faut pouvoir le justifier.
- **Notification des nouvelles inscriptions** : hors v1. L'administrateur consulte la page de support.
- **Pages CGU et confidentialité** : deux pages statiques dont le contenu est fourni par l'opérateur (fichiers Markdown dans la configuration), avec un modèle par défaut. Elles sont liées depuis la landing page et l'inscription **(choix Claude)**.

### 5.9 La landing page
Une page publique de présentation du produit, avec un appel à l'inscription et un lien vers le dépôt GitHub. Elle sera conçue avec Claude Design.

## 6. Personnalisation : templates et thèmes

### 6.1 Templates
- Un template est un **composant React versionné dans le dépôt**. Les utilisateurs ne peuvent pas envoyer de HTML ou de code libre (ce serait une faille de sécurité).
- Tous les templates respectent le **même contrat** : ils reçoivent la carte, le thème résolu, les événements en cours et les points d'accès au formulaire et à la vCard. Les comportements de la section 5 (bouton d'événement, vCard, formulaire, consentement) sont garantis quel que soit le template, et la suite de tests de bout en bout tourne sur **chaque** template.
- Chaque template **déclare ses réglages** (un schéma : couleurs, médias acceptés, options propres). L'éditeur génère son formulaire à partir de ce schéma, donc ajouter un template ne demande pas de modifier l'éditeur.
- Chaque carte choisit librement son template. Un template peut porter l'étiquette **« bêta »** (template en test), affichée dans l'éditeur. Tous les templates sont accessibles à tous.
- En v1, on livre le template **Classique** décrit en 5.2, et l'architecture doit rendre facile l'ajout d'un deuxième.

### 6.2 Thème (dans un template qui le supporte)
- **Des thèmes prêts à l'emploi** (6 à 8), qui servent de point de départ et seront conçus avec Claude Design.
- **Des réglages par-dessus** : couleur d'accent, fond (couleur unie ou dégradé), couleur du texte, intensité du dégradé de l'en-tête, forme des boutons.
- **La police** : choix dans une liste courte de paires titre/texte, toutes avec un bon support des accents, et **auto-hébergées** (aucun appel à Google Fonts).
- **Un avertissement de contraste** si le texte devient illisible sur le fond.

### 6.3 Médias
- **Un fond d'en-tête par carte**, image ou vidéo. La vidéo est au format MP4, limitée à **30 s et 25 Mo** **(choix Claude)**. Une image fixe est capturée dans le navigateur au moment de l'envoi (via un canvas) et sert d'image d'attente. Il n'y a pas de transcodage côté serveur en v1, pour ne pas surcharger le VPS.
- **Une photo de profil par carte**, recadrée en cercle dans l'éditeur.
- Les images sont redimensionnées en plusieurs tailles et converties en **WebP** côté serveur, et leurs métadonnées EXIF (dont la position GPS) sont supprimées.
- Les types sont vérifiés à partir du contenu réel du fichier, pas seulement de son extension.

## 7. Architecture technique

### 7.1 Vue d'ensemble
```
Navigateur ──► Reverse proxy existant (Caddy unique du VPS, HTTPS auto)
                ├── /            → web (Next.js : landing, page publique, dashboard, support)
                ├── /api/*       → api (Rust/Axum)
                └── /media/*     → api (sert les médias, avec des en-têtes de cache longs)
api ──► PostgreSQL
api ──► Stockage objets (disque local par défaut, S3-compatible en option)
web & api ──► Sentry (optionnel, désactivé si aucun DSN)
```

### 7.2 Backend (Rust)
- **Axum** et Tokio pour le serveur web. **SQLx** pour l'accès à Postgres, avec requêtes vérifiées à la compilation et migrations versionnées.
- **OpenAPI** générée depuis le code (`utoipa`). C'est le contrat de l'API.
- **Stockage** via le crate `object_store` : le disque local par défaut, S3-compatible (OVH Object Storage, MinIO) par configuration, sans changement de code.
- `image` pour le traitement des images, `rust_xlsxwriter` et `csv` pour les exports, `phonenumber` pour les numéros de téléphone.
- **Organisation du code** : séparer le **domaine** (règles métier pures, testables sans base de données : chevauchement des événements, normalisation du code d'accès, validation des champs, génération des vCards et des exports) de la **couche HTTP** et de la **persistance**. Les dépendances externes (horloge, stockage, vérification des jetons, générateur d'identifiants) passent derrière des traits, injectables dans les tests. **L'horloge doit être injectable** pour pouvoir tester les règles basées sur `now()`.
- **Isolation des données** : chaque requête du tableau de bord est filtrée par l'utilisateur authentifié dès la couche de persistance, jamais seulement dans les handlers. Un accès à la ressource d'un autre utilisateur renvoie une erreur 404. Les endpoints de support sont **séparés** (`/api/admin/*`), vérifient le rôle administrateur et écrivent dans le journal d'audit. Un oubli de filtre dans un endpoint utilisateur ne peut donc pas devenir un accès administrateur.
- **Médias** : en mode disque local, c'est l'API qui sert `/media/*`, avec des en-têtes de cache longs et des noms de fichiers versionnés. Ça fonctionne derrière n'importe quel reverse proxy, sans partager de volume avec lui **(choix Claude)**. En mode S3, les médias sont servis par l'URL publique du bucket.

### 7.3 Authentification
- **Pour les auto-hébergeurs** : soit Clerk (offre gratuite), soit leur propre fournisseur OIDC. La documentation contient un pas-à-pas complet pour Clerk (création de l'application, configuration du jeton, variables d'environnement). Pas de connexion intégrée en v1.
- **Le backend est générique** : il vérifie un JWT grâce à `AUTH_ISSUER`, `AUTH_JWKS_URL` et `AUTH_AUDIENCE`, avec un cache des clés publiques (JWKS). L'utilisateur est identifié par la paire `iss` + `sub`. Le backend **n'appelle jamais** l'API de Clerk. L'email et le nom d'affichage sont stockés dans la table `users`, renseignés à partir des informations du jeton à la première connexion.
- **Le frontend a un module d'authentification** qui expose `getToken()`, `user`, `signIn()` et `signOut()`, avec trois implémentations choisies par configuration :
  1. **Clerk** (par défaut), avec ses composants d'interface tout faits ;
  2. **OIDC générique** (Authorization Code + PKCE, `oidc-client-ts`) pour Keycloak, Authentik, Zitadel… ;
  3. **Dev/test** : un faux émetteur local qui signe ses propres JWT, avec un JWKS servi en local. Il permet de se connecter en un appel comme n'importe quel utilisateur des données de test. **Il ne doit jamais pouvoir être activé en production** : le backend refuse de démarrer si l'émetteur de test est configuré avec `APP_ENV=production`.

### 7.4 Frontend
- **Next.js** (App Router), TypeScript strict, gestionnaire de paquets **pnpm**.
- **La page publique est rendue par le serveur**, pour la vitesse et pour les aperçus de lien. Le tableau de bord est rendu côté client derrière l'authentification.
- **Tailwind CSS** et **shadcn/ui** pour le tableau de bord, **Motion** pour les animations.
- **Le client d'API est généré** depuis l'OpenAPI du backend, dans `packages/api-client`. Une désynchronisation entre backend et frontend casse donc la compilation.
- **Langue** : l'interface est en français en v1, mais tous les textes passent dès le départ par un système d'i18n **(choix Claude)**, pour pouvoir ajouter l'anglais sans réécriture.

### 7.5 Encodage et textes
- UTF-8 partout. Les chaînes saisies sont normalisées en NFC avant d'être stockées.
- Le CSV est exporté avec un BOM. La vCard est en UTF-8, avec les caractères échappés comme l'exige la norme.
- La suite de tests contient des données avec accents, apostrophes typographiques, émojis et noms composés (« Éloïse D'Aubigné-Müller »).

## 8. Testabilité et observabilité

C'est une exigence de premier ordre : un agent doit pouvoir implémenter une fonctionnalité ou corriger un bug, tester unitairement, puis tester l'ensemble pour vérifier que la fonctionnalité respecte la `spec/` **sans rien casser ailleurs**.

### 8.1 Niveaux de tests
| Niveau | Outil | Ce qu'on teste |
|---|---|---|
| Unitaires backend | `cargo test` | Règles métier pures, sans base de données ni réseau. |
| Intégration backend | `cargo test` + `sqlx::test` | Les endpoints HTTP sur un vrai Postgres, avec une base neuve par test. Isolation entre utilisateurs, règles d'événements, exports. |
| Unitaires frontend | Vitest + Testing Library | Composants, module d'authentification, schémas de templates, validation des formulaires. |
| Bout en bout | Playwright | La stack complète (Docker Compose) avec les données de test et l'authentification dev/test. Parcours prospect sur un viewport mobile, et parcours propriétaire. |

### 8.2 Environnement reproductible
- **Une commande** démarre la stack de test complète : Postgres, api, web, authentification de test.
- **Un outil de données de test** (binaire Rust ou commande de l'API) charge des **scénarios nommés** : plusieurs utilisateurs, des cartes actives et désactivées, des événements passés, en cours (avec et sans code) et futurs, des contacts avec accents, et des événements simultanés à la limite des 3. Il permet de réinitialiser l'état entre deux tests de bout en bout.
- **Une horloge contrôlable dans l'environnement de test** **(choix Claude)**, pour tester « l'événement commence / se termine » sans attendre.

### 8.3 Comprendre ce qui s'est passé
- **Les logs du backend sont structurés** (`tracing`, en JSON) et contiennent un `request_id` généré ou propagé depuis le frontend. Le frontend affiche ce `request_id` dans ses messages d'erreur.
- **Sentry** est branché sur le backend et le frontend, avec propagation de la trace entre les deux. Il est désactivé si le DSN n'est pas renseigné.
- **Quand un test Playwright échoue**, on conserve la trace, une capture d'écran, une vidéo, ainsi que **les logs de l'API pendant le test**, retrouvables par `request_id`.
- **Traçabilité spec ↔ tests** : chaque règle de la `spec/` porte un identifiant stable (ex. `EVT-004`), et les tests qui la vérifient le citent. Un agent peut ainsi retrouver les tests concernés par une règle, et inversement.

## 9. Le dossier `spec/` : la référence du produit

- **`spec/` décrit comment le produit doit se comporter.** En cas de désaccord entre le code et la spec, c'est la spec qui fait foi, ou alors la spec doit être modifiée explicitement.
- **Un fichier par sujet**, pour que deux modifications simultanées de la spec (par deux agents ou deux branches) ne touchent presque jamais le même fichier et évitent les conflits Git. Découpage initial indicatif :
  ```
  spec/
    README.md              Index : liste des fichiers et leur préfixe, conventions
    glossary.md            Glossaire des concepts
    card-links.md          (LNK) Lien public, slug, désactivation, suppression
    public-page.md         (PUB) Page publique, vCard, aperçus de lien
    templates-themes.md    (TPL) Contrat des templates, thèmes, polices
    media.md               (MED) Images, vidéos, limites, traitement
    events.md              (EVT) Période, chevauchement, code, limite par appareil
    event-form.md          (FRM) Formulaire prospect, champs, consentement
    anti-abuse.md          (ABU) Limites IP, champ piège, spam
    leads-exports.md       (LEA) Consultation, suppression, exports
    account-auth.md        (ACC) Compte, authentification, isolation des données
    admin-support.md       (ADM) Validation des inscriptions, support, audit
    dashboard-editor.md    (EDI) Éditeur, aperçu en direct
    landing.md             (LND) Landing page
  ```
- **Chaque fichier a son propre préfixe d'identifiants** (`EVT-001`, `FRM-012`…). La numérotation est donc indépendante d'un fichier à l'autre : deux personnes qui ajoutent une règle dans deux sujets différents ne créent jamais de doublon.
- Un nouveau sujet devient un nouveau fichier, avec un nouveau préfixe déclaré dans `README.md`. Une règle qui en concerne une autre la cite par son identifiant plutôt que de la recopier, pour ne pas créer de contradiction entre deux versions du même texte.
- **Chaque fonctionnalité ou correction de bug commence par une mise à jour de la `spec/`.** On vérifie alors qu'aucune règle existante n'est contredite ; s'il y a une contradiction ou un changement de comportement, on le signale explicitement au porteur avant de coder.
- Le contenu produit de ce document (sections 4 à 6) est l'état initial de la spec.

## 10. Agents et skills du projet

### 10.1 Agents (`.claude/agents/`)
| Agent | Rôle | Modèle / effort |
|---|---|---|
| `explorer` | Chercher et résumer dans le code et la spec, en lecture seule. | Haiku 5.5 |
| `planner` | Transformer une demande en mise à jour de la spec et en plan de tâches. | Opus 5.5, high |
| `builder` | Implémenter une tâche du plan, avec ses tests. | Sonnet 5.5, medium |
| `task-reviewer` | Relire une tâche : conformité au plan et à la spec, tests, lisibilité. | Sonnet 5.5, high |
| `feature-reviewer` | Relire une fonctionnalité complète ou une correction de bug de bout en bout, cohérence avec la spec, non-régression. | Opus 5.5, high |
| `debugger` | Reproduire, diagnostiquer et corriger un bug. | Sonnet 5.5, high |
| `debugger-deep` | Même rôle, pour les bugs complexes ou quand `debugger` échoue. | Opus 5.5, high |

### 10.2 Skills (`.claude/skills/`)
Une liste à affiner par le builder ; au minimum :
- démarrer, réinitialiser et alimenter l'environnement local ou de test ;
- lancer les tests (unitaires, intégration, bout en bout, ciblés par règle de la spec) et exploiter un échec (traces Playwright, logs par `request_id`) ;
- mettre à jour la `spec/` et détecter les contradictions ;
- faire évoluer l'API (migration, OpenAPI, régénération du client) ;
- ajouter un template de carte ;
- ajouter un scénario de données de test.

### 10.3 `CLAUDE.md`
Il décrit la structure du dépôt, les commandes, le cycle de travail (spec → plan → implémentation et tests → revues), et les règles de qualité (code lisible, pas de logique métier dans les handlers ni dans les composants d'interface, tests obligatoires).

## 11. Dépôt et hébergement

### 11.1 Structure du monorepo
```
apps/api/              Backend Rust (Axum)
apps/web/              Frontend Next.js (landing, page publique, dashboard, templates)
packages/api-client/   Client TypeScript généré depuis l'OpenAPI
e2e/                   Tests Playwright
spec/                  Référence produit
deploy/                docker-compose de production, Caddyfile, exemple de .env
.claude/agents/        Agents du projet
.claude/skills/        Skills du projet
docs/                  Documentation (installation, auto-hébergement, contribution)
```
Licence MIT (déjà présente). La CI GitHub Actions lance la vérification du format et le lint, les tests du backend et du frontend, les tests de bout en bout, et la construction des images Docker.

### 11.2 Production (VPS OVH vps-1, `cartouche.jicorp.fr`)
- Le VPS fait déjà tourner d'autres services derrière **un Caddy unique**. Cartouche **n'embarque donc pas de reverse proxy** dans son compose de production :
  - un `docker compose` qui contient api, web, Postgres, et un volume pour les médias ;
  - api et web écoutent uniquement en local (`127.0.0.1`), sur des ports configurables ;
  - le dépôt fournit le **bloc Caddyfile** à ajouter au Caddy existant pour `cartouche.jicorp.fr`.
- **Pour les auto-hébergeurs** qui n'ont pas de proxy, un profil Compose optionnel ajoute un Caddy dédié **(choix Claude)**.
- **Déploiement manuel, avec construction des images sur le VPS** : `git pull`, puis `docker compose build`, puis `docker compose up -d`, avec une procédure documentée.
  - Les Dockerfiles sont multi-étapes. Le backend utilise un cache des dépendances Rust (par exemple `cargo-chef`), pour que les reconstructions ne recompilent que le code de Cartouche.
  - La CI vérifie seulement que les images se construisent ; elle ne publie rien sur un registre en v1. Publier des images prêtes à l'emploi pour les auto-hébergeurs viendra plus tard.
- Toute la configuration passe par les variables d'environnement, documentées dans un `.env.example`.
- Les migrations de base de données s'appliquent au démarrage de l'API.
- **Sauvegardes** : en v1, un script documenté de sauvegarde locale (Postgres et médias). La copie hors du serveur viendra plus tard.

## 12. Conception visuelle (Claude Design)
Les écrans suivants seront conçus avec Claude Design : la **landing page**, le **tableau de bord** (dont l'éditeur avec aperçu), la **page publique** (template Classique et thèmes prêts à l'emploi) et le **formulaire d'événement**.

**C'est le porteur du projet qui produit ces designs** avec Claude Design, et il les fournit au builder. Le builder ne les invente pas.

Ordre de travail **(choix Claude)** :
1. **Jalon « fonctionnel »** : toutes les fonctionnalités de la v1, avec une interface sobre (shadcn/ui par défaut) et un template Classique fonctionnel mais simple. Ce jalon est utilisable par le porteur et son ami, mais ce n'est **pas** une version publique.
2. **Jalon « design »** : intégration des designs Claude Design (landing, tableau de bord, template Classique, thèmes, formulaire). C'est seulement après ce jalon que la v1 est considérée comme publiable.

L'architecture (templates, thèmes stockés comme des données, contrat commun) doit permettre d'intégrer le design sans toucher à la logique.

## 13. Laissé au builder
- Le schéma exact de la base de données et le nommage des endpoints.
- Le format exact des fichiers de la spec, tant que les règles sont numérotées et classées par domaine.
- Le choix du système d'i18n côté Next.js, du générateur de client OpenAPI, et la forme de l'outil de données de test.
- Les valeurs précises des limites anti-abus et des tailles d'images.
- La liste finale des skills, en partant de la section 10.2.
- La liste finale des paires de polices.
