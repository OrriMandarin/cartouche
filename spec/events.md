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
