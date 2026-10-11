# Sends every Lilytrap event to Microsoft Sentinel.
#
# Creates a custom table (Lilytrap_CL) in your Log Analytics workspace, a data collection endpoint
# and rule that write to it, and an Entra app that may only send to that rule (Monitoring Metrics
# Publisher on the rule). Lilytrap signs in as the app and posts through the Logs Ingestion API.
#
# Put the `lilytrap_config` output under "alerts" in lilytrap.json (it's sensitive: it holds the
# client secret), or paste the values into the dashboard.

terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = ">= 4.0" }
    azuread = { source = "hashicorp/azuread", version = ">= 3.0" }
    azapi   = { source = "azure/azapi", version = ">= 2.0" }
  }
}

variable "log_analytics_workspace_id" {
  description = "Resource id of the Log Analytics workspace Sentinel uses."
  type        = string
}

variable "resource_group_name" {
  description = "Where the data collection endpoint and rule go."
  type        = string
}

variable "location" {
  description = "Region of the Log Analytics workspace."
  type        = string
}

variable "name" {
  description = "Prefix for the endpoint, rule and app."
  type        = string
  default     = "lilytrap"
}

variable "retention_days" {
  description = "How long Lilytrap_CL keeps rows. Null uses the workspace default."
  type        = number
  default     = null
}

data "azuread_client_config" "current" {}

locals {
  table  = "Lilytrap_CL"
  stream = "Custom-Lilytrap"
  # One row per event. Matches SiemRecord in packages/core/src/api.ts.
  columns = [
    { name = "TimeGenerated", type = "datetime" },
    { name = "RecordType", type = "string" },
    { name = "WorkspaceId", type = "string" },
    { name = "EventId", type = "string" },
    { name = "IncidentId", type = "string" },
    { name = "IncidentChange", type = "string" },
    { name = "Severity", type = "string" },
    { name = "Classification", type = "string" },
    { name = "LlmScore", type = "real" },
    { name = "SourceIp", type = "string" },
    { name = "Method", type = "string" },
    { name = "Path", type = "string" },
    { name = "UserAgent", type = "string" },
    { name = "Kit", type = "string" },
    { name = "TokenId", type = "string" },
    { name = "BuildId", type = "string" },
    { name = "MatchedBy", type = "string" },
    { name = "EventSource", type = "string" },
    { name = "Principal", type = "string" },
    { name = "IncidentEvents", type = "int" },
    { name = "IncidentIps", type = "int" },
    { name = "Url", type = "string" },
    { name = "Reasons", type = "dynamic" },
    { name = "Details", type = "dynamic" },
  ]
}

resource "azapi_resource" "table" {
  type      = "Microsoft.OperationalInsights/workspaces/tables@2022-10-01"
  name      = local.table
  parent_id = var.log_analytics_workspace_id
  body = {
    properties = merge(
      { schema = { name = local.table, columns = local.columns } },
      var.retention_days == null ? {} : { retentionInDays = var.retention_days },
    )
  }
}

resource "azurerm_monitor_data_collection_endpoint" "lilytrap" {
  name                          = "${var.name}-dce"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  public_network_access_enabled = true
  description                   = "Lilytrap posts events here."
}

resource "azurerm_monitor_data_collection_rule" "lilytrap" {
  name                        = "${var.name}-dcr"
  resource_group_name         = var.resource_group_name
  location                    = var.location
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.lilytrap.id
  description                 = "Lilytrap events into ${local.table}."

  destinations {
    log_analytics {
      workspace_resource_id = var.log_analytics_workspace_id
      name                  = "workspace"
    }
  }

  data_flow {
    streams       = [local.stream]
    destinations  = ["workspace"]
    output_stream = "Custom-${local.table}"
    transform_kql = "source"
  }

  stream_declaration {
    stream_name = local.stream
    dynamic "column" {
      for_each = local.columns
      content {
        name = column.value.name
        type = column.value.type
      }
    }
  }

  depends_on = [azapi_resource.table]
}

resource "azuread_application" "lilytrap" {
  display_name = "${var.name}-sentinel-ingest"
  owners       = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "lilytrap" {
  client_id = azuread_application.lilytrap.client_id
  owners    = [data.azuread_client_config.current.object_id]
}

resource "azuread_application_password" "lilytrap" {
  application_id = azuread_application.lilytrap.id
  display_name   = "Lilytrap"
}

# The app can send rows to this rule. Nothing else.
resource "azurerm_role_assignment" "publisher" {
  scope                = azurerm_monitor_data_collection_rule.lilytrap.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azuread_service_principal.lilytrap.object_id
}

output "endpoint" {
  value = azurerm_monitor_data_collection_endpoint.lilytrap.logs_ingestion_endpoint
}

output "dcr_id" {
  value = azurerm_monitor_data_collection_rule.lilytrap.immutable_id
}

output "client_id" {
  value = azuread_application.lilytrap.client_id
}

output "tenant_id" {
  value = data.azuread_client_config.current.tenant_id
}

output "lilytrap_config" {
  description = "Put under \"alerts\" in lilytrap.json. Holds the client secret: reference it as $${ENV} instead of committing it."
  sensitive   = true
  value = jsonencode({
    sentinel = {
      tenantId     = data.azuread_client_config.current.tenant_id
      clientId     = azuread_application.lilytrap.client_id
      clientSecret = azuread_application_password.lilytrap.value
      endpoint     = azurerm_monitor_data_collection_endpoint.lilytrap.logs_ingestion_endpoint
      dcrId        = azurerm_monitor_data_collection_rule.lilytrap.immutable_id
      stream       = local.stream
    }
  })
}
