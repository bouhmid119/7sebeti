# 7sebeti

Pilotage de la rentabilité pour le e-commerce en paiement à la livraison (COD) : funnel de confirmation, livraisons, P&L, trésorerie et stock, à partir de Converty, des transporteurs et de Meta Ads.

Ce repo contient la v2, réécrite à partir de la v1. L'architecture est décrite dans [docs/architecture.md](docs/architecture.md), le déploiement dans [docs/deploy.md](docs/deploy.md).

## Structure

```
apps/
  web/           SPA React 19 + Vite + Tailwind 4 (app.7sebeti.com, Cloudflare Pages)
  api/           API HTTP Hono : santé, webhooks, API du front (api.7sebeti.com, OVHcloud France)
  worker/        jobs pg-boss : ingestion des commandes, syncs, crons (OVHcloud France)
packages/
  domain/        règles métier pures et testées (statuts, argent, téléphones…)
  db/            schéma Drizzle et migrations PostgreSQL
  contracts/     schémas Zod et noms de files partagés entre apps
  integrations/  adaptateurs Converty, transporteurs, Meta ; chiffrement des secrets
  config/        tsconfig partagé
```

Les règles métier vivent dans `packages/domain` (sans I/O), les jobs dans `apps/worker/src/jobs`.

## Démarrer en local

Prérequis : Node 22+, pnpm (`corepack enable`), PostgreSQL 17 (`docker compose up -d` ou une instance locale dont l'utilisateur est superutilisateur : la migration `0002_rls` crée le rôle `app_rw`).

```bash
pnpm install
cp .env.example .env          # puis renseigner ENCRYPTION_KEY, DATA_MASTER_KEY et BETTER_AUTH_SECRET,
                              # chacun avec : openssl rand -base64 32
set -a; . ./.env; set +a      # drizzle-kit et Vitest ne lisent pas .env
pnpm db:migrate
pnpm dev                      # web :5173, api :4000, worker
```

Sans `DATA_MASTER_KEY` ou `BETTER_AUTH_SECRET`, l'API et le worker s'arrêtent au démarrage alors que le web répond quand même : vérifier `curl localhost:4000/health`. `pnpm test` ne lance les tests RLS et API que si `DATABASE_URL` est exporté dans le shell.

Pour travailler avec Cursor : [docs/cursor.md](docs/cursor.md).

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm typecheck` | TypeScript sur tout le monorepo |
| `pnpm test` | Vitest |
| `pnpm build` | builds de production |
| `pnpm db:generate` | génère une migration après modification de `packages/db/src/schema.ts` |
| `pnpm db:migrate` | applique les migrations |

## Flux d'une commande Converty

1. Converty appelle `POST /webhooks/converty/:connectionId/:secret`.
2. L'API stocke le payload tel quel dans `inbound_event`, met un job en file, répond 200. Si le stockage échoue, elle répond 500 et Converty réessaie.
3. Le worker normalise la commande (`order`, `order_line`, `order_event`), de façon idempotente : rejouer un événement ne double rien, un événement plus ancien que l'état stocké est ignoré.
