# Lilytrap cloud decoys for Azure.
#
# Plants a production-looking Key Vault secret pointing at the Lilytrap trap. Using it is
# detected by the trap. Reading it is detected through the vault's audit logs: a diagnostic
# setting sends them to Log Analytics, and a log search alert calls Lilytrap's webhook for each
# read of the decoy (split by caller, so every identity is reported).

terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = ">= 4.0" }
    http    = { source = "hashicorp/http", version = ">= 3.4" }
    random  = { source = "hashicorp/random", version = ">= 3.6" }
  }
}

variable "key_vault_id" {
  description = "Existing Key Vault to plant the decoy secret in. The identity running Terraform needs permission to set secrets."
  type        = string
}
variable "resource_group_name" {
  description = "Resource group for the Log Analytics workspace, alert rule and action group."
  type        = string
}
variable "location" {
  type = string
}
variable "log_analytics_workspace_id" {
  description = "Existing Log Analytics workspace for the vault's audit logs. Null creates a small one (30-day retention)."
  type        = string
  default     = null
}
variable "lilytrap_api_key" {
  type      = string
  sensitive = true
}
variable "lilytrap_api_url" {
  type    = string
  default = "https://api.lilytrap.com"
}
variable "name_prefix" {
  type    = string
  default = "prod"
}
variable "access_detection" {
  type    = bool
  default = true
}
variable "trusted_identities" {
  type    = list(string)
  default = []
}
variable "rotation" {
  type    = string
  default = "1"
}
variable "tags" {
  type    = map(string)
  default = {}
}

data "azurerm_client_config" "current" {}

data "http" "config" {
  url = "${local.api}/agent/v1/config"
  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "Couldn't reach ${local.api}/agent/v1/config."
    }
  }
}

locals {
  api         = trimsuffix(var.lilytrap_api_url, "/")
  trap_url    = trimsuffix(jsondecode(data.http.config.response_body).trapUrl, "/")
  vault_name  = lower(element(split("/", var.key_vault_id), length(split("/", var.key_vault_id)) - 1))
  secret_name = "${var.name_prefix}-platform-admin-api"
  admin_path  = "/internal/platform-admin/${random_id.path.hex}/v1"
  admin_token = "adm_${random_password.token.result}"
  ingest_key  = "lti_${random_password.ingest.result}"
  workspace   = var.log_analytics_workspace_id != null ? var.log_analytics_workspace_id : try(azurerm_log_analytics_workspace.lilytrap[0].id, null)
}

resource "random_id" "path" {
  byte_length = 4
  keepers     = { rotation = var.rotation }
}

resource "random_password" "token" {
  length  = 40
  special = false
  keepers = { rotation = var.rotation }
}

resource "random_password" "ingest" {
  length  = 40
  special = false
}

resource "azurerm_key_vault_secret" "decoy" {
  name         = local.secret_name
  key_vault_id = var.key_vault_id
  content_type = "application/json"
  value = jsonencode({
    admin_api_url = "${local.trap_url}${local.admin_path}"
    admin_token   = local.admin_token
    notes         = "Break-glass platform admin. Bearer auth. GET /clusters, /secrets/{name}. Rotate after the incident review."
  })
  tags = merge(var.tags, { purpose = "break-glass" })
}

resource "azurerm_log_analytics_workspace" "lilytrap" {
  count               = var.access_detection && var.log_analytics_workspace_id == null ? 1 : 0
  name                = "lilytrap-${var.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_monitor_diagnostic_setting" "vault" {
  count                          = var.access_detection ? 1 : 0
  name                           = "lilytrap-audit"
  target_resource_id             = var.key_vault_id
  log_analytics_workspace_id     = local.workspace
  log_analytics_destination_type = "AzureDiagnostics"
  enabled_log {
    category = "AuditEvent"
  }
}

resource "azurerm_monitor_action_group" "lilytrap" {
  count               = var.access_detection ? 1 : 0
  name                = "lilytrap-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  short_name          = "lilytrap"
  webhook_receiver {
    name                    = "lilytrap"
    service_uri             = "${local.api}/ingest/v1/azure?key=${local.ingest_key}"
    use_common_alert_schema = true
  }
  tags = var.tags
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "decoy_read" {
  count                   = var.access_detection ? 1 : 0
  name                    = "lilytrap-decoy-read-${var.name_prefix}"
  resource_group_name     = var.resource_group_name
  location                = var.location
  scopes                  = [local.workspace]
  description             = "A Lilytrap decoy secret was read"
  severity                = 1
  evaluation_frequency    = "PT5M"
  window_duration         = "PT5M"
  auto_mitigation_enabled = false
  criteria {
    query                   = <<-KQL
      AzureDiagnostics
      | where ResourceProvider == "MICROSOFT.KEYVAULT" and OperationName == "SecretGet"
      | extend SecretName = tostring(split(id_s, "/")[4])
      | where SecretName == "${local.secret_name}"
      | extend Identity = coalesce(identity_claim_oid_g, identity_claim_upn_s, identity_claim_appid_g), Vault = tolower(Resource)
      | summarize Reads = count() by CallerIPAddress, Identity, Vault, SecretName
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = 0
    dimension {
      name     = "CallerIPAddress"
      operator = "Include"
      values   = ["*"]
    }
    dimension {
      name     = "Identity"
      operator = "Include"
      values   = ["*"]
    }
    dimension {
      name     = "Vault"
      operator = "Include"
      values   = ["*"]
    }
    dimension {
      name     = "SecretName"
      operator = "Include"
      values   = ["*"]
    }
    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }
  action {
    action_groups = [azurerm_monitor_action_group.lilytrap[0].id]
  }
  tags = var.tags
}

locals {
  manifest = {
    version       = 1
    buildId       = nonsensitive("bld_tf_${substr(sha256("${local.admin_token}:${local.ingest_key}"), 0, 20)}")
    createdAt     = timestamp()
    target        = "cloud"
    endpoint      = local.trap_url
    source        = { kind = "terraform", name = "azure/${var.name_prefix}", location = "azure:${local.vault_name}", trusted = distinct(concat([data.azurerm_client_config.current.object_id], var.trusted_identities)) }
    ingestKeyHash = var.access_detection ? sha256(local.ingest_key) : null
    tokens = [{
      id         = "tok_${substr(sha256("${local.admin_token}:id"), 0, 14)}"
      kit        = "cloud-secret"
      kind       = "bearer"
      secretHash = sha256(local.admin_token)
      path       = "${local.admin_path}/clusters"
      method     = "GET"
      tells      = []
      locations  = ["azure key vault ${local.vault_name}/${local.secret_name}"]
      hop        = 1
      resources  = ["azure-secret:${local.vault_name}/${local.secret_name}", "azure-secret:${local.secret_name}"]
    }]
  }
}

data "http" "register" {
  url             = "${local.api}/v1/builds"
  method          = "POST"
  request_headers = { authorization = "Bearer ${var.lilytrap_api_key}", "content-type" = "application/json" }
  request_body    = jsonencode({ for k, v in local.manifest : k => v if v != null })
  lifecycle {
    postcondition {
      condition     = contains([200, 201], self.status_code)
      error_message = "Lilytrap rejected the decoy registration (HTTP ${self.status_code}): ${self.response_body}"
    }
  }
}

output "deployment_id" {
  value = local.manifest.buildId
}
