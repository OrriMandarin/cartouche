# Spec Cartouche

La `spec/` décrit **comment le produit doit se comporter**. Elle est la référence vivante du projet : en cas de désaccord entre le code et la spec, c'est la spec qui fait foi, ou alors la spec doit être modifiée explicitement.

Elle est issue du document de design initial (`docs/superpowers/specs/2026-11-02-cartouche-design.md`, sections 4 à 6 et 7.5), qui n'est plus mis à jour. Les décisions marquées « choix Claude » dans le design y sont devenues des règles ordinaires.

## Fichiers et préfixes

Un fichier par sujet, pour que deux modifications simultanées touchent presque toujours des fichiers différents. Chaque fichier a son propre préfixe d'identifiants : la numérotation est indépendante d'un fichier à l'autre.

Le vérificateur (`node scripts/spec-lint.mjs`) lit ce tableau : un fichier de sujet absent du tableau, ou un préfixe utilisé deux fois, est une erreur.

| Fichier | Préfixe | Sujet |
|---|---|---|
| `card-links.md` | LNK | Lien public, slug, désactivation, suppression |
| `public-page.md` | PUB | Page publique, vCard, aperçus de lien |
| `templates-themes.md` | TPL | Contrat des templates, thèmes, polices |
| `media.md` | MED | Images, vidéos, limites, traitement |
| `events.md` | EVT | Période, chevauchement, code d'accès, limite par appareil |
| `event-form.md` | FRM | Formulaire prospect, champs, consentement |
| `anti-abuse.md` | ABU | Limites par IP, champ piège, spam |
| `leads-exports.md` | LEA | Consultation, suppression, exports des contacts |
| `account-auth.md` | ACC | Compte, authentification, isolation des données |
| `admin-support.md` | ADM | Validation des inscriptions, support, audit |
| `dashboard-editor.md` | EDI | Tableau de bord, éditeur, aperçu en direct |
| `landing.md` | LND | Landing page, pages CGU et confidentialité |

Le glossaire des concepts est dans `glossary.md` (il ne contient pas de règles numérotées).

## Format d'une règle

Une règle est une ligne de liste de la forme :

```
- **XXX-NNN** — Texte de la règle.
```

- `XXX` est le préfixe du fichier (3 lettres majuscules), `NNN` un numéro à 3 chiffres, suivi d'un tiret cadratin entouré d'espaces.
- Une règle décrit **un seul comportement vérifiable**. Les règles sont regroupées sous des titres `##`.
- Un identifiant est **stable** : on ne le renumérote jamais et on ne le réutilise jamais, même si la règle disparaît.
- Une règle qui en concerne une autre la **cite par son identifiant** (par exemple « voir EVT-004 ») au lieu de la recopier, pour ne pas créer deux versions du même texte. Toute citation doit viser une règle existante.
- Chaque fichier de sujet s'ouvre, sous son titre, sur une ligne `> Statut : …` qui dit si le sujet est déjà implémenté ou à quel plan il appartient.
- La spec est rédigée en français, en UTF-8, avec les accents.

## Modifier la spec

1. **Toute fonctionnalité ou correction de bug commence par une mise à jour de la spec.**
2. On vérifie alors qu'**aucune règle existante n'est contredite** (relire les fichiers voisins et suivre les citations).
3. S'il y a une contradiction ou un changement de comportement, on le **signale explicitement au porteur du projet avant de coder**.
4. Un nouveau sujet devient un nouveau fichier, avec un nouveau préfixe déclaré dans le tableau ci-dessus.
5. On lance `node scripts/spec-lint.mjs` (ou `make spec-lint`) : doublons, préfixes incohérents et citations vers des règles inconnues font échouer la vérification.

## Citer une règle dans les tests

Tout test qui vérifie une règle cite son identifiant, pour qu'on retrouve les tests d'une règle et, inversement, les règles d'un test.

- **TypeScript** (`*.test.ts`, `*.spec.ts`, `*.test.tsx`) : l'identifiant figure dans le nom du test, par exemple `test('EVT-004 refuse un quatrième événement simultané', …)`.
- **Rust** (fichiers sous `tests/` et sous `src/` pour les tests en ligne) : un commentaire `// spec: EVT-004` juste avant le test.
- Le vérificateur considère comme citation toute occurrence de `XXX-NNN` (3 lettres majuscules, tiret, 3 chiffres) dans ces fichiers. Une citation vers une règle inexistante est une erreur.
- `node scripts/spec-lint.mjs --coverage` liste en plus les règles qu'aucun test ne cite encore.
