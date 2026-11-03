# Tableau de bord et éditeur de carte

> Statut : spécifié, non implémenté (plan 2) ; la liste des événements : plan 3 ; l'accès aux contacts et aux exports : plan 4

## Cartes

- **EDI-001** — Le tableau de bord permet de lister, créer, éditer, dupliquer, désactiver, réactiver et supprimer des cartes.
- **EDI-002** — Supprimer une carte demande une confirmation (voir LNK-012).

## Éditeur de carte

- **EDI-003** — L'éditeur affiche un formulaire à gauche et un aperçu en direct dans un cadre de téléphone à droite ; sur mobile, les deux sont empilés.
- **EDI-004** — L'aperçu se met à jour à chaque modification, sans qu'il soit nécessaire d'enregistrer.
- **EDI-005** — Un interrupteur de l'éditeur simule « événement en cours » dans l'aperçu.
- **EDI-006** — Les changements ne sont publiés qu'à l'enregistrement.
- **EDI-007** — Le formulaire de l'éditeur est généré à partir du schéma de réglages du template choisi (voir TPL-004).
- **EDI-008** — Les chaînes saisies dans l'éditeur sont normalisées en NFC avant d'être stockées.

## Événements et contacts

- **EDI-009** — La page d'une carte liste ses événements en trois groupes (en cours, à venir, passés) et permet de les créer, éditer, clore et supprimer (voir EVT-009).
- **EDI-010** — Le tableau de bord donne accès aux contacts collectés et à leurs exports (voir LEA-001 et LEA-006).

## Interface

- **EDI-011** — L'interface est en français en v1, et tous ses textes passent par un système d'i18n, pour pouvoir ajouter l'anglais sans réécriture.
