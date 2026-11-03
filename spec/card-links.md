# Lien public d'une carte

> Statut : implémenté (plan 2) ; LNK-015 et LNK-016 : plan 4

## Format et unicité

- **LNK-001** — Le lien public d'une carte a la forme `https://<domaine>/c/<slug>`. Le slug est choisi par l'utilisateur ; une proposition lui est faite à partir de son nom.
- **LNK-002** — Un slug est unique sur toute l'instance.
- **LNK-018** — Un slug compte de 3 à 64 caractères : lettres minuscules sans accent, chiffres et tirets, sans tiret au début ni à la fin, et sans deux tirets de suite. La saisie est débarrassée de ses espaces de début et de fin et passée en minuscules avant d'être vérifiée ; un slug invalide est refusé (`400`, champ `slug`, code `invalid_slug`).
- **LNK-019** — La proposition de slug (voir LNK-001) part du prénom et du nom : accents retirés, minuscules, tout autre caractère remplacé par un tiret, puis mise en conformité avec LNK-018 (tirets en trop retirés, 64 caractères au plus). Si ce slug n'est pas libre, on lui ajoute `-2`, `-3`… jusqu'au premier slug libre.
- **LNK-020** — Avant l'enregistrement, le tableau de bord indique si le slug saisi est libre, déjà pris, réservé ou invalide.
- **LNK-021** — Un lien saisi avec des majuscules (`/c/Alice-Durand`) redirige de façon permanente vers sa forme en minuscules.
- **LNK-022** — Réclamer un slug qui appartient à un autre utilisateur (slug courant, ancien slug ou slug réservé) est refusé par `409 slug_taken`, sans dire à qui il appartient. Quand deux demandes réclament le même slug libre au même moment, une seule réussit et l'autre reçoit `409 slug_taken`.
- **LNK-023** — Un slug jamais attribué affiche une page « Carte introuvable », avec le statut HTTP 404.

## Changement de slug

- **LNK-003** — Le lien ne casse jamais : quand l'utilisateur change le slug d'une carte, tous les anciens slugs de cette carte redirigent de façon permanente vers le nouveau.
- **LNK-004** — Un ancien slug reste réservé à cette carte : personne d'autre ne peut le prendre.
- **LNK-024** — La redirection permanente de LNK-003 est une redirection HTTP 308. Elle vaut pour toutes les adresses publiques de la carte : la page et la vCard.
- **LNK-030** — Les redirections de LNK-003 et LNK-021 (page, vCard et formulaire d'événement) portent l'en-tête `Cache-Control: no-store` : un ancien slug peut redevenir le slug courant de sa carte (LNK-025) ou être rattaché à une nouvelle carte (LNK-014), une redirection ne doit donc pas rester en cache.
- **LNK-025** — Une carte peut reprendre l'un de ses propres anciens slugs, qui redevient son slug courant. L'ancien slug d'une carte qui existe toujours ne peut pas être donné à une autre carte, même du même propriétaire (`409 slug_reserved`), car les liens de la première casseraient.

## Désactivation par le propriétaire

- **LNK-005** — Le propriétaire peut désactiver ou réactiver une carte à tout moment depuis le tableau de bord, en un clic.
- **LNK-006** — Le lien d'une carte désactivée affiche une page neutre « Cette carte n'est plus active », et non une erreur 404.
- **LNK-007** — Sur une carte désactivée, la vCard et les formulaires d'événement sont inaccessibles, y compris pour un événement encore en cours, et le serveur refuse les envois.
- **LNK-008** — Les données d'une carte désactivée (contenu, événements, contacts collectés) sont conservées, et restent visibles et exportables dans le tableau de bord.
- **LNK-009** — Réactiver une carte remet le même lien en service, sans rien changer d'autre.
- **LNK-026** — La page publique, la vCard et les formulaires d'une carte ne sont servis que si la carte n'est désactivée ni par son propriétaire ni par le support, et si le compte de son propriétaire est `approved`. Dans tous les autres cas, le lien affiche la page neutre et la vCard répond `410 card_inactive`.
- **LNK-027** — La page neutre est la même, que la carte soit désactivée par son propriétaire ou par le support, supprimée, ou que le compte de son propriétaire soit suspendu : elle ne révèle pas la raison et n'affiche aucune donnée de la carte, pas même dans les balises OpenGraph. Elle est servie avec le statut HTTP 200 et demande aux moteurs de recherche de ne pas l'indexer.

## Désactivation par le support

- **LNK-010** — La désactivation par le support est un état distinct de la désactivation par le propriétaire. Côté public, la carte affiche la même page neutre (voir LNK-006).
- **LNK-011** — Pour une carte désactivée par le support, le propriétaire voit « Désactivée par le support » dans son tableau de bord et ne peut pas la réactiver lui-même ; seul un administrateur peut lever ce blocage (voir ADM-009 et ADM-010).
- **LNK-028** — Les désactivations par le propriétaire et par le support sont indépendantes. Tant que le support bloque une carte, son propriétaire ne peut ni la désactiver ni la réactiver (`409 card_disabled_by_support`) ; quand le support lève le blocage, la carte retrouve l'état que son propriétaire avait choisi.

## Suppression

- **LNK-012** — La suppression d'une carte est définitive et demande une confirmation. Le lien d'une carte supprimée affiche la même page neutre (voir LNK-006).
- **LNK-013** — Les slugs d'une carte supprimée restent réservés et ne sont jamais réattribués à quelqu'un d'autre, pour qu'une ancienne puce NFC ne pointe jamais vers la carte d'un inconnu.
- **LNK-014** — Le même utilisateur peut rattacher l'un de ses slugs réservés à une nouvelle carte.
- **LNK-015** — À la suppression d'un compte, les slugs de l'utilisateur ne sont conservés que sous forme d'empreinte (hash) dans une table de slugs bloqués, sans lien avec une personne. Ils restent bloqués définitivement : plus personne, y compris l'ancien utilisateur, ne peut les reprendre.
- **LNK-016** — Aucune donnée personnelle n'est conservée après la suppression d'un compte (voir ACC-018), et aucun ancien lien ne peut pointer vers un inconnu.

## Partage

- **LNK-017** — Le tableau de bord permet de copier le lien d'une carte et de télécharger son QR code en SVG et en PNG.
- **LNK-029** — Le lien copié et le QR code portent le lien public complet de la carte, avec son slug courant : `PUBLIC_BASE_URL/c/<slug>`.
