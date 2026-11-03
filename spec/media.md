# Médias

> Statut : implémenté (plans 2 et 3)

## Fonds d'en-tête et photo de profil

- **MED-001** — Une carte a un seul fond d'en-tête, qui est une image ou une vidéo.
- **MED-002** — La vidéo d'en-tête est au format MP4, limitée à 30 s et 25 Mo.
- **MED-003** — Au moment de l'envoi d'une vidéo, une image fixe est capturée dans le navigateur (via un canvas) et sert d'image d'attente (voir PUB-006).
- **MED-021** — Si le navigateur n'a pas pu lire une vidéo choisie dans l'éditeur au bout de 15 secondes, l'envoi est abandonné avec un message, et le champ redevient utilisable.
- **MED-004** — Il n'y a pas de transcodage vidéo côté serveur en v1.
- **MED-005** — Une carte a une seule photo de profil, recadrée en cercle dans l'éditeur.

## Traitement des images

- **MED-006** — Les images sont redimensionnées en plusieurs tailles et converties en WebP côté serveur.
- **MED-007** — Les métadonnées EXIF des images, dont la position GPS, sont supprimées.
- **MED-008** — Le type d'un fichier est vérifié à partir de son contenu réel, pas seulement de son extension.
- **MED-012** — Les images acceptées sont au format JPEG, PNG ou WebP, pèsent au plus 10 Mo et comptent au plus 40 millions de pixels ; les dimensions sont vérifiées avant de décoder l'image entière. Un type refusé donne `415 unsupported_media_type`, un fichier trop lourd `413 payload_too_large`, une image trop grande `400` avec le code `image_too_large`.
- **MED-022** — Une vidéo n'est reconnue comme MP4 que si la marque principale de sa boîte `ftyp`, ou l'une de ses marques compatibles, est une marque MP4 (`isom`, `iso2` à `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `dash`), et que sa marque principale n'est pas celle d'un autre format (QuickTime `qt  `, 3GP `3gp*` et `3g2*`, audio `M4A ` et `M4B `, images `heic`, `heix`, `mif1`, `msf1`, `avif`). Sinon elle est refusée par `415 unsupported_media_type`.
- **MED-013** — La durée d'une vidéo est lue dans le fichier par le serveur, sans se fier au navigateur ; au-delà de 30 s, la vidéo est refusée avec le code `video_too_long`. Une vidéo arrive toujours avec son image d'attente (voir MED-003), traitée comme une image d'en-tête ; sans elle, l'envoi est refusé avec le code `poster_required`.
- **MED-014** — L'orientation EXIF d'une photo est appliquée avant la suppression de ses métadonnées : la photo s'affiche à l'endroit.
- **MED-015** — Tailles produites, sans jamais agrandir l'image d'origine : pour la photo de profil, des carrés de 128, 256 et 512 pixels en WebP, plus 256 et 512 pixels en JPEG pour la vCard et l'aperçu de lien (voir PUB-025 et PUB-028) ; pour le fond d'en-tête et l'image d'attente d'une vidéo, 640, 1 080 et 1 920 pixels de large en WebP.

## Stockage et diffusion

- **MED-009** — Le stockage des médias est le disque local par défaut, ou un stockage compatible S3 par configuration, sans changement de code.
- **MED-010** — En mode disque local, l'API sert `/media/*` avec des en-têtes de cache longs et des noms de fichiers versionnés, derrière n'importe quel reverse proxy et sans partager de volume avec lui.
- **MED-011** — En mode S3, les médias sont servis par l'URL publique du bucket.
- **MED-016** — Un fichier de média n'est jamais modifié : remplacer un média crée un nouveau fichier, sous un nouveau nom. `/media/*` est servi avec l'en-tête `Cache-Control: public, max-age=31536000, immutable`.
- **MED-017** — `/media/*` répond aux requêtes partielles (en-tête `Range`, réponse `206`), sans lesquelles iOS ne lit pas les vidéos.
- **MED-018** — Un média envoyé depuis l'éditeur n'est rattaché à la carte qu'à l'enregistrement (voir EDI-006). Les médias envoyés puis non retenus sont supprimés au prochain enregistrement de la carte, et un média remplacé ou retiré est supprimé du stockage.
- **MED-019** — La suppression d'une carte supprime ses médias du stockage.
- **MED-020** — Seul le propriétaire d'une carte peut lui envoyer ou lui retirer des médias (voir ACC-017).
- **MED-023** — En mode disque local, `/media/cards/<carte>/…` répond 404 quand la carte n'est pas servie (voir LNK-026), ce qui est vérifié à chaque requête. Les adresses de médias que reçoivent le tableau de bord et la page de support portent une signature valable au moins 24 heures, qui les rend lisibles même quand la carte n'est pas servie (voir LNK-008 et ADM-013) ; par exception à MED-016, elles sont servies avec `Cache-Control: private, max-age=86400`. Les copies déjà en cache chez les visiteurs ne sont pas rappelées.
- **MED-024** — En mode S3, les fichiers d'une carte qui n'est pas servie restent lisibles à leur adresse du bucket, qui n'est pas devinable : la v1 ne coupe pas leur diffusion. Ils disparaissent quand le média est remplacé ou retiré (MED-018) ou quand la carte est supprimée (MED-019).
