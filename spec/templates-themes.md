# Templates et thèmes

> Statut : spécifié, non implémenté (plan 2)

## Templates

- **TPL-001** — Un template est un composant React versionné dans le dépôt. Les utilisateurs ne peuvent pas envoyer de HTML ni de code libre.
- **TPL-002** — Tous les templates respectent le même contrat : ils reçoivent la carte, le thème résolu, les événements en cours et les points d'accès au formulaire et à la vCard.
- **TPL-003** — Les comportements de la page publique (bouton d'événement, vCard, formulaire, consentement) sont garantis quel que soit le template, et la suite de tests de bout en bout tourne sur chaque template.
- **TPL-004** — Chaque template déclare ses réglages sous forme de schéma (couleurs, médias acceptés, options propres). L'éditeur génère son formulaire à partir de ce schéma : ajouter un template ne demande pas de modifier l'éditeur.
- **TPL-005** — Chaque carte choisit librement son template.
- **TPL-006** — Un template peut porter l'étiquette « bêta » (template en test), affichée dans l'éditeur.
- **TPL-007** — Tous les templates sont accessibles à tous les utilisateurs.
- **TPL-008** — La v1 livre le template « Classique » décrit dans public-page.md, et l'architecture rend facile l'ajout d'un deuxième template.

## Thèmes

Un thème est un ensemble de données (couleurs, police, styles) appliqué dans un template qui le supporte.

- **TPL-009** — Des thèmes prêts à l'emploi (6 à 8) servent de point de départ.
- **TPL-010** — Par-dessus un thème, l'utilisateur règle : la couleur d'accent, le fond (couleur unie ou dégradé), la couleur du texte, l'intensité du dégradé de l'en-tête et la forme des boutons.
- **TPL-011** — La police se choisit dans une liste courte de paires titre/texte, toutes avec un bon support des accents.
- **TPL-012** — Les polices sont auto-hébergées : aucun appel à Google Fonts.
- **TPL-013** — Un avertissement de contraste s'affiche quand le texte devient illisible sur le fond.
