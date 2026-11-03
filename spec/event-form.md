# Formulaire d'événement

> Statut : spécifié, non implémenté (plan 3)

## Parcours du prospect

- **FRM-001** — Un clic sur le bouton d'événement ouvre le formulaire en plein écran, avec un bouton de retour vers la carte.
- **FRM-002** — Si l'événement a un code d'accès, un écran demande le code avant le formulaire (voir EVT-011, EVT-012 et EVT-013).
- **FRM-003** — Le formulaire affiche le titre et la description de l'événement, puis les champs standards activés, puis les champs personnalisés.
- **FRM-004** — Après l'envoi, un écran de confirmation propose d'enregistrer la vCard du porteur, puis un retour à la carte.
- **FRM-005** — Le formulaire est accessible : libellés, navigation au clavier, types de clavier mobile adaptés (`type="email"`, `inputmode="tel"`…).

## Consentement

- **FRM-006** — Le consentement est obligatoire : une case à cocher accompagne un texte de mentions légales.
- **FRM-007** — Un texte de mentions légales par défaut, en français et conforme à l'esprit du RGPD, est fourni ; il peut être remplacé par événement.
- **FRM-008** — À l'envoi, le serveur enregistre l'horodatage du consentement et le texte exact accepté.
- **FRM-009** — Le responsable des données est le propriétaire de la carte, pas l'opérateur de l'instance : le texte par défaut est rempli automatiquement avec le nom ou l'entreprise et l'email de la carte.
- **FRM-010** — Le texte par défaut précise la finalité (recontact commercial lié à l'événement) et le droit d'accès et de suppression.
- **FRM-011** — Le texte par défaut ne s'engage sur aucune durée de conservation chiffrée : il n'y a pas de suppression automatique en v1, la suppression reste manuelle.

## Validation

- **FRM-012** — L'email saisi doit être valide.
- **FRM-013** — Le téléphone est validé et normalisé au format international E.164, la France étant le pays par défaut.
- **FRM-014** — Les dates saisies doivent être valides.
- **FRM-015** — Les erreurs s'affichent à côté de chaque champ, et la saisie n'est jamais perdue.
- **FRM-016** — Les chaînes saisies sont normalisées en NFC avant d'être stockées.

## Champs standards

- **FRM-017** — Les champs standards que le propriétaire peut cocher sont : prénom, nom, date de naissance, email, téléphone et adresse postale.
- **FRM-018** — L'adresse postale se décompose en rue, code postal, ville et pays.
- **FRM-019** — Chaque champ standard coché peut être obligatoire ou facultatif.

## Champs personnalisés

- **FRM-020** — Le propriétaire peut ajouter autant de champs personnalisés qu'il veut, et les ordonner. Chaque champ a un libellé, un type, un caractère obligatoire ou non, et un texte d'aide optionnel.
- **FRM-021** — Les types de champ personnalisé sont : `texte`, `texte long`, `date`, `nombre`, `choix unique` (avec une liste d'options) et `case à cocher`.

## Évolution des champs

- **FRM-022** — Modifier les champs d'un événement alors que des contacts existent déjà ne casse jamais les contacts existants : chaque contact conserve ses réponses avec le libellé et le type du champ au moment de l'envoi.
- **FRM-023** — Un champ supprimé reste visible sur les anciens contacts et dans les exports (voir LEA-011).

## Adresse et états du formulaire

- **FRM-024** — Le formulaire d'un événement est servi à l'adresse `/c/<slug>/e/<identifiant de l'événement>`. Un ancien slug ou un slug écrit en majuscules redirige vers l'adresse du slug courant (voir LNK-024 et LNK-030) ; une carte qui n'est pas servie affiche la page neutre (voir LNK-007 et LNK-027) ; un événement inconnu, supprimé ou d'une autre carte affiche une page « Formulaire introuvable » avec le statut 404 ; hors de la fenêtre de EVT-026, un écran indique que le formulaire n'est pas ouvert, avec un retour à la carte.
- **FRM-025** — Le formulaire, son écran de code et son écran de confirmation sont communs à tous les templates (voir TPL-020) ; leurs textes s'adressent au prospect en le vouvoyant.

## Texte de consentement

- **FRM-026** — Le texte par défaut est, mot pour mot : « En cochant cette case, j'accepte que {responsable} conserve les informations saisies dans ce formulaire afin de me recontacter à des fins commerciales en lien avec l'événement « {événement} ». {responsable} est responsable de ce traitement. Je peux à tout moment demander l'accès à mes données, leur rectification ou leur suppression en écrivant à {email}. » {événement} est le titre de l'événement ; {email} est l'email de la carte.
- **FRM-027** — Dans le texte par défaut, {responsable} est le prénom et le nom de la carte (ou celui des deux qui est renseigné, voir PUB-018), suivis de l'entreprise entre parenthèses quand elle est renseignée : « Alice Durand (Atelier Durand & Fils) ». Si la carte n'a pas d'email, la dernière phrase devient « Je peux à tout moment demander l'accès à mes données, leur rectification ou leur suppression auprès de {responsable}. »
- **FRM-028** — Un texte personnalisé (FRM-007) compte au plus 3 000 caractères et s'affiche tel quel, sans variable ; un texte vide après normalisation revient au texte par défaut.
- **FRM-029** — L'éditeur d'événement affiche le texte par défaut tel qu'il sera présenté, et avertit le propriétaire quand la carte n'a pas d'email.
- **FRM-030** — Le serveur calcule lui-même le texte enregistré par FRM-008. Si la définition du formulaire présentée au prospect (titre, description, champs ou texte de consentement) a changé avant l'envoi, l'envoi est refusé par `409 form_changed` : le formulaire se recharge, les réponses aux champs qui existent toujours sont conservées et la case de consentement est décochée.

## Définition des champs

- **FRM-031** — Un formulaire a au moins un champ, standard coché ou personnalisé ; sinon le champ `standard_fields` est refusé avec le code `no_fields`.
- **FRM-032** — Un événement a au plus 30 champs personnalisés (code `too_many_fields`). Chacun a un identifiant stable (UUID créé par l'éditeur, unique dans l'événement, code `duplicate_field_id`), un libellé obligatoire d'au plus 100 caractères et un texte d'aide d'au plus 300. Un champ `choix unique` a de 2 à 20 options (codes `too_few_options`, `too_many_options`), chacune obligatoire, d'au plus 100 caractères et sans doublon (code `duplicate_option`) ; les autres types n'ont pas d'option.
- **FRM-033** — Si l'adresse postale est obligatoire, ses quatre parties le sont ; le formulaire propose « France » comme pays.

## Réponses

- **FRM-034** — Longueurs maximales des réponses : 100 caractères pour le prénom, le nom, la ville et le pays ; 254 pour l'email ; 200 pour la rue ; 20 pour le code postal ; 500 pour un champ `texte` ; 5 000 pour un `texte long`. Au-delà : code `too_long`. Un champ obligatoire vide : code `required` ; une `case à cocher` obligatoire doit être cochée.
- **FRM-035** — Une date est au format `AAAA-MM-JJ`, existe dans le calendrier et se situe entre le 1er janvier 1900 et le 31 décembre 2100 ; une date de naissance n'est pas dans le futur. Sinon : code `invalid_date`.
- **FRM-036** — Un `nombre` est un nombre décimal, saisi avec un point ou une virgule (code `invalid_number`) ; un `choix unique` est l'une des options du champ (code `invalid_choice`).
- **FRM-037** — Le consentement non coché est refusé (champ `consent`, code `required`).
- **FRM-038** — Un contact enregistre : la date d'envoi, les réponses aux champs standards, une réponse par champ personnalisé existant au moment de l'envoi (vide si non renseigné) avec son identifiant, son libellé et son type (voir FRM-022), l'horodatage du consentement et son texte (voir FRM-008), et l'identifiant d'appareil. L'adresse IP du prospect n'est pas enregistrée.

## Saisie du prospect

- **FRM-039** — Les champs utilisent les types et l'autocomplétion du navigateur : prénom `given-name`, nom `family-name`, date de naissance `type="date"` et `bday`, email `type="email"` et `email`, téléphone `type="tel"`, `inputmode="tel"` et `tel`, adresse `street-address`, `postal-code`, `address-level2` et `country-name`, nombre `inputmode="decimal"`, date `type="date"`.
- **FRM-040** — La saisie est conservée dans le stockage de session du navigateur jusqu'à l'envoi réussi : un rechargement de la page, une erreur réseau ou un refus du serveur ne la perd pas. Une erreur réseau affiche un message et permet de renvoyer.
- **FRM-041** — Si le code a changé entre la saisie du code et l'envoi (EVT-013), l'envoi est refusé par `403 invalid_access_code` : l'écran du code réapparaît avec un message, et les réponses sont conservées pour l'envoi suivant.
- **FRM-042** — Chaque refus du serveur à l'envoi a son message : formulaire fermé (`event_closed`), limite de l'appareil atteinte (`device_limit_reached`), trop d'envois depuis ce réseau (`rate_limited`), carte devenue inactive (`card_inactive`).
