# Architecture v2

Statut : socle démarré en octobre 2026 avec les choix de la section 10, à confirmer par Ahmed. Domaine `7sebeti.com` (Cloudflare), repo `bouhmid119/7sebeti`.

## 1. Principes

1. **Garder le métier, refaire la structure.** Les règles de la v1 (funnel, attribution agents, packs, upsell, CPL, P&L, trésorerie) sont justes et éprouvées en production. On les porte dans un paquet `domain` pur et testé ; on réécrit tout ce qui l'entoure.
2. **Rester en TypeScript + React + PostgreSQL.** C'est ce que connaissent Dali et Ahmed, ce que Claude manipule le mieux, et ça permet de reprendre le code métier de la v1 presque tel quel.
3. **Rien ne se perd.** Chaque événement externe (webhook Converty, réponse transporteur, insight Meta) est d'abord stocké tel quel, puis traité par une file de jobs durable, rejouable.
4. **SaaS multi-marchands dès le départ.** La v1 l'est déjà à moitié (superadmin, onboarding, modules activables) ; la v2 le fait proprement.
5. **Testé et déployé automatiquement.** Rien n'arrive sur `main` sans CI verte ; c'est la condition pour que Claude puisse coder et réviser sans casser la prod (demande du meeting).
6. **Portable.** Tout tourne dans des conteneurs Docker, donc le passage de Render à AWS ou GCP plus tard est un changement d'hébergeur, pas une réécriture.

## 2. Vue d'ensemble

```
                 ┌──────────── Navigateur (SPA React) ─────────────┐
                 │  app.7sebeti.com   cookies httpOnly, SSE          │
                 └───────────────┬─────────────────────────────────┘
                                 │ HTTPS (API typée)
 Converty ── webhooks ──▶ ┌──────┴───────┐        ┌──────────────────┐
 Dropo/Cosmos ◀── API ──  │   apps/api   │──jobs─▶│   apps/worker    │── Converty, Dropo,
 Meta ◀────────── API ──  │  (HTTP only) │◀─notif─│ (syncs, calculs, │   Cosmos, Meta APIs
                          └──────┬───────┘        │  crons, relances)│
                                 │                └────────┬─────────┘
                                 └──────── PostgreSQL ─────┘
                           (données + file de jobs pg-boss + LISTEN/NOTIFY)
```

- **`apps/api`** ne fait que du HTTP : API pour le front, réception des webhooks (stocker, mettre en file, répondre 200), SSE. Il peut tourner en plusieurs instances.
- **`apps/worker`** exécute les jobs : syncs transporteurs et Meta, traitement des webhooks Converty, recalcul des agrégats, crons. Un seul endroit où tournent les tâches longues ; un déploiement de l'API ne coupe plus une sync.
- **PostgreSQL** sert aussi de file de jobs (**pg-boss**) et de bus temps réel (**LISTEN/NOTIFY**). Pas de Redis à payer ni à opérer au démarrage.

## 3. Structure du repo (monorepo pnpm + Turborepo)

```
apps/
  web/          React 19 + Vite, TanStack Router + Query, Tailwind 4, shadcn/ui
  api/          Hono (Node) + Zod + OpenAPI
  worker/       pg-boss, jobs et crons
packages/
  domain/       règles métier pures, sans I/O (portées de la v1) + tests
  db/           schéma Drizzle ou Prisma, migrations, seed
  integrations/ adaptateurs : converty/, carriers/{dropo,cosmos}/, ads/meta/
  contracts/    schémas Zod partagés front/back, client API généré
  ui/           composants partagés (refonte UI quand le design d'Ahmed arrive)
  config/       tsconfig, eslint, vitest partagés
```

Choix et raisons :
- **SPA Vite plutôt que Next.js** : tout est derrière un login, pas de SEO à faire, et un front statique coûte zéro à héberger.
- **Hono** plutôt qu'Express : typé de bout en bout avec Zod, génère l'OpenAPI, et le client du front est généré depuis le contrat (pas de client maintenu à la main).
- **ORM** : Prisma reste possible pour la continuité ; je penche pour **Drizzle** parce que les rapports (funnel, P&L) ont besoin de SQL précis et qu'il n'y a pas de moteur binaire à déployer. À trancher, ce n'est pas bloquant.

