---
name: add-seed-scenario
description: Use when a Cartouche test or demo needs a new named dataset (seed scenario) loadable with make seed or from Playwright via api.seed('<name>').
---

# Ajouter un scénario de données

Les scénarios vivent dans `backend/server/src/test_support/seed.rs` (feature `test-support`, jamais en production). Un scénario est une fonction `fn(&PgPool, DateTime<Utc>) -> BoxFuture<Result<SeedReport, sqlx::Error>>` (type `Scenario`) enregistrée dans `SCENARIOS`. Le second paramètre est **l'heure de l'horloge de l'API** : un scénario date ce qu'il crée par rapport à elle (un événement « commencé il y a deux heures »), pour que les données restent cohérentes quand l'horloge de test est figée (`POST /api/test/clock`). Le scénario `base` est le modèle à copier ; `cards` (cartes d'Alice, Bob et Dan dans différents états, sans média) montre comment remplir `cards`, `events` (événements et contacts d'Alice, voir plus bas) comment dater par rapport à `now`.

| Scénario | Contenu | Dépend de |
|---|---|---|
| `base` | `seed-admin` et un utilisateur par statut | rien |
| `cards` | cartes `alice-durand`, `alice-archive`, `bob-martin`, `dan-moreau`, anciens slugs | `base` (les propriétaires) |
| `events` | huit événements et quatre contacts, dates relatives à T0 (tableau ci-dessous) | `cards` (les cartes, par leur slug), donc `base` |

**Un scénario qui en complète un autre échoue (`RowNotFound`) si on ne charge pas le précédent avant.** `make seed SCENARIO=events` seul ne suffit donc pas : voir « L'utiliser ».

## Étapes

1. **Écrire la fonction** à côté de `base` : `async fn <nom>(pool: &PgPool, now: DateTime<Utc>) -> Result<SeedReport, sqlx::Error>` (`base` n'a pas besoin de l'heure et ne prend que le pool). Les dates d'un scénario sont `now + TimeDelta::minutes(…)`, jamais `Utc::now()`. Elle suppose une base fraîchement vidée par `reset`, mais doit rester rejouable : utiliser `insert … on conflict … do update` comme `base`.
2. **L'enregistrer** dans la constante :
   ```rust
   pub const SCENARIOS: &[(&str, Scenario)] = &[
       ("base", |pool, _| Box::pin(base(pool))),
       ("<nom>", |pool, now| Box::pin(<nom>(pool, now))),
   ];
   ```
3. **Tables** : toute nouvelle table touchée par le scénario doit figurer dans `RESET_TABLES` (même fichier), sinon `reset` ne la vide pas.
4. **Étendre `SeedReport`** si les tests ont besoin d'identifiants créés. Il vaut `SeedReport { users, cards, events }` ; chaque scénario ne renvoie que ses propres lignes (`base` les `users`, `cards` les `cards`, `events` les `events`, les autres listes vides). Il est renvoyé tel quel par `POST /api/test/seed` et affiché par `cartouche-seed` ; dans Playwright, `api.seed("<nom>")` le renvoie (`const { cards } = await api.seed("cards")`), et les interfaces `SeededUser`/`SeededCard`/`SeededEvent` de `frontend/e2e/fixtures.ts` suivent. Des identifiants fixes (`uuid::uuid!`) rendent le scénario rejouable et les tests déterministes.
5. **Test** : un test d'intégration dans `backend/server/tests/test_support.rs` (cité par sa règle `// spec: …` s'il y en a une) qui charge le scénario et vérifie son contenu, plus le test en ligne de `seed.rs` si la logique est non triviale.

## Le scénario `events`

Dates relatives à T0, l'heure de l'horloge de l'API au moment du chargement. Toutes les cartes sont celles de `cards`.

