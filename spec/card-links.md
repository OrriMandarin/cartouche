# Lien public d'une carte

> Statut : spécifié, non implémenté (plan 2) ; LNK-015 et LNK-016 : plan 4

## Format et unicité

- **LNK-001** — Le lien public d'une carte a la forme `https://<domaine>/c/<slug>`. Le slug est choisi par l'utilisateur ; une proposition lui est faite à partir de son nom.
- **LNK-002** — Un slug est unique sur toute l'instance.

## Changement de slug

- **LNK-003** — Le lien ne casse jamais : quand l'utilisateur change le slug d'une carte, tous les anciens slugs de cette carte redirigent de façon permanente vers le nouveau.
- **LNK-004** — Un ancien slug reste réservé à cette carte : personne d'autre ne peut le prendre.

## Désactivation par le propriétaire

- **LNK-005** — Le propriétaire peut désactiver ou réactiver une carte à tout moment depuis le tableau de bord, en un clic.
- **LNK-006** — Le lien d'une carte désactivée affiche une page neutre « Cette carte n'est plus active », et non une erreur 404.
- **LNK-007** — Sur une carte désactivée, la vCard et les formulaires d'événement sont inaccessibles, y compris pour un événement encore en cours, et le serveur refuse les envois.
- **LNK-008** — Les données d'une carte désactivée (contenu, événements, contacts collectés) sont conservées, et restent visibles et exportables dans le tableau de bord.
- **LNK-009** — Réactiver une carte remet le même lien en service, sans rien changer d'autre.

## Désactivation par le support

- **LNK-010** — La désactivation par le support est un état distinct de la désactivation par le propriétaire. Côté public, la carte affiche la même page neutre (voir LNK-006).
- **LNK-011** — Pour une carte désactivée par le support, le propriétaire voit « Désactivée par le support » dans son tableau de bord et ne peut pas la réactiver lui-même ; seul un administrateur peut lever ce blocage (voir ADM-009 et ADM-010).

## Suppression

- **LNK-012** — La suppression d'une carte est définitive et demande une confirmation. Le lien d'une carte supprimée affiche la même page neutre (voir LNK-006).
- **LNK-013** — Les slugs d'une carte supprimée restent réservés et ne sont jamais réattribués à quelqu'un d'autre, pour qu'une ancienne puce NFC ne pointe jamais vers la carte d'un inconnu.
- **LNK-014** — Le même utilisateur peut rattacher l'un de ses slugs réservés à une nouvelle carte.
- **LNK-015** — À la suppression d'un compte, les slugs de l'utilisateur ne sont conservés que sous forme d'empreinte (hash) dans une table de slugs bloqués, sans lien avec une personne. Ils restent bloqués définitivement : plus personne, y compris l'ancien utilisateur, ne peut les reprendre.
- **LNK-016** — Aucune donnée personnelle n'est conservée après la suppression d'un compte (voir ACC-018), et aucun ancien lien ne peut pointer vers un inconnu.

## Partage

- **LNK-017** — Le tableau de bord permet de copier le lien d'une carte et de télécharger son QR code en SVG et en PNG.
