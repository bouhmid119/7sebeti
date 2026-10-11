# Identities used by GitHub Actions (MOH-22). No secret anywhere: GitHub proves who it is with
# an OIDC token, Azure trusts it only for this repository and for the given trigger.
#   plan  : pull requests, read-only (terraform plan)
#   infra : environment "beta-infra" (Ahmed approves every run), terraform apply
#   app   : environment "beta-app", deploys the app on the VM through run-command
# Apply after ../azure exists: it scopes roles to the beta resource group and VM.

variable "github_repository" {
  type    = string
  default = "bouhmid119/7sebeti"
}

# GitHub now puts immutable ids in the OIDC subject: repo:<owner>@<owner id>/<repo>@<repo id>:…
# (gh api repos/bouhmid119/7sebeti --jq ".owner.id, .id"). Renaming the repo keeps working.
variable "github_owner_id" {
  type    = string
  default = "183640184"
}

variable "github_repository_id" {
  type    = string
  default = "1406583076"
}

variable "beta_resource_group" {
  type    = string
  default = "hsebeti-beta"
}

variable "beta_vm_name" {
  type    = string
  default = "hsebeti-vm"
}

data "azurerm_resource_group" "beta" {
  name = var.beta_resource_group
}

data "azurerm_virtual_machine" "beta" {
  name                = var.beta_vm_name
  resource_group_name = var.beta_resource_group
}

locals {
  owner   = split("/", var.github_repository)[0]
  repo    = split("/", var.github_repository)[1]
  subject = "repo:${local.owner}@${var.github_owner_id}/${local.repo}@${var.github_repository_id}"
  github = {
    plan  = "${local.subject}:pull_request"
    infra = "${local.subject}:environment:beta-infra"
    app   = "${local.subject}:environment:beta-app"
  }
}

resource "azurerm_user_assigned_identity" "github" {
  for_each            = local.github
  name                = "github-${each.key}"
  resource_group_name = azurerm_resource_group.tfstate.name
  location            = azurerm_resource_group.tfstate.location
}

resource "azurerm_federated_identity_credential" "github" {
  for_each            = local.github
  name                = "github-${each.key}"
  resource_group_name = azurerm_resource_group.tfstate.name
  parent_id           = azurerm_user_assigned_identity.github[each.key].id
  issuer              = "https://token.actions.githubusercontent.com"
  audience            = ["api://AzureADTokenExchange"]
  subject             = each.value
}

# plan: read the beta resources and the Terraform state, nothing else.
resource "azurerm_role_assignment" "plan_reader" {
  scope                = data.azurerm_resource_group.beta.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.github["plan"].principal_id
}

resource "azurerm_role_assignment" "plan_state" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.github["plan"].principal_id
}

# infra: manage the beta resource group (including the backup role assignments) and write state.
resource "azurerm_role_assignment" "infra_owner" {
  scope                = data.azurerm_resource_group.beta.id
  role_definition_name = "Owner"
  principal_id         = azurerm_user_assigned_identity.github["infra"].principal_id
}

resource "azurerm_role_assignment" "infra_state" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github["infra"].principal_id
}

# app: run the deploy script on the VM, nothing else (no SSH opened to GitHub).
resource "azurerm_role_assignment" "app_vm" {
  scope                = data.azurerm_virtual_machine.beta.id
  role_definition_name = "Virtual Machine Contributor"
  principal_id         = azurerm_user_assigned_identity.github["app"].principal_id
}

output "github_variables" {
  description = "Repository variables to create in GitHub (docs/cicd.md). Not secrets."
  value = {
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = var.subscription_id
    AZURE_CLIENT_ID_PLAN  = azurerm_user_assigned_identity.github["plan"].client_id
    AZURE_CLIENT_ID_INFRA = azurerm_user_assigned_identity.github["infra"].client_id
    AZURE_CLIENT_ID_APP   = azurerm_user_assigned_identity.github["app"].client_id
    TF_STATE_RG           = azurerm_resource_group.tfstate.name
    TF_STATE_ACCOUNT      = azurerm_storage_account.tfstate.name
  }
}