| Événement (carte) | Début / fin (minutes depuis T0) | Particularités |
|---|---|---|
| Salon du Mariage Clermont 2027 (`alice-durand`) | −2 h / +6 h | en cours, 4 champs personnalisés (date, nombre, choix unique, case à cocher), 3 contacts dont un spam |
| Portes ouvertes de l'Atelier (`alice-durand`) | −1 h / sans fin | en cours, code d'accès « Château », 2 envois par appareil, consentement personnalisé |
| Démonstration en boutique (`alice-durand`) | −5 min / +2 h | en cours (le troisième simultané : la limite est atteinte) |
| Atelier découverte (`alice-durand`) | −3 h / −10 min | terminé depuis 10 min, accepte encore les envois (grâce de 15 min) |
| Foire de Lyon (`alice-durand`) | +10 j / +12 j | à venir |
| Salon de Paris 2026 (`alice-durand`) | −40 j / −38 j | passé, 1 contact |
| Événement archivé (`alice-archive`) | −1 h / +1 h | carte désactivée par son propriétaire |
| Salon bloqué (`bob-martin`) | −1 h / +1 h | carte désactivée par le support |

Les accents, apostrophes typographiques et émojis des contacts (« Éloïse D’Aubigné-Müller », « Zoé Lefèvre ✨ ») servent à vérifier l'UTF-8 de bout en bout. **Figer l'horloge avant de charger** : les dates ne sont justes que par rapport à l'heure du chargement.

## Conventions

- Sujets (`sub`) en `seed-<prénom ou rôle>` (`seed-admin`, `seed-alice`…), émetteur `TEST_ISSUER`. `seed-admin` est l'administrateur de la stack de test (`ADMIN_USER_IDS=seed-admin`).
- Données réalistes **avec accents et apostrophes** (`Carole Lefèvre`, `Érin D'Aubigné-Müller`) pour exercer UTF-8 et NFC ; passer les chaînes par `normalize(...)` comme `base`. Adresses en `@example.test`.
- Un scénario **complète** `base` ou le remplace entièrement : le dire dans un commentaire. Les tests e2e partent toujours de `base` (fixture `freshState`).
- Aucune donnée de scénario ne doit pouvoir exister en production : tout reste derrière `test-support`.

## L'utiliser

```bash
make dev-db && make seed SCENARIO=<nom>                              # en local, pour un scénario qui ne dépend de rien
# un scénario qui en complète d'autres se charge dans l'ordre, par exemple les événements :
make seed && make seed SCENARIO=cards && make seed SCENARIO=events   # base, puis cards, puis events
cd backend && cargo run -p cartouche-api --features test-support --bin cartouche-seed -- list   # vérifier qu'il est listé
curl -s -X POST localhost:8080/api/test/seed -H 'content-type: application/json' -d '{"scenario":"<nom>"}'
```

Dans Playwright (`frontend/e2e/tests/*.spec.ts`), la fixture `freshState` a déjà fait `reset` + `seed('base')` avant chaque test ; pour charger un autre scénario :

```ts
test("XXX-NNN : …", async ({ api, page, loginAs }) => {
  await api.reset();
  await api.seed("<nom>");
  await loginAs("seed-alice");
  // …
});
```

Pour les événements, ne pas enchaîner à la main : `api.seedEvents()` fait `reset`, **fige l'horloge à `EVENTS_NOW`** (`frontend/e2e/env.ts`, 2027-03-15T10:00:00Z), puis charge `base`, `cards`, `events` dans l'ordre et renvoie les trois rapports fusionnés. Les identifiants sont ensuite lus dans le rapport (`const { events } = await api.seedEvents()`).

```ts
test("EVT-005 …", async ({ api, page, loginAs }) => {
  const { events } = await api.seedEvents();   // horloge figée en 2027, avant toute connexion
  await loginAs("seed-alice");                 // le jeton est signé à l'heure figée
  // …
});
```

**Ordre impératif : `api.setClock` (ou `seedEvents`) avant `loginAs` et avant `api.token`.** Un jeton signé à l'heure réelle est expiré pour une horloge en 2027. La fixture `freshState` libère l'horloge (`setClock(null)`) avant chaque test. Un nom inconnu répond `unknown_scenario`. Voir aussi `dev-env` (réinitialiser) et `run-tests`.
