# Tableau de bord et éditeur de carte

> Statut : implémenté (plans 2 et 3) ; EDI-010 : plan 4

## Cartes

- **EDI-001** — Le tableau de bord permet de lister, créer, éditer, dupliquer, désactiver, réactiver et supprimer des cartes.
- **EDI-002** — Supprimer une carte demande une confirmation (voir LNK-012).
- **EDI-012** — La liste des cartes affiche, pour chacune, le nom, le lien public et l'état : « Active », « Désactivée » ou « Désactivée par le support » (voir LNK-011).
- **EDI-013** — Pour créer une carte, l'utilisateur saisit un prénom et un nom, puis accepte ou modifie le slug proposé (voir LNK-019). La carte est créée active, avec le template Classique et le thème par défaut, et s'ouvre dans l'éditeur.
- **EDI-014** — Dupliquer une carte copie son contenu, ses liens, son template, son thème, ses réglages et ses médias, sous un nouveau slug choisi par l'utilisateur. Ni les anciens slugs, ni les événements, ni les contacts collectés ne sont copiés, et la copie est active. Une carte désactivée par le support ne peut pas être dupliquée (`409 card_disabled_by_support`).

## Éditeur de carte

- **EDI-003** — L'éditeur affiche un formulaire à gauche et un aperçu en direct dans un cadre de téléphone à droite ; sur mobile, les deux sont empilés.
- **EDI-004** — L'aperçu se met à jour à chaque modification, sans qu'il soit nécessaire d'enregistrer.
- **EDI-005** — Un interrupteur de l'éditeur simule « événement en cours » dans l'aperçu.
- **EDI-006** — Les changements ne sont publiés qu'à l'enregistrement.
- **EDI-007** — Le formulaire de l'éditeur est généré à partir du schéma de réglages du template choisi (voir TPL-004).
- **EDI-008** — Les chaînes saisies dans l'éditeur sont normalisées en NFC avant d'être stockées.
- **EDI-015** — L'enregistrement est tout ou rien : si une partie est refusée (slug pris, champ invalide), rien n'est modifié. Chaque erreur s'affiche à côté de son champ, et aucune saisie n'est perdue.
- **EDI-016** — Quitter l'éditeur avec des modifications non enregistrées demande une confirmation.
- **EDI-017** — L'événement simulé de EDI-005 n'existe que dans l'aperçu : il n'est jamais enregistré ni visible sur la page publique.

## Événements et contacts

- **EDI-009** — La page d'une carte liste ses événements en trois groupes (en cours, à venir, passés) et permet de les créer, éditer, clore et supprimer (voir EVT-009).
- **EDI-018** — La liste des événements d'une carte montre, pour chacun, son titre, son début, sa fin (ou « Sans fin »), son état (EVT-020) et son nombre de contacts. Elle est accessible depuis la liste des cartes et depuis l'éditeur de la carte.
- **EDI-019** — L'éditeur d'événement règle le titre, la description, le début, la fin, le code d'accès (affiché en clair, voir EVT-010), la limite par appareil, les champs standards (non demandé, facultatif ou obligatoire), les champs personnalisés (ajout, ordre, type, libellé, aide, options, caractère obligatoire) et le texte de consentement (par défaut ou personnalisé). Chaque erreur s'affiche à côté de son champ, sans perte de saisie (voir EDI-015).
- **EDI-020** — Pour chaque événement, le tableau de bord liste ses contacts, du plus récent au plus ancien, avec la date d'envoi, le nom, l'email, le téléphone et l'étiquette « Spam », et permet de marquer ou démarquer un contact comme spam et de le supprimer (voir ABU-003, ABU-004, ABU-009 et ABU-010). La recherche, la vue détaillée, la vue « toute la carte » et les exports viennent avec EDI-010.
- **EDI-010** — Le tableau de bord donne accès aux contacts collectés et à leurs exports (voir LEA-001 et LEA-006).

## Interface

- **EDI-011** — L'interface est en français en v1, et tous ses textes passent par un système d'i18n, pour pouvoir ajouter l'anglais sans réécriture.
