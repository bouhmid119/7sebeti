# Déploiement

Le principe : une VM qui fait tourner l'image Docker avec Docker Compose (`ops/deploy/`), une base PostgreSQL 17 managée sur le réseau privé, et des sauvegardes chiffrées dans un stockage S3. Rien dans le code ni dans le compose ne dépend d'un fournisseur : changer d'hébergeur, c'est recréer une VM et une base, restaurer un dump et basculer le DNS.

| Étape | Hébergement | Pourquoi |
|---|---|---|
| **Bêta** (sans marchand payant) | **Azure France Central** : VM B2ats v2 (2 vCPU, 1 Go), PostgreSQL 17 Flexible Server Burstable B1ms 32 Go en accès privé (VNet) | le moins cher : offre gratuite 12 mois, environ 6,50 $/mois de disque et d'IP (décision d'Ahmed du 10 octobre 2026) |
| **Étape 1** (premiers marchands payants) | **Scaleway Paris** : instance et PostgreSQL managé sur réseau privé | hébergeur européen, conformité (ticket MOH-19, conformité complète MOH-20) |
| Repli | Render Francfort, même image (`render.yaml`) | |

Communs à toutes les étapes :

| Élément | Service | Domaine |
|---|---|---|
| `apps/web` | Cloudflare Pages | `app.7sebeti.com` |
| Sauvegardes | OVHcloud Object Storage, France (API S3, verrouillage des objets), dumps chiffrés `age` ; ne bougent pas aux migrations | — |
| E-mails transactionnels | Resend, domaine en région `eu-west-1` | `7sebeti.com` |
| Image | GitHub Container Registry, `ghcr.io/bouhmid119/7sebeti` | — |
| DNS | Cloudflare (`7sebeti.com`), `api` en DNS seul, TTL 5 minutes | `api.7sebeti.com` |

## L'image

Une seule image (`Dockerfile`), trois rôles : `api`, `worker`, `migrate`. Les apps sont entièrement empaquetées au build, l'image ne contient ni `node_modules` ni sources. Chaque push sur `main` publie `ghcr.io/bouhmid119/7sebeti:latest` et `:<sha>` (`.github/workflows/image.yml`). La CI construit et démarre l'image à chaque PR.

## Mise en place de la bêta (une fois, par Ahmed)

Rien de payant n'est créé par le code. Le pas-à-pas avec les écrans est dans le ticket Linear MOH-5 ; en résumé :

1. **Azure**, groupe de ressources `sebeti-beta` en France Central, budget avec alerte :
   - réseau virtuel `sebeti-vnet` avec deux sous-réseaux (`vm`, `db`) ;
   - PostgreSQL 17 Flexible Server `sebeti-db`, Burstable B1ms 32 Go, **accès privé** sur le sous-réseau `db`, administrateur `sebeti_admin` (il peut créer des rôles, la migration `0002` en a besoin), base `sebeti` ;
   - VM `sebeti-vm` B2ats v2, Ubuntu 24.04 x64, clé SSH, sous-réseau `vm`, IP publique statique, entrées 22, 80 et 443 seulement.
2. **OVHcloud Object Storage** (projet Public Cloud, région Paris) : conteneur S3 `sebeti-backups` créé **avec verrouillage des objets**, rétention par défaut 7 jours en mode conformité ; règles de cycle de vie `daily/` 8 jours, `weekly/` 29 jours ; un utilisateur S3 limité à ce conteneur. Reporter `S3_ENDPOINT` et `S3_REGION` dans `.env`.
3. **Resend** : domaine `7sebeti.com` en région **eu-west-1** (choix définitif), enregistrements SPF, DKIM et DMARC chez Cloudflare en « DNS only », clé API limitée à l'envoi (`RESEND_API_KEY`). Les e-mails ne contiennent qu'un lien : jamais de nom ni de téléphone de client.
4. **Clé de sauvegarde** sur un poste de confiance : `age-keygen -o sebeti-backup.key`. La clé publique (`age1…`) va dans `.env` ; le fichier privé reste hors ligne (gestionnaire de mots de passe, copie chez Dali).
5. **DNS** chez Cloudflare : `api` → enregistrement A vers l'IP de la VM, **proxy désactivé**, TTL 5 minutes.
6. **Heartbeat** Better Stack (gratuit) pour la sauvegarde de nuit.

**Connexion à la base.** Azure impose TLS avec des certificats d'autorités publiques (DigiCert Global Root G2, Microsoft RSA Root CA 2017) : `DATABASE_SSL=verify-full` suffit, sans fichier de CA. `DATABASE_URL` a la forme `postgres://sebeti_admin:…@sebeti-db.postgres.database.azure.com:5432/sebeti`, sans `sslmode`. Pour un fournisseur à CA privée, poser le CA dans `ops/deploy/certs/db-ca.pem` et renseigner `DATABASE_CA_CERT_FILE=/run/secrets/certs/db-ca.pem` et `PGSSLROOTCERT=/run/secrets/certs/db-ca.pem`.

## Préparer la VM

```bash
# 1 Go de RAM : ajouter 1 Go de swap
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Pare-feu : seulement SSH, HTTP et HTTPS
sudo ufw default deny incoming && sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
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

## Mémoire (VM de 1 Go)

Limites du compose : API et worker 256 Mo chacun (tas V8 limité par `NODE_HEAP_MB`, 160 par défaut), Caddy 64 Mo, sauvegarde 128 Mo, plus 1 Go de swap. Si la VM sature (`docker stats`, `free -m`), passer en B1ms (2 Go, hors offre gratuite) avant de toucher aux limites.

Pas de staging pendant la bêta : la VM est trop petite. Il reviendra avec l'étape 1 (second projet Compose, `COMPOSE_PROJECT_NAME=sebeti-staging`, sa propre `.env` et sa propre base).

## Migration vers Scaleway (étape 1, ticket MOH-19)

Le plan détaillé est dans la page Notion « Design d'architecture v2 », section 4.5. Côté technique :

1. Créer l'instance et le PostgreSQL managé Scaleway sur un réseau privé, préparer la VM comme ci-dessus ; si Scaleway fournit un CA privé, le poser dans `certs/`.
2. Baisser le TTL DNS est déjà fait (5 minutes). Annoncer une courte coupure.
3. Arrêter l'API et le worker sur Azure (`docker compose stop api worker`) : plus aucune écriture.
4. `pg_dump` depuis Azure, `pg_restore` vers Scaleway (créer le rôle `app_rw` avant, comme `ops/backup/restore-check.sh`), puis `ops/backup/compare-counts.sh` entre les deux bases.
5. Copier `.env` en changeant seulement `DATABASE_URL` (et le CA si besoin), `docker compose up -d` sur Scaleway.
6. Basculer l'enregistrement `api` vers l'IP Scaleway ; Converty rejoue les webhooks reçus pendant la coupure.
7. Garder Azure arrêté une semaine, puis supprimer le groupe de ressources.

Les sauvegardes OVH, Resend, Cloudflare et l'image ne changent pas.

## Cloudflare Pages (front)

- Build command : `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @7sebeti/web build`
- Output directory : `apps/web/dist`
- Variable : `VITE_API_URL=https://api.7sebeti.com`
- Domaine personnalisé : `app.7sebeti.com`. Chaque PR obtient une URL de preview.

## Repli sur Render

`render.yaml` décrit la même pile en Docker à Francfort (`entrypoint migrate` avant chaque déploiement). Les sauvegardes OVH restent valables : restaurer le dernier dump dans la base Render (`ops/backup/restore-check.sh`), puis basculer le DNS `api`.
