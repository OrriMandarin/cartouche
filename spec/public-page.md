# Page publique et vCard

> Statut : spécifié, non implémenté (plan 2) ; PUB-008 à PUB-010 : rendus par le template dès le plan 2 (vérifiés avec un événement simulé), alimentés par les vrais événements au plan 3

Cette page décrit le comportement de la page publique, quel que soit le template (voir TPL-003). Le visuel est celui du template « Classique », le template de référence.

## Rendu général

- **PUB-001** — La page publique est pensée pour le mobile d'abord.
- **PUB-002** — La page publique est rendue par le serveur, pour la vitesse et pour les aperçus de lien.
- **PUB-003** — La page est servie en UTF-8 et tous les accents s'y affichent correctement.

## En-tête et profil

- **PUB-004** — L'en-tête est une image ou une vidéo en pleine largeur.
- **PUB-005** — La vidéo d'en-tête est muette, en lecture automatique et en boucle, avec `playsinline` pour ne jamais passer en plein écran sur iOS.
- **PUB-006** — Une image d'attente s'affiche pendant le chargement de la vidéo d'en-tête.
- **PUB-007** — Un dégradé fond l'en-tête dans le contenu, et la photo de profil (ronde) est centrée sur ce dégradé, à cheval entre le média et le contenu.

## Boutons d'événement

- **PUB-008** — Quand un ou plusieurs événements sont en cours, chacun apparaît comme un bouton très visible et animé, portant le nom de l'événement.
- **PUB-009** — Les boutons d'événement sont triés par date de début.
- **PUB-010** — Sans événement en cours, rien ne s'affiche à l'emplacement des boutons d'événement.

## Informations et liens

- **PUB-011** — La page affiche le nom, le poste, l'entreprise, la description et les coordonnées de la carte.
- **PUB-012** — Les liens sont cliquables et accompagnés de leur icône : site personnel, LinkedIn, Instagram, Facebook, TikTok, YouTube, X, plus des liens libres avec un intitulé.
- **PUB-013** — Les liens ouvrent l'application native quand elle est installée.

## Contenu de la carte

- **PUB-018** — Le contenu d'une carte comprend un prénom, un nom, un poste, une entreprise, une description, un email et un téléphone. Le prénom ou le nom est obligatoire (code `required`) ; les autres champs sont facultatifs.
- **PUB-019** — Longueurs maximales, comptées en caractères après normalisation (voir EDI-008) : 100 pour le prénom, le nom, le poste et l'entreprise ; 1 000 pour la description. Au-delà, le champ est refusé avec le code `too_long`.
- **PUB-020** — L'email de la carte doit être valide (code `invalid_email`). Le téléphone est validé et normalisé au format international E.164, la France étant le pays par défaut (code `invalid_phone`), et la page l'affiche au format international.
- **PUB-021** — Sur la page, l'email ouvre la messagerie (`mailto:`) et le téléphone lance l'appel (`tel:`).
- **PUB-022** — Une carte a au plus 20 liens (voir PUB-012), dans l'ordre choisi par son propriétaire. Chaque lien a une adresse absolue en `https://` ou `http://` d'au plus 2 048 caractères ; toute autre forme (`javascript:`, `data:`, adresse relative…) est refusée (code `invalid_url`). Un lien libre a un intitulé obligatoire d'au plus 50 caractères.
- **PUB-023** — Un élément vide n'est pas affiché : pas d'intitulé sans valeur, pas de cercle vide sans photo de profil. Sans fond d'en-tête, l'en-tête prend le fond du thème.

## vCard

- **PUB-014** — Le bouton « Enregistrer le contact » télécharge une vCard (`.vcf`) en version 3.0, encodée en UTF-8, avec la photo de profil incluse.
- **PUB-015** — La vCard ne contient que les éléments visibles sur la carte.
- **PUB-016** — Dans la vCard, les caractères sont échappés comme l'exige la norme.
- **PUB-024** — La vCard contient, quand ils sont renseignés : le nom structuré et le nom complet (`N`, `FN`), l'entreprise (`ORG`), le poste (`TITLE`), l'email (`EMAIL`), le téléphone (`TEL`), un `URL` par lien, la description (`NOTE`) et la photo de profil (`PHOTO`).
- **PUB-025** — La photo de la vCard est un JPEG de 256 × 256 pixels, encodé en base64 : les applications de contacts ne lisent pas le WebP (exception à MED-006, voir MED-015).
- **PUB-026** — Les lignes de la vCard se terminent par CRLF et sont repliées à 75 octets, sans jamais couper un caractère codé sur plusieurs octets.
- **PUB-027** — La vCard est servie avec le type `text/vcard; charset=utf-8`, sous le nom de fichier `<slug>.vcf`.

## Aperçu de lien

- **PUB-017** — La page expose des balises OpenGraph avec le nom, le poste et la photo, pour un bel aperçu quand le lien est partagé (WhatsApp, LinkedIn…).
- **PUB-028** — Les balises OpenGraph donnent : en titre, le nom complet ; en description, le poste et l'entreprise ; en image, l'adresse absolue de la photo de profil en JPEG de 512 × 512 pixels (voir MED-015) ; en adresse canonique, le lien avec le slug courant.
