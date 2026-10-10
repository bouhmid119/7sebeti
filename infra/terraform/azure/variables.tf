variable "subscription_id" {
  type        = string
  description = "Azure subscription id (az account show --query id -o tsv)."
}

variable "location" {
  type    = string
  default = "francecentral"
}

variable "name" {
  type        = string
  default     = "hsebeti"
  description = "Prefix of every resource."
}

variable "admin_user" {
  type    = string
  default = "hsebeti"
}

variable "ssh_public_key" {
  type        = string
  description = "Content of ~/.ssh/id_ed25519.pub."
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "Addresses allowed to SSH, e.g. [\"203.0.113.7/32\"]. Keep it tight."
}

variable "vm_size" {
  type        = string
  default     = "Standard_B2ats_v2" # free tier, 2 vCPU, 1 GB
  description = "Standard_B1ms (2 GB) if memory runs out."
}

variable "swap_mb" {
  type    = number
  default = 1024
}

variable "postgres_version" {
  type    = string
  default = "17"
}

variable "postgres_sku" {
  type    = string
  default = "B_Standard_B1ms" # free tier
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768 # free tier: 32 GB
}

variable "budget_amount" {
  type        = number
  default     = 15
  description = "Monthly budget in the billing currency; an e-mail alert fires at 80 %."
}

variable "budget_start_date" {
  type        = string
  default     = "2026-10-01T00:00:00Z"
  description = "First day of a month, RFC 3339."
}

variable "alert_emails" {
  type        = list(string)
  description = "Who receives budget alerts."
}
