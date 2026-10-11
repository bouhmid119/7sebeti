# Déploiement

Le principe : une VM qui fait tourner l'image Docker avec Docker Compose (`ops/deploy/`), une base PostgreSQL 17 managée sur un réseau privé, et des sauvegardes chiffrées dans un stockage objet (Azure Blob pendant la bêta, S3 ensuite). Rien dans le code ni dans le compose ne dépend d'un fournisseur : changer d'hébergeur, c'est recréer une VM et une base, restaurer un dump et basculer le DNS.

| Étape | Hébergement | Pourquoi |
|---|---|---|
| **Bêta** (sans marchand payant) | **Azure Denmark East**, sauvegardes comprises : VM B1s (1 vCPU, 1 Go ; région et taille expliquées dans `docs/infra.md`), PostgreSQL 17 Flexible Server Burstable B1ms 32 Go en accès privé, créés par Terraform (`docs/infra.md`) | le moins cher : offre gratuite 12 mois, environ 6,50 $/mois de disque et d'IP (décision d'Ahmed du 10 octobre 2026) |
| **Étape 1** (premiers marchands payants) | **Scaleway Paris** : instance et PostgreSQL managé sur réseau privé | hébergeur européen, conformité (ticket MOH-19, conformité complète MOH-20) |

Les sauvegardes suivent l'hébergeur : Azure Blob Storage pendant la bêta (même région, immuables 7 jours, écrites par l'identité managée de la VM, sans clé dans `.env`), un stockage S3 à verrouillage d'objets à l'étape 1 (`BACKUP_TARGET=s3`). Dans les deux cas, les dumps sont chiffrés avec `age` avant l'envoi : le fournisseur ne voit jamais que du chiffré.

Communs à toutes les étapes, ils ne bougent pas aux migrations :

| Élément | Service | Domaine |
|---|---|---|
| `apps/web` | Cloudflare Pages | `app.7sebeti.com` |
| E-mails transactionnels | Resend, domaine en région `eu-west-1` | `7sebeti.com` |
| Image | GitHub Container Registry, `ghcr.io/bouhmid119/7sebeti` | — |
| DNS | Cloudflare, `api` en DNS seul, TTL 5 minutes (Terraform, `infra/terraform/dns`) | `api.7sebeti.com` |

## L'image

Une seule image (`Dockerfile`), trois rôles : `api`, `worker`, `migrate`. Les apps sont entièrement empaquetées au build, l'image ne contient ni `node_modules` ni sources. Chaque push sur `main` publie `ghcr.io/bouhmid119/7sebeti:latest` et `:<sha>` (`.github/workflows/livraison.yml`). La CI construit et démarre l'image à chaque PR.

## Mise en place (une fois, par Ahmed)

Rien de payant n'est créé par le code ni par la CI. Le pas-à-pas avec les écrans est dans le ticket Linear MOH-5.

1. **Infrastructure Azure et DNS** : Terraform, voir `docs/infra.md`. La VM arrive prête au premier démarrage (`infra/cloud-init/vm.yaml` : swap de 1 Go, Docker, pare-feu `ufw` limité à 22/80/443, mises à jour de sécurité automatiques, SSH par clé seulement, dépôt cloné dans `~/7sebeti`).
2. **Resend** : domaine `7sebeti.com` en région **eu-west-1** (choix définitif), enregistrements SPF, DKIM et DMARC chez Cloudflare en « DNS only », clé API limitée à l'envoi. Les e-mails ne contiennent qu'un lien : jamais de nom ni de téléphone de client.
3. **Clé de sauvegarde** sur un poste de confiance : `age-keygen -o hsebeti-backup.key`. La clé publique (`age1…`) va dans `.env` ; le fichier privé reste hors ligne (gestionnaire de mots de passe, copie chez Dali).
4. **Heartbeat** Better Stack (gratuit) pour la sauvegarde de nuit.

## Remplir `.env` sur la VM

Les secrets ne passent ni par Terraform ni par git : Ahmed les colle lui-même.

```bash
terraform -chdir=infra/terraform/azure output -raw database_url   # sur le Mac → DATABASE_URL
ssh hsebeti@<IP>
cd ~/7sebeti/ops/deploy && cp .env.example .env && chmod 600 .env && nano .env
```

`ops/deploy/.env.example` liste chaque variable. Points d'attention :

