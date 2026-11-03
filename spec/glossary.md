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
