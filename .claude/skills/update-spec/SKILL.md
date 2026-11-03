---
name: update-spec
description: Use when a feature request, change of behavior or bug fix needs a new or modified rule in spec/, before writing any code, or when you need to add a spec file, number a rule, or check that a change does not contradict existing rules.
---

# Modifier la spec sans contradiction

La `spec/` fait foi. **Toute fonctionnalité ou correction de bug commence ici**, avant le code. Format et conventions complets : `spec/README.md`.

## 1. Trouver le bon fichier

Le tableau de `spec/README.md` associe un fichier, un préfixe de 3 lettres et un sujet (`account-auth.md` → `ACC`, `events.md` → `EVT`, …).

```bash
sed -n '/^| Fichier/,/^$/p' spec/README.md      # le tableau
grep -n "^## " spec/<fichier>.md                  # les sections du fichier
```

Un sujet qui n'existe pas encore = un **nouveau fichier** + une ligne dans le tableau avec un préfixe libre (jamais déjà utilisé) + une ligne `> Statut : …` sous le titre.

## 2. Prendre le prochain numéro libre

```bash
grep -o 'ACC-[0-9]\{3\}' spec/account-auth.md | sort -u | tail -3     # remplacer ACC par le préfixe
```

Prendre le suivant. **Ne jamais renuméroter ni réutiliser** un identifiant, même disparu. Une règle = un seul comportement vérifiable, sous la forme :

```
- **ACC-019** — Texte de la règle.
```

(tiret cadratin entouré d'espaces ; français avec accents, UTF-8). Une règle qui en concerne une autre la cite par identifiant (« voir ACC-004 ») au lieu de la recopier.

## 3. Chercher les règles liées et les contradictions

Avant d'écrire, relire les voisines :

```bash
grep -rn -i "<mot-clé>" spec/                 # mots du vocabulaire (statut, limite, lien, appareil…)
grep -rn "ACC-004" spec/ apps e2e --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.next    # qui cite une règle
grep -n -i "<terme>" spec/glossary.md         # le glossaire fixe les termes
```

Suivre chaque identifiant cité par la règle qu'on touche, et chaque règle qui la cite.

## 4. Signaler avant de coder

Si la nouvelle règle **contredit** une règle existante, ou **change un comportement** déjà spécifié ou implémenté : s'arrêter et le dire au porteur du projet (règle concernée, ancien comportement, nouveau, tests à changer). Ne pas coder tant que ce n'est pas tranché. Une règle modifiée garde son identifiant ; les tests qui la citent doivent être relus.

## 5. Vérifier

```bash
node scripts/spec-lint.mjs              # doublons, préfixes, citations vers une règle inexistante
node scripts/spec-lint.mjs --coverage   # en plus : règles qu'aucun test ne cite encore
```

Puis planifier les tests : chaque règle nouvelle ou modifiée a au moins un test qui la cite (`// spec: XXX-NNN` en Rust, `XXX-NNN` dans le nom du test en TypeScript). Mettre à jour la ligne `> Statut` du fichier si le périmètre implémenté change.
