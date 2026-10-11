# Nightly encrypted dumps (ops/backup) in Azure Blob Storage, same region as the beta
# (decision of 10 October 2026, MOH-5 step 6). Dumps are age-encrypted before upload, so
# Azure only ever stores ciphertext. The VM writes with its managed identity: no storage
# key or token in .env. At stage 1 (Scaleway) the same script targets S3 instead.

resource "random_string" "backup_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "backup" {
  name                            = "${var.name}backup${random_string.backup_suffix.result}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
}

resource "azurerm_storage_container" "backups" {
  name                  = "${var.name}-backups"
  storage_account_id    = azurerm_storage_account.backup.id
  container_access_type = "private"
}

# WORM: a dump cannot be modified or deleted for 7 days, even with our own credentials.
# Left unlocked during the beta (the period can still be changed); lock it before real data.
resource "azurerm_storage_container_immutability_policy" "backups" {
  storage_container_resource_manager_id = azurerm_storage_container.backups.id
  immutability_period_in_days           = 7
  protected_append_writes_enabled       = false
}

resource "azurerm_storage_management_policy" "backup" {
  storage_account_id = azurerm_storage_account.backup.id

  rule {
    name    = "daily"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["${azurerm_storage_container.backups.name}/daily/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 8
      }
    }
  }

  rule {
    name    = "weekly"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["${azurerm_storage_container.backups.name}/weekly/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 29
      }
    }
  }
}

# The VM uploads dumps with its managed identity, scoped to this container only.
resource "azurerm_role_assignment" "vm_backup_writer" {
  scope                = azurerm_storage_container.backups.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_virtual_machine.main.identity[0].principal_id
}

# The person who runs restore tests, pinned so a GitHub apply does not
# replace this grant with the workflow's own identity.
resource "azurerm_role_assignment" "operator_backup_reader" {
  scope                = azurerm_storage_container.backups.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = var.backup_reader_object_id
}
