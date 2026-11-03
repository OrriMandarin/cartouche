# Formulaire d'événement

> Statut : spécifié, non implémenté (plan 3)

## Parcours du prospect

- **FRM-001** — Un clic sur le bouton d'événement ouvre le formulaire en plein écran, avec un bouton de retour vers la carte.
- **FRM-002** — Si l'événement a un code d'accès, un écran demande le code avant le formulaire (voir EVT-011, EVT-012 et EVT-013).
- **FRM-003** — Le formulaire affiche le titre et la description de l'événement, puis les champs standards activés, puis les champs personnalisés.
- **FRM-004** — Après l'envoi, un écran de confirmation propose d'enregistrer la vCard du porteur, puis un retour à la carte.
- **FRM-005** — Le formulaire est accessible : libellés, navigation au clavier, types de clavier mobile adaptés (`type="email"`, `inputmode="tel"`…).

## Consentement

- **FRM-006** — Le consentement est obligatoire : une case à cocher accompagne un texte de mentions légales.
- **FRM-007** — Un texte de mentions légales par défaut, en français et conforme à l'esprit du RGPD, est fourni ; il peut être remplacé par événement.
- **FRM-008** — À l'envoi, le serveur enregistre l'horodatage du consentement et le texte exact accepté.
- **FRM-009** — Le responsable des données est le propriétaire de la carte, pas l'opérateur de l'instance : le texte par défaut est rempli automatiquement avec le nom ou l'entreprise et l'email de la carte.
- **FRM-010** — Le texte par défaut précise la finalité (recontact commercial lié à l'événement) et le droit d'accès et de suppression.
- **FRM-011** — Le texte par défaut ne s'engage sur aucune durée de conservation chiffrée : il n'y a pas de suppression automatique en v1, la suppression reste manuelle.

## Validation

- **FRM-012** — L'email saisi doit être valide.
- **FRM-013** — Le téléphone est validé et normalisé au format international E.164, la France étant le pays par défaut.
- **FRM-014** — Les dates saisies doivent être valides.
- **FRM-015** — Les erreurs s'affichent à côté de chaque champ, et la saisie n'est jamais perdue.
- **FRM-016** — Les chaînes saisies sont normalisées en NFC avant d'être stockées.

## Champs standards

- **FRM-017** — Les champs standards que le propriétaire peut cocher sont : prénom, nom, date de naissance, email, téléphone et adresse postale.
- **FRM-018** — L'adresse postale se décompose en rue, code postal, ville et pays.
- **FRM-019** — Chaque champ standard coché peut être obligatoire ou facultatif.

## Champs personnalisés

- **FRM-020** — Le propriétaire peut ajouter autant de champs personnalisés qu'il veut, et les ordonner. Chaque champ a un libellé, un type, un caractère obligatoire ou non, et un texte d'aide optionnel.
- **FRM-021** — Les types de champ personnalisé sont : `texte`, `texte long`, `date`, `nombre`, `choix unique` (avec une liste d'options) et `case à cocher`.

## Évolution des champs

- **FRM-022** — Modifier les champs d'un événement alors que des contacts existent déjà ne casse jamais les contacts existants : chaque contact conserve ses réponses avec le libellé et le type du champ au moment de l'envoi.
- **FRM-023** — Un champ supprimé reste visible sur les anciens contacts et dans les exports (voir LEA-011).
