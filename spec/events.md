# Événements

> Statut : spécifié, non implémenté (plan 3)

## Période

- **EVT-001** — Un événement appartient à une carte. Il a un titre, une description, une date de début (obligatoire) et une date de fin (optionnelle).
- **EVT-002** — Un événement est en cours si `début <= maintenant` et (`fin` absente ou `maintenant < fin`).
- **EVT-003** — Une fin absente signifie que l'événement dure jusqu'à sa clôture manuelle.
- **EVT-004** — Une carte ne peut pas avoir plus de 3 événements simultanés à n'importe quel instant. Cette limite est réglable dans la configuration de l'instance.
- **EVT-005** — La limite d'événements simultanés (EVT-004) est vérifiée à chaque création et à chaque modification, en calculant le chevauchement maximal sur toute la période de l'événement ; une fin absente compte comme l'infini.
- **EVT-006** — Le bouton « Terminer maintenant » fixe la fin de l'événement à l'instant présent.
- **EVT-007** — Les dates sont saisies et affichées dans le fuseau de l'utilisateur (Europe/Paris par défaut) et stockées en UTC.
- **EVT-008** — Le serveur n'accepte un envoi de formulaire que si l'événement est en cours ou s'est terminé il y a au plus 15 minutes, pour ne pas perdre un prospect en train de remplir.
- **EVT-009** — Le propriétaire peut modifier, clore et supprimer un événement de sa carte.

## Code d'accès

- **EVT-010** — Un événement peut avoir un code d'accès, optionnel et modifiable à tout moment. Il est stocké de façon à pouvoir être réaffiché au propriétaire.
- **EVT-011** — La comparaison du code d'accès ignore la casse, les espaces en début et en fin, et les accents.
- **EVT-012** — Le code d'accès est vérifié par le serveur et n'est jamais envoyé au navigateur.
- **EVT-013** — Le code d'accès est revérifié au moment de l'envoi : si le propriétaire l'a changé entre-temps, le prospect doit saisir le nouveau.

## Limite par appareil

- **EVT-014** — La limite d'envois par appareil est réglable par événement ; elle vaut 1 par défaut, et le serveur refuse les envois au-delà.
- **EVT-015** — Un appareil est reconnu par un identifiant aléatoire conservé dans un cookie et dans le stockage local. C'est une protection légère, qui se contourne en navigation privée.

## Saisie et limites

- **EVT-016** — Le titre est obligatoire (code `required`) et compte au plus 120 caractères ; la description au plus 2 000 ; le code d'accès au plus 32 (vide après normalisation = pas de code). Au-delà, le champ est refusé avec le code `too_long`. Longueurs comptées en caractères après normalisation NFC et retrait des espaces de début et de fin.
- **EVT-030** — La limite par appareil (EVT-014) est un entier de 1 à 100 ; hors de cet intervalle, le champ `device_limit` est refusé avec le code `out_of_range`.
- **EVT-017** — Une fin, quand elle est donnée, est strictement postérieure au début ; sinon le champ `ends_at` est refusé avec le code `end_before_start`.
- **EVT-018** — Une création ou une modification qui ferait dépasser la limite de EVT-004 est refusée par `409 too_many_simultaneous_events`, et rien n'est enregistré. Quand plusieurs créations ou modifications arrivent au même moment sur une carte, elles ne peuvent pas dépasser la limite ensemble.
- **EVT-019** — La limite de EVT-004 se règle par la variable `MAX_SIMULTANEOUS_EVENTS`, un entier d'au moins 1, qui vaut 3 quand elle est absente.
- **EVT-020** — Un événement est « à venir » si son début est dans le futur, « en cours » selon EVT-002, et « passé » si sa fin est atteinte. Le serveur calcule cet état avec son horloge, jamais avec celle du navigateur.
- **EVT-021** — « Terminer maintenant » (EVT-006) n'est possible que sur un événement en cours ; sur un événement à venir ou passé, la demande est refusée par `409 event_not_running`. Après la clôture, la fenêtre de EVT-008 s'applique.

## Fuseau horaire

- **EVT-022** — Le fuseau de l'utilisateur (EVT-007) est celui de son navigateur ; si le navigateur n'en donne pas, c'est Europe/Paris. Le tableau de bord affiche le nom de ce fuseau à côté des champs de date. L'API n'échange que des instants UTC au format RFC 3339.
- **EVT-023** — Une heure saisie qui n'existe pas dans le fuseau (passage à l'heure d'été) est avancée d'une heure ; une heure qui existe deux fois (retour à l'heure d'hiver) désigne la première des deux.

## Suppression et carte désactivée

- **EVT-024** — Supprimer un événement supprime ses contacts collectés. Le tableau de bord demande une confirmation qui indique leur nombre.
- **EVT-025** — Les événements d'une carte désactivée, par son propriétaire ou par le support, restent listés et modifiables dans le tableau de bord (voir LNK-008), mais ne sont jamais servis au public (voir LNK-007).

## Ouverture du formulaire

- **EVT-026** — Le formulaire d'un événement peut être consulté, déverrouillé par son code et envoyé pendant la même fenêtre que EVT-008 : de son début jusqu'à 15 minutes après sa fin. Hors de cette fenêtre, le serveur refuse par `409 event_closed`.
- **EVT-027** — Quand l'événement a un code d'accès, le serveur ne donne au navigateur que le titre de l'événement tant qu'un code correct n'a pas été saisi : la description, les champs et le texte de consentement ne sont envoyés qu'après. Un code faux est refusé par `403 invalid_access_code`. Le code lui-même n'apparaît dans aucune réponse publique ni dans les logs (voir EVT-012).

## Identifiant d'appareil

- **EVT-028** — L'identifiant d'appareil (EVT-015) est un UUID aléatoire créé par le navigateur à la première visite d'un formulaire. Il est conservé dans le cookie `cartouche_device` (chemin `/`, 400 jours, `SameSite=Lax`) et dans le stockage local ; le navigateur reprend celui qu'il trouve en premier, puis le réécrit aux deux endroits. Il accompagne chaque envoi.
- **EVT-029** — Pour EVT-014, le serveur compte les contacts de l'événement qui portent le même identifiant d'appareil, y compris ceux marqués spam ; un contact supprimé ne compte plus. À la limite, l'envoi est refusé par `409 device_limit_reached`. Deux envois simultanés du même appareil ne peuvent pas dépasser la limite ensemble.
