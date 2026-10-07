# Déploiement

Production : **Scaleway, région Paris** (décision d'Ahmed, octobre 2026). Repli : Render Francfort avec la même image (`render.yaml`).

| Élément | Hébergement | Domaine |
|---|---|---|
| `apps/web` | Cloudflare Pages | `app.7sebeti.com` |
| `api`, `worker`, Caddy, sauvegarde | Scaleway Instance DEV1-S, Paris (Docker Compose, `ops/deploy/`) | `api.7sebeti.com` |
| PostgreSQL 17 | Scaleway Managed Database DB-DEV-S, Paris, accessible depuis la VM seulement | — |
| Sauvegardes | Cloudflare R2, juridiction UE, dumps chiffrés `age` | — |
| Image | GitHub Container Registry, `ghcr.io/bouhmid119/7sebeti` | — |
| DNS | Cloudflare (`7sebeti.com`) | — |

## L'image

Une seule image (`Dockerfile`), trois rôles : `api`, `worker`, `migrate`. Les apps sont entièrement empaquetées au build, l'image ne contient ni `node_modules` ni sources. Chaque push sur `main` publie `ghcr.io/bouhmid119/7sebeti:latest` et `:<sha>` (`.github/workflows/image.yml`). La CI construit et démarre l'image à chaque PR.

## Mise en place (une fois, par Ahmed)

Rien de payant n'est créé par le code : ces étapes se font dans les consoles.

1. **Scaleway**, projet `7sebeti`, région `fr-par` :
   - Private Network `sebeti`.
   - Managed Database PostgreSQL 17, DB-DEV-S, attachée au Private Network, sans endpoint public ; sauvegardes automatiques activées. Créer la base `sebeti` et un utilisateur dédié.
   - Instance DEV1-S (Debian 12 ou Ubuntu 24.04), attachée au Private Network, IP publique, clé SSH.
   - Security group de l'instance : entrée refusée par défaut, ouvrir 22 (SSH), 80 et 443.
2. **Cloudflare R2** : bucket `sebeti-backups` en juridiction UE ; règles de cycle de vie `daily/` 7 jours, `weekly/` 28 jours ; un jeton API limité à ce bucket.
3. **Clé de sauvegarde** sur un poste de confiance : `age-keygen -o sebeti-backup.key`. La clé publique (`age1…`) va dans `.env` ; le fichier privé reste hors ligne (gestionnaire de mots de passe, copie chez Dali).
4. **DNS** chez Cloudflare : `api` → enregistrement A vers l'IP de la VM, **proxy désactivé** (nuage gris) tant que l'avis juridique sur le proxy n'est pas rendu.
5. **Heartbeats** (Better Stack, gratuit) : un pour la sauvegarde de nuit.

## Préparer la VM

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Mises à jour de sécurité automatiques
sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -f noninteractive unattended-upgrades
# SSH par clé uniquement
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl reload ssh
# Code de déploiement (seulement ops/)
git clone --depth 1 https://github.com/bouhmid119/7sebeti.git && cd 7sebeti/ops/deploy
cp .env.example .env && chmod 600 .env   # puis remplir
```

Si le repo devient privé : `docker login ghcr.io` avec un jeton GitHub en lecture des packages.

Brief IA de nuit : renseigner `ANTHROPIC_API_KEY` dans `.env` ; seul le worker s'en sert (sans elle, le brief est rédigé en phrases fixes). `AI_BRIEF_MODEL` change de modèle sans toucher au code, `AI_BRIEF_ENABLED=false` coupe l'IA. En staging, laisser la clé vide. Détails : `docs/brief-ia.md`.

## Déployer, revenir en arrière

```bash
cd ~/7sebeti/ops/deploy
docker compose pull && docker compose up -d        # migre, puis redémarre api et worker
IMAGE_TAG=<sha> docker compose up -d               # revenir à une version précise
docker compose logs -f api worker
```

Les migrations tournent dans le service `migrate` avant l'API et le worker ; si elles échouent, rien ne redémarre.

## Staging

Second projet Compose sur la même VM (`COMPOSE_PROJECT_NAME=sebeti-staging`, sa propre `.env`, une seconde base sur la même instance managée, `COMPOSE_PROFILES` vide), limites mémoire réduites (`API_MEM_LIMIT=192m`, `WORKER_MEM_LIMIT=192m`). Ajouter son domaine au `Caddyfile` de production.

## Cloudflare Pages (front)

- Build command : `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @7sebeti/web build`
- Output directory : `apps/web/dist`
- Variable : `VITE_API_URL=https://api.7sebeti.com`
- Domaine personnalisé : `app.7sebeti.com`. Chaque PR obtient une URL de preview.

## Repli sur Render

`render.yaml` décrit la même pile en Docker à Francfort (`entrypoint migrate` avant chaque déploiement). Les sauvegardes R2 restent valables : restaurer le dernier dump dans la base Render (`ops/backup/restore-check.sh`), puis basculer le DNS `api`.