## 4. Modèle de données v2

**Tenant.**
- `organization` (le marchand : devise, fuseau, pays) et `membership` (utilisateur × organisation × rôle). Un agent peut travailler pour deux marchands, un associé peut voir plusieurs boutiques.
- Rôles en enum (`owner`, `admin`, `agent`, `viewer`) + permissions par module ; abonnement et modules activés sur l'organisation.
- Chaque table métier porte `organization_id`, avec la **Row-Level Security Postgres** en garde-fou contre les fuites entre marchands.

**Argent.** Entiers `bigint` en unités mineures (millimes pour le TND, qui a 3 décimales), devise sur l'organisation. Prépare l'Algérie, le Maroc et le Canada évoqués au meeting.

**Commandes normalisées au lieu de recalculs sur JSON :**
- `order` (source, id externe, client, statut normalisé + statut brut, montants), `order_line` (produit, quantité, prix, est_upsell), `order_event` (historique : statut, tentative, agent, horodatage).
- `shipment` et `shipment_event` côté transporteur, liés à `order` quand c'est possible.
- `ad_spend_daily` et `ad_insight_daily` côté Meta.
- `inbound_event` : chaque webhook brut, avec son statut de traitement (reçu, traité, en erreur) et la possibilité de le rejouer.

**Statuts.** Une table de correspondance `statut source → catégorie` (confirmé, sans réponse, refusé, en attente, livré, retourné) éditable par marchand, avec une alerte quand un statut inconnu apparaît.

**Mappings.** `external_product_link` (produit 7sebeti ↔ produit Converty, contenu transporteur, campagne Meta) en vraie table, sans les tableaux et champs legacy de la v1.

**Agrégats.** Le funnel, le P&L, les stats agents et clients deviennent des tables d'agrégats journaliers mises à jour **incrémentalement** par le worker à chaque événement (seulement les jours touchés), au lieu de relire 21 jours de JSON à chaque fois.

**Secrets.** Tokens Converty, transporteurs et Meta chiffrés en AES-GCM avec une clé hors base (variable d'environnement au départ, KMS plus tard).

## 5. Intégrations

Chaque source implémente une interface commune dans `packages/integrations` :
- `OrderSource` : Converty d'abord (plus tard YouCan, Shopify si besoin) ;
- `Carrier` : Dropo, Cosmos, puis les 2-3 transporteurs suggérés au meeting ;
- `AdPlatform` : Meta d'abord, TikTok possible.

**Converty en v2** :
- Un connecteur isolé `integrations/converty` derrière l'interface `OrderSource`, avec trois implémentations interchangeables : **API actuelle** (OAuth partenaire + webhooks, ce qu'utilise la v1), **Google Sheets** en secours, **import CSV** pour la reprise d'historique. Une API partenaire officielle, si Converty l'ouvre, devient une quatrième implémentation sans toucher au reste.
- OAuth avec stockage et **rafraîchissement du refresh token pour chaque boutique**.
- Webhook : stocker dans `inbound_event`, répondre 200, mettre en file. Si le stockage échoue, répondre 500 pour que Converty réessaie.
- Le worker normalise vers `order` / `order_line` / `order_event` (historique jamais écrasé) et met à jour les agrégats des jours touchés.
- **Réconciliation quotidienne** sur 30 à 45 jours glissants, en respectant la limite de débit (429) de `/orders`.
- **Page santé** par boutique : dernière sync, commandes reçues, erreurs, statuts inconnus, produits non liés ; alerte si une boutique échoue plusieurs fois.
- Tests de contrat sur des payloads réels anonymisés, pour voir une casse côté Converty en quelques heures.

## 6. Auth et sécurité

