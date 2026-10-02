# Lilytrap cloud decoys for AWS.
#
# Plants a production-looking secret (and optionally an SSM parameter, a state backup in S3 and a
# permissionless IAM access key) that points at the Lilytrap trap. Using the decoy is detected by
# the trap with nothing else installed. Reading it is detected by forwarding CloudTrail events
# for these exact resources to Lilytrap (forwarder.tf).
#
# Only hashes of the decoy values are sent to Lilytrap. Nothing here can touch your real resources.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

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
  api      = trimsuffix(var.lilytrap_api_url, "/")
  trap_url = trimsuffix(jsondecode(data.http.config.response_body).trapUrl, "/")
  region   = data.aws_region.current.region
  account  = data.aws_caller_identity.current.account_id

  secret_name = "${var.name_prefix}/platform/admin-api"
  param_name  = "/${var.name_prefix}/platform/admin-token"
  object_key  = "terraform/${var.name_prefix}.tfstate.backup"

  admin_path  = "/internal/platform-admin/${random_id.path.hex}/v1"
  admin_token = "adm_${random_password.token.result}"
  ingest_key  = "lti_${random_password.ingest.result}"

  # The identity applying this module reads the decoys on every plan; never alert on it.
  caller     = data.aws_caller_identity.current.arn
  caller_ids = can(regex(":assumed-role/", local.caller)) ? ["arn:${data.aws_partition.current.partition}:iam::${local.account}:role/${split("/", local.caller)[1]}"] : [local.caller]

  decoy_value = merge(
    {
      admin_api_url = "${local.trap_url}${local.admin_path}"
      admin_token   = local.admin_token
      notes         = "Break-glass platform admin. Bearer auth. GET /clusters, /secrets/{name}. Rotate after the incident review."
    },
    var.iam_key_decoy ? {
      aws_access_key_id     = aws_iam_access_key.decoy[0].id
      aws_secret_access_key = aws_iam_access_key.decoy[0].secret
    } : {}
  )
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

resource "aws_secretsmanager_secret" "decoy" {
  name                    = local.secret_name
  description             = "Platform admin API (break-glass)"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "decoy" {
  secret_id     = aws_secretsmanager_secret.decoy.id
  secret_string = jsonencode(local.decoy_value)
}

resource "aws_ssm_parameter" "decoy" {
  count       = var.ssm_parameter ? 1 : 0
  name        = local.param_name
  description = "Platform admin token (break-glass)"
  type        = "SecureString"
  value       = local.admin_token
  tags        = var.tags
}

resource "aws_s3_object" "decoy" {
  count        = var.s3_bucket == null ? 0 : 1
  bucket       = var.s3_bucket
  key          = local.object_key
  content_type = "application/json"
  content = jsonencode({
    version           = 4
    terraform_version = "1.9.5"
    outputs = {
      platform_admin_url   = { value = "${local.trap_url}${local.admin_path}", type = "string" }
      platform_admin_token = { value = local.admin_token, type = "string", sensitive = true }
    }
  })
  tags = var.tags
}

resource "aws_iam_user" "decoy" {
  count = var.iam_key_decoy ? 1 : 0
  name  = "${var.name_prefix}-break-glass-admin"
  tags  = merge(var.tags, { purpose = "break-glass" })
}

# The decoy key can do nothing at all. Its only job is to show up in CloudTrail when someone tries.
resource "aws_iam_user_policy" "decoy_deny_all" {
  count = var.iam_key_decoy ? 1 : 0
  name  = "deny-all"
  user  = aws_iam_user.decoy[0].name
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Deny", Action = "*", Resource = "*" }]
  })
}

resource "aws_iam_access_key" "decoy" {
  count = var.iam_key_decoy ? 1 : 0
  user  = aws_iam_user.decoy[0].name
}

locals {
  secret_resources = concat(
    [aws_secretsmanager_secret.decoy.arn, "secretsmanager:${local.secret_name}"],
    var.ssm_parameter ? ["ssm:${local.param_name}"] : [],
    var.s3_bucket == null ? [] : ["s3:${var.s3_bucket}/${local.object_key}"],
  )
  tokens = concat(
    [{
      id         = "tok_${substr(sha256("${local.admin_token}:id"), 0, 14)}"
      kit        = "cloud-secret"
      kind       = "bearer"
      secretHash = sha256(local.admin_token)
      path       = "${local.admin_path}/clusters"
      method     = "GET"
      tells      = []
      locations  = concat(["aws secretsmanager ${local.secret_name}"], var.ssm_parameter ? ["aws ssm ${local.param_name}"] : [], var.s3_bucket == null ? [] : ["s3://${var.s3_bucket}/${local.object_key}"])
      hop        = 1
      resources  = local.secret_resources
    }],
    var.iam_key_decoy ? [{
      id         = "tok_${substr(sha256("${aws_iam_access_key.decoy[0].id}:id"), 0, 14)}"
      kit        = "aws-break-glass"
      kind       = "header-key"
      secretHash = sha256(aws_iam_access_key.decoy[0].secret)
      path       = "/_aws/${random_id.path.hex}"
      method     = "POST"
      tells      = []
      locations  = ["aws secretsmanager ${local.secret_name}"]
      hop        = 2
      resources  = ["aws-access-key:${aws_iam_access_key.decoy[0].id}"]
    }] : [],
  )
  manifest = {
    version       = 1
    buildId       = nonsensitive("bld_tf_${substr(sha256(join(",", [local.admin_token, local.ingest_key, var.iam_key_decoy ? aws_iam_access_key.decoy[0].id : ""])), 0, 20)}")
    createdAt     = timestamp()
    target        = "cloud"
    endpoint      = local.trap_url
    source        = { kind = "terraform", name = "aws/${var.name_prefix}", location = "aws:${local.account}/${local.region}", trusted = distinct(concat(local.caller_ids, var.trusted_identities)) }
    ingestKeyHash = var.access_detection ? sha256(local.ingest_key) : null
    tokens        = local.tokens
  }
}

# Register the decoys' hashes. Idempotent: the same decoys register once, whatever the number of plans.
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
