# Déploiement

Production : **OVHcloud Public Cloud, une seule région en France** (Paris `EU-WEST-PAR`, sinon Gravelines `GRA`) pour la VM, la base et les sauvegardes, dans une seule console (décision d'Ahmed du 10 octobre 2026, qui remplace Scaleway). Repli : Render Francfort avec la même image (`render.yaml`).

| Élément | Hébergement | Domaine |
|---|---|---|
| `apps/web` | Cloudflare Pages | `app.7sebeti.com` |
| `api`, `worker`, Caddy, sauvegarde | OVHcloud instance d2-4 (Docker Compose, `ops/deploy/`) | `api.7sebeti.com` |
| PostgreSQL 17 | OVHcloud Public Cloud Databases, Essential DB1-4, réseau privé, IPs autorisées = IP privée de la VM | — |
| Sauvegardes | OVHcloud Object Storage (API S3, verrouillage des objets), dumps chiffrés `age` | — |
| E-mails transactionnels | Resend, domaine en région `eu-west-1` | `7sebeti.com` |
| Image | GitHub Container Registry, `ghcr.io/bouhmid119/7sebeti` | — |
| DNS | Cloudflare (`7sebeti.com`) | — |

## L'image

Une seule image (`Dockerfile`), trois rôles : `api`, `worker`, `migrate`. Les apps sont entièrement empaquetées au build, l'image ne contient ni `node_modules` ni sources. Chaque push sur `main` publie `ghcr.io/bouhmid119/7sebeti:latest` et `:<sha>` (`.github/workflows/image.yml`). La CI construit et démarre l'image à chaque PR.

## Mise en place (une fois, par Ahmed)

Rien de payant n'est créé par le code : ces étapes se font dans les consoles.

Le pas-à-pas détaillé avec les écrans OVH est dans le ticket Linear MOH-5.

1. **OVHcloud Public Cloud**, projet `7sebeti`, une seule région en France pour tout :
   - réseau privé `sebeti` (vRack, DHCP activé, sans passerelle) ;
   - PostgreSQL 17, offre Essential DB1-4, sur le réseau privé ; créer la base `sebeti` ; l'utilisateur `avnadmin` peut créer des rôles (la migration `0002` en a besoin) ; IPs autorisées : **uniquement** l'IP privée de la VM. L'offre garde 2 jours de sauvegardes, nos dumps de nuit couvrent le reste ;
   - instance d2-4, Ubuntu 24.04, clé SSH, réseau public et réseau privé `sebeti`.
   - télécharger le **certificat CA** de la base (onglet Informations générales) : il ira dans `ops/deploy/db-ca.pem` sur la VM ; l'API, le worker, les migrations et la sauvegarde vérifient le certificat de la base avec lui.
2. **OVHcloud Object Storage**, même région : conteneur `sebeti-backups` créé **avec verrouillage des objets**, rétention par défaut 7 jours en mode conformité ; règles de cycle de vie `daily/` 8 jours, `weekly/` 29 jours ; un utilisateur S3 limité à ce bucket. Reporter `S3_ENDPOINT` (`https://s3.<région>.io.cloud.ovh.net`) et `S3_REGION` dans `.env`. La base et les sauvegardes sont chez le même fournisseur : le verrouillage des objets et le chiffrement `age` (clé hors d'OVH) protègent les dumps même si le compte est compromis.
3. **Resend** : créer le domaine `7sebeti.com` en région **eu-west-1** (choix définitif), ajouter chez Cloudflare les enregistrements SPF, DKIM et DMARC fournis, en « DNS only » ; créer une clé API limitée à l'envoi et la mettre dans `RESEND_API_KEY`. Les e-mails ne contiennent qu'un lien : jamais de nom ni de téléphone de client.
4. **Clé de sauvegarde** sur un poste de confiance : `age-keygen -o sebeti-backup.key`. La clé publique (`age1…`) va dans `.env` ; le fichier privé reste hors ligne (gestionnaire de mots de passe, copie chez Dali).
5. **DNS** chez Cloudflare : `api` → enregistrement A vers l'IP de la VM, **proxy désactivé** (nuage gris) tant que l'avis juridique sur le proxy n'est pas rendu.
6. **Heartbeats** (Better Stack, gratuit) : un pour la sauvegarde de nuit.

## Préparer la VM

```bash
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
# coller le certificat CA de la base dans db-ca.pem
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

`render.yaml` décrit la même pile en Docker à Francfort (`entrypoint migrate` avant chaque déploiement). Les sauvegardes OVH restent valables : restaurer le dernier dump dans la base Render (`ops/backup/restore-check.sh`), puis basculer le DNS `api`.
