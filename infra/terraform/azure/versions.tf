# Beta infrastructure on Azure France Central (decision of 10 October 2026). The VM needs the
# Standard Basv2 Family vCPU quota there; another region is a one-variable change (location).
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
