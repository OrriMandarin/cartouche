# Page publique et vCard

> Statut : spécifié, non implémenté (plan 2)

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

## vCard

- **PUB-014** — Le bouton « Enregistrer le contact » télécharge une vCard (`.vcf`) en version 3.0, encodée en UTF-8, avec la photo de profil incluse.
- **PUB-015** — La vCard ne contient que les éléments visibles sur la carte.
- **PUB-016** — Dans la vCard, les caractères sont échappés comme l'exige la norme.

## Aperçu de lien

- **PUB-017** — La page expose des balises OpenGraph avec le nom, le poste et la photo, pour un bel aperçu quand le lien est partagé (WhatsApp, LinkedIn…).
