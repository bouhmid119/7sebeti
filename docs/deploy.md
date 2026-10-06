# Déploiement

| Élément | Hébergement | Domaine |
|---|---|---|
| `apps/web` | Cloudflare Pages | `app.7sebeti.com` |
| `apps/api` | Render, web service Starter, Francfort | `api.7sebeti.com` |
| `apps/worker` | Render, background worker Starter, Francfort | — |
| PostgreSQL | Render Postgres, Francfort | — |
| DNS | Cloudflare (`7sebeti.com`) | — |

## Render

`render.yaml` est un Blueprint : dans Render, *New → Blueprint*, choisir ce repo. Les migrations tournent en `preDeployCommand` avant chaque déploiement de l'API. Renseigner `ENCRYPTION_KEY` (`openssl rand -base64 32`) à la main, identique sur l'API et le worker.

## Cloudflare Pages

- Projet relié à ce repo, branche de production `main`.
- Build command : `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @7sebeti/web build`
- Output directory : `apps/web/dist`
- Variable : `VITE_API_URL=https://api.7sebeti.com`
- Domaine personnalisé : `app.7sebeti.com`. Chaque PR obtient une URL de preview.

## DNS (Cloudflare)

- `app` : géré automatiquement par Cloudflare Pages.
- `api` : CNAME vers l'hôte `*.onrender.com` du service `sebeti-api`, **proxy désactivé** (nuage gris) le temps que Render émette son certificat, puis proxy activable.
- `7sebeti.com` (racine) : réservé au site vitrine.
