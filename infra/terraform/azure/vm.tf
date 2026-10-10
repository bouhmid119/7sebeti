resource "azurerm_linux_virtual_machine" "main" {
  name                  = "${var.name}-vm"
  resource_group_name   = azurerm_resource_group.main.name
  location              = azurerm_resource_group.main.location
  size                  = var.vm_size
  admin_username        = var.admin_user
  network_interface_ids = [azurerm_network_interface.vm.id]

  disable_password_authentication = true
  admin_ssh_key {
    username   = var.admin_user
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 30
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/../../cloud-init/vm.yaml", {
    admin_user = var.admin_user
    swap_mb    = var.swap_mb
  }))

  lifecycle {
    # Changing first-boot config or a newer image must not recreate the running VM.
    ignore_changes = [custom_data, source_image_reference]
  }
}
