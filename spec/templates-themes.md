# Templates et thèmes

> Statut : implémenté (plans 2 et 3)

## Templates

- **TPL-001** — Un template est un composant React versionné dans le dépôt. Les utilisateurs ne peuvent pas envoyer de HTML ni de code libre.
- **TPL-002** — Tous les templates respectent le même contrat : ils reçoivent la carte, le thème résolu, les événements en cours et les points d'accès au formulaire et à la vCard.
- **TPL-003** — Les comportements de la page publique (bouton d'événement, vCard, formulaire, consentement) sont garantis quel que soit le template, et la suite de tests de bout en bout tourne sur chaque template.
- **TPL-004** — Chaque template déclare ses réglages sous forme de schéma (couleurs, médias acceptés, options propres). L'éditeur génère son formulaire à partir de ce schéma : ajouter un template ne demande pas de modifier l'éditeur.
- **TPL-005** — Chaque carte choisit librement son template.
- **TPL-006** — Un template peut porter l'étiquette « bêta » (template en test), affichée dans l'éditeur.
- **TPL-007** — Tous les templates sont accessibles à tous les utilisateurs.
- **TPL-008** — La v1 livre le template « Classique » décrit dans public-page.md, et l'architecture rend facile l'ajout d'un deuxième template.
- **TPL-014** — La page publique et l'aperçu de l'éditeur rendent la carte avec le même composant de template (voir EDI-004).
- **TPL-015** — Une carte dont le template est inconnu, par exemple parce qu'il a été retiré du dépôt, s'affiche avec le template Classique.
- **TPL-020** — Le formulaire d'événement, son écran de code et son écran de confirmation ne dépendent pas du template : ils sont rendus par un composant commun, avec le thème de la carte (couleurs et polices, voir TPL-010). Un template ne fournit que le bouton d'événement, qui mène à `urls.eventForm(id)` (voir TPL-002).
- **TPL-016** — Les réglages propres au template sont lus à travers son schéma au moment du rendu : une valeur absente ou invalide prend la valeur par défaut du schéma, et un réglage invalide ne fait jamais échouer l'affichage.

## Thèmes

Un thème est un ensemble de données (couleurs, police, styles) appliqué dans un template qui le supporte.

- **TPL-009** — Des thèmes prêts à l'emploi (6 à 8) servent de point de départ.
- **TPL-010** — Par-dessus un thème, l'utilisateur règle : la couleur d'accent, le fond (couleur unie ou dégradé), la couleur du texte, l'intensité du dégradé de l'en-tête et la forme des boutons.
- **TPL-011** — La police se choisit dans une liste courte de paires titre/texte, toutes avec un bon support des accents.
- **TPL-012** — Les polices sont auto-hébergées : aucun appel à Google Fonts.
- **TPL-013** — Un avertissement de contraste s'affiche quand le texte devient illisible sur le fond.
- **TPL-017** — Valeurs permises pour les réglages de TPL-010 : couleurs au format `#RRGGBB` ; fond uni (une couleur) ou dégradé linéaire (deux couleurs et un angle de 0 à 360°) ; intensité du dégradé de l'en-tête de 0 à 100 % ; forme des boutons carrée, arrondie ou pilule. Le serveur refuse toute autre valeur (`400`, champ `theme`, code `invalid_theme`).
- **TPL-018** — L'avertissement de contraste apparaît quand le rapport de contraste WCAG entre la couleur du texte et le fond est inférieur à 4,5:1 ; pour un fond dégradé, on retient la plus défavorable des deux couleurs. L'avertissement n'empêche pas d'enregistrer.
- **TPL-019** — Un thème prêt à l'emploi ou une paire de polices inconnus, par exemple parce qu'ils ont été retirés du dépôt, sont remplacés au rendu par le thème et la paire par défaut.
