# DNS records for 7sebeti.com at Cloudflare. Kept apart from the provider roots: moving
# from Azure to Scaleway (MOH-19) is a one-variable change here (api_ip), with a 5-minute TTL.
# DNS only, no Cloudflare proxy on the API (decision 3 of the architecture page).

terraform {
  required_version = ">= 1.9"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
  # Same state storage as the other roots: terraform init -backend-config=../backend.hcl
  backend "azurerm" {
    key              = "dns.tfstate"
    use_azuread_auth = true
  }
}

# Token from the CLOUDFLARE_API_TOKEN environment variable (Zone > DNS > Edit, this zone only).
provider "cloudflare" {}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone id of 7sebeti.com (dashboard > Overview)."
}

variable "api_ip" {
  type        = string
  description = "Public IP of the VM: terraform -chdir=../azure output -raw vm_public_ip"
}

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = "api.7sebeti.com"
  type    = "A"
  content = var.api_ip
  ttl     = 300
  proxied = false
  comment = "API (VM). Managed by Terraform, infra/terraform/dns."
}
