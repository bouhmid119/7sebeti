# Private DNS so the VM resolves <name>-db.postgres.database.azure.com to the private address.
resource "azurerm_private_dns_zone" "db" {
  name                = "${var.name}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "db" {
  name                  = "${var.name}-db-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.db.name
  virtual_network_id    = azurerm_virtual_network.main.id
}

resource "random_password" "db_admin" {
  length  = 32
  special = false # safe inside a connection URL
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "${var.name}-db"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  version                       = var.postgres_version
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  auto_grow_enabled             = false
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  delegated_subnet_id           = azurerm_subnet.db.id
  private_dns_zone_id           = azurerm_private_dns_zone.db.id
  public_network_access_enabled = false
  administrator_login           = "${var.name}_admin" # can create roles (migration 0002)
  administrator_password        = random_password.db_admin.result

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.db]

  lifecycle {
    # Azure picks an availability zone; do not fight it on later plans.
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.name
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
