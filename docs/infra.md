# Infrastructure (Terraform)

Tout ce qui est payant est décrit dans `infra/terraform` et créé par Ahmed depuis son Mac. Rien n'est appliqué par la CI : elle vérifie seulement le format et la validité.

```
infra/
  cloud-init/vm.yaml        premier démarrage de la VM, identique chez tous les fournisseurs
  terraform/
    bootstrap-azure/        une fois : le stockage chiffré de l'état Terraform
    azure/                  bêta : réseau, VM, PostgreSQL 17 privé, sauvegardes, budget
    dns/                    enregistrement api.7sebeti.com chez Cloudflare
    scaleway/               à venir, étape 1 (MOH-19), mêmes sorties qu'azure/
```

Chaque racine de fournisseur expose les mêmes sorties (`vm_public_ip`, `ssh`, `db_host`, `database_url`, `database_ssl`). Passer d'Azure à Scaleway, c'est appliquer `scaleway/`, migrer la base (`docs/deploy.md`), puis changer `api_ip` dans `dns/`.

L'état Terraform contient le mot de passe de la base : il est stocké dans un compte de stockage Azure privé, sans clé partagée, accessible seulement avec ton `az login`, avec historique des versions. Jamais dans git (`infra/terraform/.gitignore`).

## Pré-requis (une fois)

```bash
brew install terraform azure-cli
az login                                   # ouvre le navigateur
az account show --query id -o tsv          # identifiant d'abonnement
curl -s https://ifconfig.me                # ton IP publique, pour l'accès SSH
```

Pour le DNS : un jeton Cloudflare limité à « Zone > DNS > Edit » sur `7sebeti.com`, exporté dans le terminal (`export CLOUDFLARE_API_TOKEN=…`), jamais écrit dans un fichier du repo.

## 1. Stockage de l'état (une fois)

```bash
cd infra/terraform/bootstrap-azure
terraform init
terraform apply -var subscription_id=<id>
cp ../backend.hcl.example ../backend.hcl   # puis y reporter les valeurs affichées (backend_config)
```

## 2. Bêta Azure

```bash
cd ../azure
cp terraform.tfvars.example terraform.tfvars   # abonnement, clé SSH publique, ton IP, e-mail d'alerte
terraform init -backend-config=../backend.hcl
terraform plan                                  # relire : rien ne doit sortir de l'offre gratuite
terraform apply
terraform output ssh                            # la commande SSH de la VM
```

Ce que ça crée en Denmark East : le groupe `hsebeti-beta`, le réseau `hsebeti-vnet` (sous-réseaux `vm` et `db`), PostgreSQL 17 Flexible Server B1ms 32 Go en accès privé avec la base `hsebeti`, la VM B2ats v2 Ubuntu 24.04 (Docker, swap, pare-feu, mises à jour automatiques, dépôt cloné), son IP publique statique, un pare-feu réseau (SSH depuis ton IP seulement, 80 et 443), un budget avec alertes à 80 % et 100 %, et le stockage des sauvegardes : compte `hsebetibackup…` (sans clé partagée) avec le conteneur `hsebeti-backups`, immuable 7 jours, cycle de vie `daily/` 8 jours et `weekly/` 29 jours. La VM y écrit avec son identité managée ; toi, tu peux lire les dumps pour les tests de restauration. Valeurs pour `.env` : `terraform output backup_env`.

La politique d'immuabilité est créée déverrouillée (on peut encore changer sa durée). Avant les premières données réelles, la verrouiller dans le portail : ce choix est définitif.

**Région et taille.** La bêta a été créée le 10 octobre 2026 en Denmark East avec une VM B1s (offre gratuite) : sur un nouvel abonnement, France Central n'ouvrait aucune taille B (quota « Standard Basv2 Family » à zéro, demande au support en cours). Les valeurs par défaut suivent ce qui existe, pour que chaque `apply` ne fasse que des ajouts ou des mises à jour. Changer `location` recrée toutes les ressources de ce dossier (pas l'état Terraform, qui reste en France Central) : à faire seulement avec une migration de la base (`docs/deploy.md`). Régions de l'UE à essayer si besoin : `francecentral` une fois le quota accordé, `italynorth`, `swedencentral`, `polandcentral`.

**Avant le premier `apply`** : vérifier dans le portail que l'abonnement est bien éligible à l'offre gratuite (VM B1s et base B1ms à 750 h/mois dans la région choisie) et passer le compte en paiement à l'utilisation dans les 30 jours.

## 3. DNS

```bash
cd ../dns
cp terraform.tfvars.example terraform.tfvars   # zone_id, et api_ip = terraform -chdir=../azure output -raw vm_public_ip
terraform init -backend-config=../backend.hcl
terraform apply
```

## 4. Suite

La VM est prête. Remplir `.env` et lancer le premier déploiement : `docs/deploy.md` (sections « Remplir `.env` sur la VM » et « Déployer »).

## Changer ou détruire

- Plus de mémoire : `vm_size = "Standard_B1ms"` dans `terraform.tfvars`, `terraform apply` (redémarre la VM, hors offre gratuite).
- Changer d'hébergeur (Scaleway, étape 1) : `docs/deploy.md`, section « Migration vers Scaleway ».
- Tout supprimer à la fin de la bêta, **après** migration et vérification : `terraform destroy` dans `azure/`. La base est détruite avec : faire un dump d'abord.
- Le fichier `.terraform.lock.hcl` créé par le premier `init` est à committer (versions des providers figées).
