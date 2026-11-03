# Glossaire

Concepts du domaine, tels que la spec les emploie.

| Concept | Définition |
|---|---|
| **Utilisateur** | Titulaire d'un compte. Identifié par le `sub` du JWT de son fournisseur d'identité (avec Clerk, c'est l'identifiant utilisateur Clerk, `user_…`), et enregistré dans la table `users` à la première connexion. Il a un **statut** : `en attente` (`pending`), `validé` (`approved`), `refusé` (`rejected`) ou `suspendu` (`suspended`). |
| **Administrateur** | Un utilisateur dont l'identifiant figure dans la configuration de l'instance. Il valide les inscriptions et peut tout consulter. |
| **Carte** | Une carte de visite digitale. Appartient à un utilisateur. Possède un slug (lien public), un template, des réglages de thème, des médias, un contenu et un état actif/désactivé. |
| **Template** | La mise en page complète d'une carte publique (structure, disposition, animations). C'est du code dans le dépôt. |
| **Thème** | Les réglages visuels appliqués à l'intérieur d'un template (couleurs, police, styles). Ce sont des données. |
| **Événement** | Une période de collecte de contacts rattachée à une carte : titre, description, début, fin optionnelle, champs du formulaire, code d'accès optionnel, limite d'envois par appareil. |
| **Contact collecté** (*lead*) | Une soumission du formulaire d'un événement par un prospect. |

## Termes complémentaires

| Terme | Définition |
|---|---|
| **Prospect** | Visiteur anonyme de la page publique d'une carte, le plus souvent sur mobile. |
| **Porteur** | Propriétaire d'une carte : l'utilisateur qui la gère. |
| **Slug** | Partie variable du lien public d'une carte (`/c/<slug>`). |
| **Slug courant** | Le slug actuel d'une carte, celui de son lien public. |
| **Ancien slug** | Un slug qu'une carte a porté avant son slug courant ; il redirige vers le slug courant (voir LNK-003). |
| **Slug réservé** | Un slug d'une carte supprimée : il reste à son ancien propriétaire, qui peut le rattacher à une nouvelle carte (voir LNK-013 et LNK-014). |
| **Page neutre** | La page « Cette carte n'est plus active », affichée au lien d'une carte qui n'est pas servie (voir LNK-026 et LNK-027). |
| **Média** | Le fond d'en-tête (image ou vidéo) ou la photo de profil d'une carte, stocké dans le stockage de médias. |
| **État d'un événement** | « À venir », « en cours » ou « passé », calculé par le serveur (voir EVT-020). |
| **Fenêtre d'envoi** | La période pendant laquelle le formulaire d'un événement est ouvert : de son début jusqu'à 15 minutes après sa fin (voir EVT-008 et EVT-026). |
| **Identifiant d'appareil** | Un identifiant aléatoire conservé par le navigateur du prospect, qui sert à la limite d'envois par appareil (voir EVT-028). |
| **Champ piège** | Un champ du formulaire invisible pour un humain ; un robot qui le remplit est ignoré (voir ABU-002). |
| **Paire de polices** | Une police de titre et une police de texte, choisies ensemble pour un thème (voir TPL-011). |
