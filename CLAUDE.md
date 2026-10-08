# 7sebeti v2

SaaS de pilotage de la rentabilité pour le e-commerce COD (Tunisie d'abord). Architecture : `docs/architecture.md`. Sécurité : `docs/securite.md`. Déploiement : `docs/deploy.md`.

## Commandes

- `pnpm install`, `pnpm dev` (web :5173, api :4000, worker)
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` : tout doit passer avant un commit. Avec `DATABASE_URL` vers une base migrée, `pnpm test` lance aussi les tests RLS et API.
- `pnpm db:generate` après toute modification de `packages/db/src/schema.ts`, puis committer la migration

## Règles

- Règles métier pures et testées dans `packages/domain`, sans I/O. Les apps ne font que de l'orchestration.
- Argent en entiers (unités mineures de la devise de l'organisation, millimes pour le TND), jamais en float.
- Toute table métier porte `organizationId` et passe sous RLS (ajouter la politique dans une migration ; le test de CI le vérifie).
- Toute requête métier passe par `withTenant(db, organizationId, …)`. Accès hors tenant (routage des webhooks, création d'organisation, purges) : seulement là où c'est nécessaire, et commenté.
- Tout contenu externe nouveau est stocké dans `inbound_event` (chiffré) avant traitement ; un contenu identique au précédent n'est que compté ; le traitement est idempotent.
- Données personnelles des clients : téléphone en HMAC + 3 derniers chiffres, nom chiffré avec la clé de l'organisation. Jamais de donnée personnelle ni de secret dans les logs.
- Secrets d'intégration chiffrés avec `encryptSecret`, jamais renvoyés au front.
- La v1 (référence métier) est dans `../v1-hsebeti`, hors de ce repo.
- Textes de l'interface et documentation en français.
