# Validation des inscriptions et support

> Statut : partiellement implémenté : ADM-001 à ADM-005 (plan 1) ; ADM-006 et suivantes : spécifié (plans 2 et 4, indiqués règle par règle)

## Accès et gestion des comptes

- **ADM-001** — La page de support et les routes `/api/admin/*` sont réservées aux administrateurs ; un non-administrateur reçoit `403 forbidden` et l'interface affiche « Accès réservé ».
- **ADM-002** — La page de support liste les utilisateurs filtrables par statut et affiche bien en évidence le nombre de comptes `pending`.
- **ADM-003** — Transitions de statut autorisées : `pending → approved | rejected`, `rejected → approved`, `approved → suspended`, `suspended → approved`. Toute autre transition → `409 invalid_transition`.
- **ADM-004** — Un administrateur ne peut pas changer le statut d'un autre administrateur, ni le sien → `403 cannot_moderate_admin`.

## Journal d'audit

- **ADM-005** — Chaque action d'un administrateur est inscrite au journal d'audit : acteur, action, type et identifiant de la cible, métadonnées (ancien et nouveau statut), horodatage.
- **ADM-008** — Chaque consultation par un administrateur des contacts collectés d'un autre utilisateur est inscrite au journal d'audit (qui, quoi, quand). Plan 4.

## Consultation (lecture seule)

- **ADM-006** — Un administrateur peut consulter, pour un utilisateur donné, son profil et ses cartes, en lecture seule. Plan 2.
- **ADM-007** — Un administrateur peut consulter, pour un utilisateur donné, ses événements et ses contacts collectés, en lecture seule. Plan 4.

## Modération des cartes

- **ADM-009** — Un administrateur peut désactiver une carte abusive ; la désactivation par le support est un état distinct de celle du propriétaire (voir LNK-010). Plan 2.
- **ADM-010** — Seul un administrateur peut lever la désactivation d'une carte par le support (voir LNK-011). Plan 2.
- **ADM-011** — Quand un compte est suspendu, toutes ses cartes affichent la page neutre « Cette carte n'est plus active » (voir LNK-006). Plan 2.

## Limites des pouvoirs

- **ADM-012** — Les administrateurs ne modifient pas le contenu des utilisateurs : ils peuvent seulement le consulter, désactiver une carte, et valider, refuser ou suspendre un compte.
