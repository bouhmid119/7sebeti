# 7sebeti v2

SaaS de pilotage de la rentabilité pour le e-commerce COD (Tunisie d'abord). Architecture : `docs/architecture.md`. Déploiement : `docs/deploy.md`.

## Commandes

- `pnpm install`, `pnpm dev` (web :5173, api :4000, worker)
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` : tout doit passer avant un commit
- `pnpm db:generate` après toute modification de `packages/db/src/schema.ts`, puis committer la migration

## Règles

- Règles métier pures et testées dans `packages/domain`, sans I/O. Les apps ne font que de l'orchestration.
- Argent en entiers (unités mineures de la devise de l'organisation, millimes pour le TND), jamais en float.
- Toute table métier porte `organizationId`.
- Tout événement externe est stocké dans `inbound_event` avant traitement ; le traitement est idempotent.
- Secrets d'intégration chiffrés avec `encryptSecret` (`packages/integrations/src/crypto.ts`), jamais renvoyés au front.
- La v1 (référence métier) est dans `../v1-hsebeti`, hors de ce repo.
- Textes de l'interface et documentation en français.
