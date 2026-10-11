# CI/CD (GitHub Actions)

Ticket Linear : MOH-22.

| Workflow | Déclencheur | Ce qu'il fait |
|---|---|---|
| `ci.yml` | chaque PR et push sur `main` | recherche de secrets (gitleaks), lint, typecheck, tests sur Postgres, build, image Docker démarrée, `terraform validate` |
| `livraison.yml` | push sur `main` | image `ghcr.io/bouhmid119/7sebeti:<sha>`, déploiement sur la VM, vérification de `https://api.7sebeti.com/health` (version et base) |
| `livraison.yml` (manuel) | Actions > Livraison > Run workflow, avec un sha | redéployer ou revenir à une image existante |
| `terraform.yml` | PR touchant `infra/` | `terraform plan` en lecture seule, résumé dans le run |
| `terraform.yml` | push sur `main` touchant `infra/` | `plan` puis `apply` (Azure, puis DNS), **après l'accord d'Ahmed** dans l'environnement `beta-infra` |
| Dependabot | chaque lundi | PR de mises à jour groupées (npm, Docker, Terraform, actions) |

## Principes

- **Aucun secret Azure dans GitHub.** GitHub prouve son identité à Azure avec un jeton OIDC ; Azure ne l'accepte que pour ce repo et pour un déclencheur précis. Trois identités, chacune avec le minimum de droits (`infra/terraform/bootstrap-azure/github.tf`) :
  - `github-plan` : les PR, en lecture sur le groupe `hsebeti-beta` et sur l'état Terraform ;
  - `github-infra` : l'environnement `beta-infra`, propriétaire du groupe `hsebeti-beta` et écriture de l'état ;
  - `github-app` : l'environnement `beta-app`, contributeur de la seule VM (pour `run-command`).
- **Pas de SSH ouvert à GitHub.** Le déploiement passe par Azure run-command : `ops/deploy/deploy.sh` s'exécute sur la VM.
- **Secrets de l'application sur la VM seulement**, dans `ops/deploy/.env` ; aucun workflow ne les lit.
- **Retour arrière automatique.** Si l'API ne passe pas son healthcheck après le déploiement, `deploy.sh` relance l'image précédente (`ops/deploy/.deployed-tag`) et le workflow échoue. Les migrations déjà appliquées restent : elles doivent toujours être compatibles avec la version précédente (ajouts, pas de suppression dans la même livraison).

Tant que la mise en place ci-dessous n'est pas faite, `livraison.yml` construit seulement l'image et `terraform.yml` ne fait rien : les jobs Azure sont ignorés.

## Mise en place (une fois, par Ahmed)

Depuis le dossier du repo sur le Mac, à jour sur `main`, avec `az login` et `gh auth login` faits.

### 1. Identités Azure pour GitHub

```bash
cd infra/terraform/bootstrap-azure
terraform plan -var subscription_id=$(az account show --query id -o tsv)    # 3 identités, 3 accès fédérés, 5 rôles ; 0 to destroy
terraform apply -var subscription_id=$(az account show --query id -o tsv)
```

L'état de ce dossier est local (`terraform.tfstate`, ignoré par git) : c'est le même que pour la création du stockage de l'état.

### 2. Variables du repo (pas des secrets)

```bash
terraform output -json github_variables \
  | jq -r 'to_entries[] | "\(.key)\t\(.value)"' \
  | while IFS=$'\t' read -r k v; do gh variable set "$k" --body "$v"; done
gh variable set TF_SSH_PUBLIC_KEY < ~/.ssh/id_ed25519.pub
gh variable set CLOUDFLARE_ZONE_ID --body "<id de la zone 7sebeti.com>"     # même valeur que dans infra/terraform/dns/terraform.tfvars
```

### 3. Secrets du repo (privés, masqués dans les logs)

Reprendre les valeurs de `infra/terraform/azure/terraform.tfvars`, au format HCL :

```bash
gh secret set TF_SSH_ALLOWED_CIDRS    # coller par exemple ["203.0.113.7/32"], puis Entrée et Ctrl-D
gh secret set TF_ALERT_EMAILS         # coller par exemple ["toi@exemple.com"]
```

### 4. Environnements GitHub

```bash
REPO=bouhmid119/7sebeti
ME=$(gh api users/bouhmid119 -q .id)
# beta-infra : chaque apply attend ton approbation, seulement depuis main
gh api -X PUT repos/$REPO/environments/beta-infra --input - <<EOF
{"reviewers":[{"type":"User","id":$ME}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api -X POST repos/$REPO/environments/beta-infra/deployment-branch-policies -f name=main
# beta-app : déploiement automatique, seulement depuis main
gh api -X PUT repos/$REPO/environments/beta-app --input - <<EOF
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api -X POST repos/$REPO/environments/beta-app/deployment-branch-policies -f name=main
# jeton Cloudflare (Zone > DNS > Edit, zone 7sebeti.com), visible seulement par beta-infra
gh secret set CLOUDFLARE_API_TOKEN --env beta-infra
```

### 5. Vérifier

1. Actions > Livraison > Run workflow, avec le sha actuellement en production (`curl -s https://api.7sebeti.com/health`) : le job `deploy` doit finir vert sans rien changer.
2. Ouvrir une PR qui touche `infra/` (même un commentaire) : le job `plan` doit afficher « No changes » dans le résumé.

## Au quotidien

- **Livrer** : fusionner une PR dans `main`. L'image est construite, déployée et vérifiée sans action manuelle.
- **Revenir en arrière** : Actions > Livraison > Run workflow avec le sha d'une version précédente.
- **Changer l'infrastructure** : PR qui modifie `infra/terraform`, relire le plan dans le résumé, fusionner, puis approuver le job `apply` dans Actions.
- **Le front** (`app.7sebeti.com`) est construit et publié par Cloudflare Pages à chaque push, avec une URL de preview par PR (`docs/deploy.md`).
