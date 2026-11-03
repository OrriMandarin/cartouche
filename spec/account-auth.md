# Compte et authentification

> Statut : implémenté (plan 1) : ACC-001 à ACC-016 ; ACC-017 : plan 2 (dès les premières ressources utilisateur : cartes) ; ACC-018 : plan 4

## Création du compte et statut

- **ACC-001** — Un compte Cartouche est créé à la première requête authentifiée ; il est identifié par le couple (émetteur `iss`, sujet `sub`) du jeton. Il n'existe qu'un compte par couple, même si plusieurs requêtes simultanées arrivent d'un nouvel utilisateur.
- **ACC-002** — Le statut initial dépend de `SIGNUP_MODE` : `approval` → `pending` ; `open` → `approved` ; `closed` → refus `403 signup_closed`, aucun compte créé. Un administrateur est toujours créé `approved`, quel que soit le mode.
- **ACC-003** — Est administrateur l'utilisateur dont le `sub` figure dans `ADMIN_USER_IDS` (liste séparée par des virgules, espaces ignorés, entrées vides ignorées). C'est évalué à chaque requête, jamais stocké. Un administrateur dont le statut enregistré n'est pas `approved` (par exemple un compte créé `pending` avant qu'il ne devienne administrateur) est passé à `approved` et ce statut est enregistré dès sa requête suivante.
- **ACC-004** — Seul un compte `approved` peut utiliser les fonctions du tableau de bord. Un compte `pending`, `rejected` ou `suspended` reçoit `403` avec le code `account_pending`, `account_rejected` ou `account_suspended`, et l'interface affiche un écran dédié. `GET /api/me` reste accessible quel que soit le statut.
- **ACC-005** — Le statut est relu en base à chaque requête : une suspension ou une validation prend effet à la requête suivante.
- **ACC-006** — L'email et le nom d'affichage sont repris des claims `email` et `name` du jeton à chaque requête où ils sont présents, normalisés en NFC et sans espaces en début et fin.
- **ACC-010** — Un utilisateur crée son compte et se connecte via le fournisseur d'identité, et peut se déconnecter.
- **ACC-011** — Un utilisateur dont le compte est `pending` voit une page « Ton compte est en attente de validation » et ne peut rien créer.
- **ACC-012** — Le mode d'inscription par défaut (`SIGNUP_MODE` absent) est `approval`.

## Vérification du jeton

- **ACC-007** — Sans jeton, ou avec un jeton invalide (signature, émetteur, audience si configurée, `kid` inconnu) → `401 token_invalid` ; jeton expiré → `401 token_expired` (tolérance de 60 s) ; fournisseur de clés injoignable → `503 auth_unavailable` en moins de 6 s.
- **ACC-013** — Le backend vérifie les jetons grâce à `AUTH_ISSUER`, `AUTH_JWKS_URL` et `AUTH_AUDIENCE`, avec un cache des clés publiques (JWKS). Il n'accepte les jetons que d'un seul émetteur de confiance et n'appelle jamais l'API de Clerk.

## Module d'authentification du frontend

- **ACC-014** — Le frontend a un module d'authentification qui expose `getToken()`, `user`, `signIn()` et `signOut()`, avec trois implémentations choisies par configuration : Clerk (par défaut), OIDC générique (Authorization Code + PKCE) et dev/test.
- **ACC-015** — L'implémentation dev/test est un faux émetteur local qui signe ses propres JWT, avec un JWKS servi en local ; elle permet de se connecter en un appel comme n'importe quel utilisateur des données de test.

## Le fournisseur de test n'existe pas en production

- **ACC-008** — Le fournisseur d'authentification de test ne peut pas fonctionner en production : routes de test absentes du binaire de production ; `APP_ENV` absent ⇒ `production` ; démarrage refusé si `APP_ENV=production` et que l'émetteur est l'émetteur de test ; build web refusé si l'adaptateur de test est demandé avec le profil `production`.
- **ACC-009** — En `development` et en `test`, l'interface affiche en permanence un bandeau « MODE TEST ».
- **ACC-016** — Au démarrage, l'API écrit dans ses logs le mode, l'émetteur et les features compilées.

## Isolation des données

- **ACC-017** — Un utilisateur ne voit que ses propres données : chaque requête du tableau de bord est filtrée par l'utilisateur authentifié dès la couche de persistance, et l'accès à la ressource d'un autre utilisateur renvoie une erreur 404. Seul un administrateur voit tout, par les endpoints `/api/admin/*` (voir ADM-001).

## Suppression du compte

- **ACC-018** — La suppression de son compte par un utilisateur supprime toutes ses données (les slugs sont alors traités selon LNK-015).
