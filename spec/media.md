# Médias

> Statut : spécifié, non implémenté (plan 2)

## Fonds d'en-tête et photo de profil

- **MED-001** — Une carte a un seul fond d'en-tête, qui est une image ou une vidéo.
- **MED-002** — La vidéo d'en-tête est au format MP4, limitée à 30 s et 25 Mo.
- **MED-003** — Au moment de l'envoi d'une vidéo, une image fixe est capturée dans le navigateur (via un canvas) et sert d'image d'attente (voir PUB-006).
- **MED-004** — Il n'y a pas de transcodage vidéo côté serveur en v1.
- **MED-005** — Une carte a une seule photo de profil, recadrée en cercle dans l'éditeur.

## Traitement des images

- **MED-006** — Les images sont redimensionnées en plusieurs tailles et converties en WebP côté serveur.
- **MED-007** — Les métadonnées EXIF des images, dont la position GPS, sont supprimées.
- **MED-008** — Le type d'un fichier est vérifié à partir de son contenu réel, pas seulement de son extension.

## Stockage et diffusion

- **MED-009** — Le stockage des médias est le disque local par défaut, ou un stockage compatible S3 par configuration, sans changement de code.
- **MED-010** — En mode disque local, l'API sert `/media/*` avec des en-têtes de cache longs et des noms de fichiers versionnés, derrière n'importe quel reverse proxy et sans partager de volume avec lui.
- **MED-011** — En mode S3, les médias sont servis par l'URL publique du bucket.
