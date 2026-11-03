# Protections anti-abus

> Statut : implémenté (plan 3)

Ces protections sont toujours actives.

- **ABU-001** — Les envois de formulaire sont soumis à une limite large par adresse IP, uniquement pour stopper les rafales automatiques : des dizaines de prospects qui partagent la même IP de Wi-Fi sur un salon ne sont pas bloqués.
- **ABU-002** — Le formulaire contient un champ piège invisible : un envoi qui le remplit est ignoré silencieusement.
- **ABU-003** — Dans le tableau de bord, le propriétaire peut marquer un contact comme spam.
- **ABU-004** — Dans le tableau de bord, le propriétaire peut supprimer un contact.

## Précisions

- **ABU-005** — Un envoi dont le champ piège (ABU-002) n'est pas vide après retrait des espaces reçoit exactement la même réponse qu'un envoi accepté, mais rien n'est enregistré et il ne compte pas dans la limite par appareil (EVT-014). Le champ piège est un champ texte nommé `fax`, placé hors de l'écran (sans `display: none`), sans autocomplétion, hors de la navigation au clavier et masqué aux lecteurs d'écran.
- **ABU-006** — La limite de ABU-001 est de 120 envois par adresse IP sur toute fenêtre glissante de 10 minutes, tous événements confondus, qu'ils soient acceptés ou refusés. Au-delà, l'envoi est refusé par `429 rate_limited` avec un en-tête `Retry-After` en secondes.
- **ABU-007** — Les codes d'accès faux sont limités à 30 par adresse IP sur toute fenêtre glissante de 10 minutes ; au-delà, toute vérification de code est refusée par `429 rate_limited` avec un en-tête `Retry-After`. Un code correct ne compte pas.
- **ABU-008** — L'adresse IP retenue est celle placée par le reverse proxy dans `X-Forwarded-For` : la n-ième en partant de la droite, n étant la variable `TRUSTED_PROXY_HOPS` (1 par défaut). Avec 0, ou si l'en-tête en contient moins, c'est l'adresse de la connexion. Une adresse IPv6 compte pour son préfixe /64.
- **ABU-009** — Un contact marqué spam reste dans la liste avec une étiquette « Spam », et le propriétaire peut retirer ce marquage.
- **ABU-010** — La suppression d'un contact est définitive et demande une confirmation.
