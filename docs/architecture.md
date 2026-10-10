# Architecture v2

Statut : socle en place sur `main` (octobre 2026), choix de la section 10 validés par Ahmed. Domaine `7sebeti.com` (Cloudflare), repo `bouhmid119/7sebeti`. Les décisions à jour sont dans la page Notion « Design d'architecture v2 ».

## 1. Principes

1. **Garder le métier, refaire la structure.** Les règles de la v1 (funnel, attribution agents, packs, upsell, CPL, P&L, trésorerie) sont justes et éprouvées en production. On les porte dans un paquet `domain` pur et testé ; on réécrit tout ce qui l'entoure.
2. **Rester en TypeScript + React + PostgreSQL.** C'est ce que connaissent Dali et Ahmed, ce que Claude manipule le mieux, et ça permet de reprendre le code métier de la v1 presque tel quel.
3. **Rien ne se perd.** Chaque événement externe (webhook Converty, réponse transporteur, insight Meta) est d'abord stocké tel quel, puis traité par une file de jobs durable, rejouable.
4. **SaaS multi-marchands dès le départ.** La v1 l'est déjà à moitié (superadmin, onboarding, modules activables) ; la v2 le fait proprement.
5. **Testé et déployé automatiquement.** Rien n'arrive sur `main` sans CI verte ; c'est la condition pour que Claude puisse coder et réviser sans casser la prod (demande du meeting).
6. **Portable.** Tout tourne dans des conteneurs Docker, sans service propre à un cloud : le passage d'Azure (bêta) à Scaleway (étape 1) est un changement d'hébergeur, pas une réécriture.

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
  web/          React 19 + Vite, TanStack Query, Tailwind 4
  api/          Hono (Node) + Zod
  worker/       pg-boss, jobs et crons
packages/
  domain/       règles métier pures, sans I/O, testées (portées de la v1)
  modules/      un dossier par module métier, chacun avec son schéma Postgres
  db/           client Drizzle, contexte marchand (withTenant), migrations
  integrations/ adaptateurs Converty, transporteurs, Meta ; chiffrement
  contracts/    schémas Zod et noms de files partagés entre apps
  config/       tsconfig partagé
```

### Modules (décision du 8 octobre 2026)

Chaque table appartient à un seul module et vit dans le schéma Postgres de ce module :

| Module | Schéma | Tables |
|---|---|---|
| identity | `identity` | organization, user, membership, session, account, verification, two_factor |
| connectors | `connectors` | integration_connection, inbound_event, external_object_state |
| catalog | `catalog` | product, bundle_component, external_product_link |
| orders | `orders` | order, order_line, order_event, status_mapping |
| assistant | `assistant` | ai_brief, ai_brief_feedback |

Les modules shipping, marketing, finance, analytics et notifications seront créés avec leurs premières tables. Le schéma `public` reste vide.

Règles, vérifiées par `pnpm lint` (`packages/modules/check-boundaries.mjs`) :
- hors d'un module, on n'importe que sa surface publique `@7sebeti/modules/<module>` (`public.ts`) ;
- dans un module, les imports relatifs ne sortent pas du module (sauf `shared/`, colonnes communes) ;
- seul `packages/db` importe `@7sebeti/modules/<module>/schema`, pour assembler le client et les migrations.

Les cas d'usage, routes et jobs d'un module rejoindront son dossier (`app/`, `infra/`, `routes/`, `jobs/`) au fil des chantiers ; aujourd'hui ils sont encore dans `apps/api` et `apps/worker`.

Choix et raisons :
- **SPA Vite plutôt que Next.js** : tout est derrière un login, pas de SEO à faire, et un front statique coûte zéro à héberger.
- **Hono** plutôt qu'Express : typé de bout en bout avec Zod.
- **Drizzle** : les rapports (funnel, P&L) ont besoin de SQL précis, et il n'y a pas de moteur binaire à déployer.

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
- **CI GitHub Actions** : lint, typecheck, tests, build à chaque PR ; revue automatique par Claude ; publication de l'image à chaque push sur `main`, déploiement par `docker compose pull` sur la VM. Un staging reviendra à l'étape 1.
- **Linear** pour les tickets (jalons : infra, données, intégrations, UI), Notion pour la doc, comme décidé au meeting.

## 8. Hébergement et coûts

Le moins cher pendant la bêta, puis un hébergeur européen dès les premiers marchands payants (décision d'Ahmed du 10 octobre 2026). Le design reste indépendant du fournisseur : une VM en Docker Compose, un PostgreSQL managé standard, un stockage S3, aucun service propre à un cloud.

| Étape | Hébergement | Coût |
|---|---|---|
| Bêta | Azure France Central : VM B2ats v2 (2 vCPU, 1 Go) + PostgreSQL 17 Flexible Server B1ms 32 Go en accès privé | ~6,50 $/mois pendant 12 mois (offre gratuite), ~32 $ ensuite |
| Étape 1 | Scaleway Paris : instance + PostgreSQL managé sur réseau privé | ~28 $/mois |
| Commun | Cloudflare Pages et DNS, Resend, GHCR ; sauvegardes chez l'hébergeur de l'étape (Azure Blob immuable, puis S3 à verrouillage) | quelques centimes |

Migration d'une étape à l'autre : dump, restauration, changement de `DATABASE_URL`, bascule DNS (TTL 5 minutes). Procédure : `docs/deploy.md` ; plan : page Notion « Design d'architecture v2 », section 4.5.

**Plus tard** : VM plus grande si la mémoire sature, séparer les workers par file (`WORKER_QUEUES`), puis une base plus grande. Pas de changement de code applicatif.

## 9. Migration depuis la v1

1. **Extraire et tester le métier** : porter les fonctions pures de la v1 dans `packages/domain`, avec des tests nourris par les vraies données de la v1.
2. **Socle v2** : monorepo, CI, auth, organisations, schéma, déploiement de la bêta (fait).
3. **Ingestion** : Converty (webhooks + OAuth), Dropo, Cosmos, Meta, avec reprise de l'historique depuis la base v1 par un script d'import.
4. **Écrans** dans l'ordre de valeur : confirmation (module le plus important selon le meeting), funnel et CPL, P&L, trésorerie, stock, clients, marketing. Avec le design d'Ahmed quand il est prêt.
5. **Double run** : la v2 reçoit les mêmes webhooks que la v1 pendant 2 semaines, le test de parité compare les chiffres chaque jour.
6. **Bascule** marchand par marchand, la v1 reste en lecture seule un mois.

## 10. Décisions prises pour le socle

1. **Approche** : nouvelle structure, métier de la v1 porté dans `packages/domain` avec tests.
2. **Cible** : SaaS multi-marchands dès la v2.
3. **Hébergement** : Azure France Central pendant la bêta (offre gratuite), Scaleway Paris dès les premiers marchands payants, sans service propre à un cloud ; front sur Cloudflare Pages, DNS chez Cloudflare, infrastructure en Terraform (décision d'Ahmed du 10 octobre 2026).
4. **ORM** : Drizzle.

5. **Organisation du code** : un module par domaine dans `packages/modules`, un schéma Postgres par module.
6. **Sauvegardes** chez l'hébergeur de l'étape (Azure Blob pendant la bêta, décision du 10 octobre 2026), **e-mails** par Resend.

## 11. Assistant IA

Signaux testés dans `packages/domain/signals`, brief de nuit dans le worker, API du brief et retours des marchands dans l'API, tables dans le module `assistant`. Détails : `docs/brief-ia.md`.