- **Base** : `DATABASE_URL` sans `sslmode`, et `DATABASE_SSL=verify-full`. Azure signe ses certificats avec des autorités publiques (DigiCert Global Root G2, Microsoft RSA Root CA 2017), donc aucun fichier de CA n'est nécessaire. Pour un fournisseur à CA privée (à vérifier chez Scaleway), poser le CA dans `ops/deploy/certs/db-ca.pem` et renseigner `DATABASE_CA_CERT_FILE` et `PGSSLROOTCERT`.
- **Clés** : `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` et `DATA_MASTER_KEY` se génèrent avec `openssl rand -base64 32` (préfixer `v1:` pour les deux trousseaux). Les ranger aussi dans le gestionnaire de mots de passe : sans `DATA_MASTER_KEY`, les données chiffrées sont perdues.
- **Sauvegardes** : `BACKUP_TARGET=azure`, `AZURE_STORAGE_ACCOUNT` et `AZURE_STORAGE_CONTAINER` (`terraform output backup_env`), `BACKUP_AGE_RECIPIENT`, `HEARTBEAT_URL`. Aucune clé de stockage : la VM s'authentifie avec son identité managée.
- **Brief IA de nuit** : `ANTHROPIC_API_KEY`, utilisée par le worker seulement (sans elle, le brief est rédigé en phrases fixes). `AI_BRIEF_MODEL` change de modèle sans toucher au code, `AI_BRIEF_ENABLED=false` coupe l'IA. Détails : `docs/brief-ia.md`.

Si le repo devient privé : `docker login ghcr.io` sur la VM avec un jeton GitHub en lecture des packages.

## Déployer, revenir en arrière

Automatique : chaque fusion dans `main` construit l'image, la déploie sur la VM et vérifie `/health` ; un échec relance la version précédente. Revenir à une version : Actions > Livraison > Run workflow avec son sha. Détails et mise en place : `docs/cicd.md`.

À la main, sur la VM, si GitHub Actions n'est pas disponible :

```bash
sudo TAG=<sha> bash ~/7sebeti/ops/deploy/deploy.sh   # même script que la CI : migrations, redémarrage, santé, retour arrière
cd ~/7sebeti/ops/deploy && docker compose logs -f api worker
```

Les migrations tournent dans le service `migrate` avant l'API et le worker ; si elles échouent, rien ne redémarre.

## Mémoire (VM de 1 Go)

Limites du compose : API et worker 256 Mo chacun (tas V8 limité par `NODE_HEAP_MB`, 160 par défaut), Caddy 64 Mo, sauvegarde 128 Mo, plus 1 Go de swap. Si la VM sature (`docker stats`, `free -m`), passer en B1ms (2 Go, hors offre gratuite) avant de toucher aux limites (`vm_size` dans Terraform).

Pas de staging pendant la bêta : la VM est trop petite. Il reviendra avec l'étape 1 (second projet Compose, `COMPOSE_PROJECT_NAME=hsebeti-staging`, sa propre `.env` et sa propre base).

## Migration vers Scaleway (étape 1, ticket MOH-19)

Le plan détaillé est dans la page Notion « Design d'architecture v2 », section 4.5. Côté technique :

1. Écrire `infra/terraform/scaleway/` avec les mêmes sorties qu'`azure/`, puis l'appliquer ; la VM démarre avec le même cloud-init. Si Scaleway fournit un CA privé, le poser dans `certs/`.
2. Le TTL DNS est déjà à 5 minutes. Annoncer une courte coupure.
3. Arrêter l'API et le worker sur Azure (`docker compose stop api worker`) : plus aucune écriture.
4. `pg_dump` depuis Azure, `pg_restore` vers Scaleway (créer le rôle `app_rw` avant, comme `ops/backup/restore-check.sh`), puis `ops/backup/compare-counts.sh` entre les deux bases.
5. Copier `.env` en changeant seulement `DATABASE_URL` (et le CA si besoin), `docker compose up -d` sur Scaleway.
6. Changer `api_ip` dans `infra/terraform/dns` et l'appliquer ; Converty rejoue les webhooks reçus pendant la coupure.
7. Garder Azure arrêté une semaine, puis `terraform destroy` dans `infra/terraform/azure`.

## Cloudflare Pages (front)

- Build command : `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @7sebeti/web build`
- Output directory : `apps/web/dist`
- Variable : `VITE_API_URL=https://api.7sebeti.com`
- Domaine personnalisé : `app.7sebeti.com`. Chaque PR obtient une URL de preview.