- Sessions par **cookie httpOnly** (Better Auth, auto-hébergé, gratuit), plus de JWT dans `localStorage` ; invitations d'agents par e-mail ; 2FA optionnelle pour les owners.
- Secrets séparés par usage (session, tickets SSE, state OAuth), audience vérifiée.
- CORS limité aux domaines 7sebeti ; pas de compte admin par défaut.
- Journal d'audit généralisé (qui a changé quoi), comme la v1 le fait déjà pour la trésorerie.

## 7. Qualité et workflow

- **Tests** : Vitest pour `domain` (objectif : chaque règle portée de la v1 a ses tests, avec des cas réels), tests d'intégration API sur une base Postgres éphémère, quelques parcours Playwright (connexion, tableau de bord, funnel).
- **Test de parité** pendant la migration : mêmes données en entrée, la v2 doit retrouver les chiffres de la v1 (funnel, P&L) au dinar près.
- **CI GitHub Actions** : lint, typecheck, tests, build à chaque PR ; revue automatique par Claude ; déploiement auto de `main` en staging puis promotion en prod.
- **Linear** pour les tickets (jalons : infra, données, intégrations, UI), Notion pour la doc, comme décidé au meeting.

## 8. Hébergement et coûts

**Phase 1, démarrage (Render à Francfort + Cloudflare), environ 25 à 40 $/mois :**

| Service | Plan | Coût indicatif |
|---|---|---|
| `web` (Cloudflare Pages, app.7sebeti.com) | gratuit | 0 $ |
| `api` (api.7sebeti.com) | Render Starter, toujours allumé | ~7 $ |
| `worker` | Background worker Starter | ~7 $ |
| PostgreSQL | Render Postgres Basic 1 GB (ou Neon Launch) | ~6 à 19 $ |
| Erreurs | Sentry gratuit | 0 $ |
| Disponibilité | Better Stack ou UptimeRobot gratuit | 0 $ |
| Staging | même chose en plus petit, éteint la nuit | ~5 à 10 $ |

Ça colle au budget évoqué au meeting (~20-30 $/mois) et supprime le self-ping et les réveils de base de la v1. Prix à reconfirmer sur les grilles Render au moment de créer les services.

**Phase 2, quand le volume le justifie** : les mêmes conteneurs sur AWS (ECS Fargate + RDS) ou GCP (Cloud Run + Cloud SQL), Redis + BullMQ si pg-boss devient le goulot. Pas de changement de code applicatif.

## 9. Migration depuis la v1

1. **Extraire et tester le métier** : porter les fonctions pures de la v1 dans `packages/domain`, avec des tests nourris par les vraies données de la v1.
2. **Socle v2** : monorepo, CI, auth, organisations, schéma, déploiement staging.
3. **Ingestion** : Converty (webhooks + OAuth), Dropo, Cosmos, Meta, avec reprise de l'historique depuis la base v1 par un script d'import.
4. **Écrans** dans l'ordre de valeur : confirmation (module le plus important selon le meeting), funnel et CPL, P&L, trésorerie, stock, clients, marketing. Avec le design d'Ahmed quand il est prêt.
5. **Double run** : la v2 reçoit les mêmes webhooks que la v1 pendant 2 semaines, le test de parité compare les chiffres chaque jour.
6. **Bascule** marchand par marchand, la v1 reste en lecture seule un mois.

## 10. Décisions prises pour le socle

1. **Approche** : nouvelle structure, métier de la v1 porté dans `packages/domain` avec tests.
2. **Cible** : SaaS multi-marchands dès la v2.
3. **Hébergement phase 1** : Render (API, worker, Postgres) à Francfort, front sur Cloudflare Pages, DNS `7sebeti.com` chez Cloudflare.
4. **ORM** : Drizzle.

Ces choix restent réversibles tant que le métier n'est pas porté.

## 11. Place réservée à l'assistant IA

Le chantier IA s'appuie sur ce socle : règles de détection testées dans `packages/domain/signals`, job de nuit `ai.daily-brief` dans le worker (après l'ingestion et les agrégats), endpoint « Explique-moi » dans l'API. Rien n'est codé à ce stade.
