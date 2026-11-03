# Contacts collectés et exports

> Statut : spécifié, non implémenté (plan 4) ; la liste des contacts d'un événement, avec marquage spam et suppression, existe depuis le plan 3 (EDI-020)

## Consultation

- **LEA-001** — Le tableau de bord liste les contacts collectés par événement, et propose une vue « toute la carte ».
- **LEA-002** — Le propriétaire peut rechercher parmi ses contacts.
- **LEA-003** — Le propriétaire peut ouvrir la vue détaillée d'un contact.
- **LEA-004** — Depuis la liste ou la vue détaillée, le propriétaire peut marquer un contact comme spam et le supprimer (voir ABU-003 et ABU-004).
- **LEA-005** — La suppression d'un contact sert aussi à répondre à une demande d'effacement RGPD.

## Exports

- **LEA-006** — Le propriétaire peut exporter ses contacts par événement ou pour toute la carte, en CSV, en XLSX ou en JSON.
- **LEA-007** — L'export CSV est en UTF-8 avec BOM, pour que les accents s'affichent correctement dans Excel, et il est compatible avec l'import de Notion.
- **LEA-008** — L'export XLSX est un fichier XLSX natif.
- **LEA-009** — L'export JSON est structuré et conserve les types des champs.
- **LEA-010** — Un export contient une ligne par contact.
- **LEA-011** — Les colonnes d'un export sont, dans l'ordre : les champs standards, les champs personnalisés (y compris ceux qui ont été supprimés depuis, voir FRM-023), puis les métadonnées (événement, date d'envoi, consentement, texte du consentement, spam).
- **LEA-012** — Les contacts marqués spam sont exclus des exports par défaut, avec une option pour les inclure.
