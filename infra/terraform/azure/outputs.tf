# Same output names in every provider root, so ../dns and the deploy steps never change.

output "vm_public_ip" {
  value = azurerm_public_ip.vm.ip_address
}

output "ssh" {
  value = "ssh ${var.admin_user}@${azurerm_public_ip.vm.ip_address}"
}

output "db_host" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "database_url" {
  description = "Goes into ops/deploy/.env on the VM. Read with: terraform output -raw database_url"
  sensitive   = true
  value = format(
    "postgres://%s:%s@%s:5432/%s",
    azurerm_postgresql_flexible_server.main.administrator_login,
    random_password.db_admin.result,
    azurerm_postgresql_flexible_server.main.fqdn,
    azurerm_postgresql_flexible_server_database.app.name,
  )
}

output "database_ssl" {
  description = "DATABASE_SSL for ops/deploy/.env (Azure uses public certificate authorities)."
  value       = "verify-full"
}
