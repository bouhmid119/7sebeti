# Beta infrastructure on Azure Denmark East, where it was created on 10 October 2026 (B sizes
# were not available to the subscription in France Central). Region and size are variables;
# changing the region recreates everything in this root.
# Shape shared with the future Scaleway root (MOH-19): one VM running Docker Compose,
# one managed PostgreSQL 17 on a private network, same cloud-init, same outputs.

terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Filled at init time: terraform init -backend-config=../backend.hcl
  backend "azurerm" {
    key              = "azure-beta.tfstate"
    use_azuread_auth = true
  }
}

provider "azurerm" {
  features {}
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}
