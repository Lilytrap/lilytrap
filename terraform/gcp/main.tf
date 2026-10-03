# Lilytrap cloud decoys for Google Cloud.
#
# Plants a production-looking Secret Manager secret pointing at the Lilytrap trap. Using it is
# detected by the trap. Reading it is detected through Cloud Audit Logs: a log sink sends the
# secret's data-access entries to Pub/Sub, which pushes them to Lilytrap.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = ">= 5.0" }
    http   = { source = "hashicorp/http", version = ">= 3.4" }
    random = { source = "hashicorp/random", version = ">= 3.6" }
  }
}

variable "project" {
  description = "Project to plant the decoy in."
  type        = string
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
  description = "Enable DATA_READ audit logs for Secret Manager in this project and forward reads of the decoy to Lilytrap."
  type        = bool
  default     = true
}
variable "trusted_identities" {
  type    = list(string)
  default = []
}
variable "rotation" {
  type    = string
  default = "1"
}
variable "labels" {
  type    = map(string)
  default = {}
}
variable "secret_id" {
  description = "Secret id for the decoy, if <name_prefix>-platform-admin-api collides with something or is ignored."
  type        = string
  default     = null
}
variable "ignore" {
  description = "Extra .lilyignore patterns for this module (the workspace's rules always apply), matched against gcp/<project>/secretmanager/<secret_id>. An ignored decoy fails the plan before anything is created."
  type        = list(string)
  default     = []
}

data "google_client_openid_userinfo" "me" {}

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
  secret_id   = coalesce(var.secret_id, "${var.name_prefix}-platform-admin-api")
  secret_path = "gcp/${var.project}/secretmanager/${local.secret_id}"
  ignored     = data.http.policy.status_code == 200 ? jsondecode(data.http.policy.response_body).ignored : []
  admin_path  = "/internal/platform-admin/${random_id.path.hex}/v1"
  admin_token = "adm_${random_password.token.result}"
  ingest_key  = "lti_${random_password.ingest.result}"
}

# The workspace's ignore rules (and this module's `ignore`) are checked before anything is created.
data "http" "policy" {
  url             = "${local.api}/v1/policy/check"
  method          = "POST"
  request_headers = { authorization = "Bearer ${var.lilytrap_api_key}", "content-type" = "application/json" }
  request_body    = jsonencode({ paths = [local.secret_path], extra = var.ignore })
  lifecycle {
    postcondition {
      # 404: an API from before ignore rules; fine unless this module was given its own.
      condition     = self.status_code == 200 || (self.status_code == 404 && length(var.ignore) == 0)
      error_message = "Couldn't read the workspace's ignore rules from ${local.api} (HTTP ${self.status_code}): ${self.response_body}"
    }
  }
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

resource "google_secret_manager_secret" "decoy" {
  project   = var.project
  secret_id = local.secret_id
  labels    = merge(var.labels, { purpose = "break-glass" })
  replication {
    auto {}
  }
  lifecycle {
    precondition {
      condition     = !contains(local.ignored, local.secret_path)
      error_message = "Lilytrap ignore rules exclude ${local.secret_path}. Set secret_id to a name they allow, or remove this module."
    }
  }
}

resource "google_secret_manager_secret_version" "decoy" {
  secret = google_secret_manager_secret.decoy.id
  secret_data = jsonencode({
    admin_api_url = "${local.trap_url}${local.admin_path}"
    admin_token   = local.admin_token
    notes         = "Break-glass platform admin. Bearer auth. GET /clusters, /secrets/{name}. Rotate after the incident review."
  })
}

# Data-access logs for Secret Manager (the decoy read is a DATA_READ entry).
resource "google_project_iam_audit_config" "secretmanager" {
  count   = var.access_detection ? 1 : 0
  project = var.project
  service = "secretmanager.googleapis.com"
  audit_log_config {
    log_type = "DATA_READ"
  }
}

resource "google_pubsub_topic" "lilytrap" {
  count   = var.access_detection ? 1 : 0
  project = var.project
  name    = "lilytrap-decoy-access"
  labels  = var.labels
}

resource "google_logging_project_sink" "lilytrap" {
  count                  = var.access_detection ? 1 : 0
  project                = var.project
  name                   = "lilytrap-decoy-access"
  destination            = "pubsub.googleapis.com/${google_pubsub_topic.lilytrap[0].id}"
  filter                 = "protoPayload.serviceName=\"secretmanager.googleapis.com\" AND protoPayload.resourceName:\"/secrets/${local.secret_id}\""
  unique_writer_identity = true
}

resource "google_pubsub_topic_iam_member" "sink" {
  count   = var.access_detection ? 1 : 0
  project = var.project
  topic   = google_pubsub_topic.lilytrap[0].name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.lilytrap[0].writer_identity
}

resource "google_pubsub_subscription" "push" {
  count                = var.access_detection ? 1 : 0
  project              = var.project
  name                 = "lilytrap-decoy-access-push"
  topic                = google_pubsub_topic.lilytrap[0].id
  ack_deadline_seconds = 20
  push_config {
    push_endpoint = "${local.api}/ingest/v1/gcp?key=${local.ingest_key}"
  }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  message_retention_duration = "86400s"
  labels                     = var.labels
}

locals {
  manifest = {
    version       = 1
    buildId       = nonsensitive("bld_tf_${substr(sha256("${local.admin_token}:${local.ingest_key}"), 0, 20)}")
    createdAt     = timestamp()
    target        = "cloud"
    endpoint      = local.trap_url
    source        = { kind = "terraform", name = "gcp/${var.name_prefix}", location = "gcp:${var.project}", trusted = distinct(concat([data.google_client_openid_userinfo.me.email], var.trusted_identities)) }
    ingestKeyHash = var.access_detection ? sha256(local.ingest_key) : null
    tokens = [{
      id         = "tok_${substr(sha256("${local.admin_token}:id"), 0, 14)}"
      kit        = "cloud-secret"
      kind       = "bearer"
      secretHash = sha256(local.admin_token)
      path       = "${local.admin_path}/clusters"
      method     = "GET"
      tells      = []
      locations  = ["gcp secret ${local.secret_id}"]
      hop        = 1
      resources  = ["gcp-secret:${local.secret_id}", "gcp-secret:${var.project}/${local.secret_id}"]
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

output "decoy_secret" {
  value = google_secret_manager_secret.decoy.id
}
