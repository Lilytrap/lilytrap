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

  secret_name = coalesce(var.secret_name, "${var.name_prefix}/platform/admin-api")
  param_name  = coalesce(var.ssm_parameter_name, "/${var.name_prefix}/platform/admin-token")
  object_key  = coalesce(var.s3_key, "terraform/${var.name_prefix}.tfstate.backup")

  # Where each decoy would go, as .lilyignore resource paths.
  resource_paths = {
    secret = "aws/${local.account}/${local.region}/secretsmanager/${local.secret_name}"
    ssm    = "aws/${local.account}/${local.region}/ssm/${trimprefix(local.param_name, "/")}"
    s3     = var.s3_bucket == null ? "" : "aws/${local.account}/s3/${var.s3_bucket}/${local.object_key}"
    iam    = "aws/${local.account}/iam/users/${var.name_prefix}-break-glass-admin"
  }
  ignored    = data.http.policy.status_code == 200 ? jsondecode(data.http.policy.response_body).ignored : []
  plant_ssm  = var.ssm_parameter && !contains(local.ignored, local.resource_paths.ssm)
  plant_s3   = var.s3_bucket != null && !contains(local.ignored, local.resource_paths.s3)
  plant_iam  = var.iam_key_decoy && !contains(local.ignored, local.resource_paths.iam)

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
    local.plant_iam ? {
      aws_access_key_id     = aws_iam_access_key.decoy[0].id
      aws_secret_access_key = aws_iam_access_key.decoy[0].secret
    } : {}
  )
}

# The workspace's ignore rules (and this module's `ignore`) decide which decoys are planted. Ignored
# optional decoys are skipped; an ignored main secret stops the plan before anything is created.
data "http" "policy" {
  url             = "${local.api}/v1/policy/check"
  method          = "POST"
  request_headers = { authorization = "Bearer ${var.lilytrap_api_key}", "content-type" = "application/json" }
  request_body    = jsonencode({ paths = compact(values(local.resource_paths)), extra = var.ignore })
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

resource "aws_secretsmanager_secret" "decoy" {
  name                    = local.secret_name
  description             = "Platform admin API (break-glass)"
  recovery_window_in_days = 0
  tags                    = var.tags
  lifecycle {
    precondition {
      condition     = !contains(local.ignored, local.resource_paths.secret)
      error_message = "Lilytrap ignore rules exclude ${local.resource_paths.secret}. Set secret_name to a path they allow, or remove this module."
    }
  }
}

resource "aws_secretsmanager_secret_version" "decoy" {
  secret_id     = aws_secretsmanager_secret.decoy.id
  secret_string = jsonencode(local.decoy_value)
}

resource "aws_ssm_parameter" "decoy" {
  count       = local.plant_ssm ? 1 : 0
  name        = local.param_name
  description = "Platform admin token (break-glass)"
  type        = "SecureString"
  value       = local.admin_token
  tags        = var.tags
}

resource "aws_s3_object" "decoy" {
  count        = local.plant_s3 ? 1 : 0
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
  count = local.plant_iam ? 1 : 0
  name  = "${var.name_prefix}-break-glass-admin"
  tags  = merge(var.tags, { purpose = "break-glass" })
}

# The decoy key can do nothing at all. Its only job is to show up in CloudTrail when someone tries.
resource "aws_iam_user_policy" "decoy_deny_all" {
  count = local.plant_iam ? 1 : 0
  name  = "deny-all"
  user  = aws_iam_user.decoy[0].name
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Deny", Action = "*", Resource = "*" }]
  })
}

resource "aws_iam_access_key" "decoy" {
  count = local.plant_iam ? 1 : 0
  user  = aws_iam_user.decoy[0].name
}

locals {
  secret_resources = concat(
    [aws_secretsmanager_secret.decoy.arn, "secretsmanager:${local.secret_name}"],
    local.plant_ssm ? ["ssm:${local.param_name}"] : [],
    local.plant_s3 ? ["s3:${var.s3_bucket}/${local.object_key}"] : [],
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
      locations  = concat(["aws secretsmanager ${local.secret_name}"], local.plant_ssm ? ["aws ssm ${local.param_name}"] : [], local.plant_s3 ? ["s3://${var.s3_bucket}/${local.object_key}"] : [])
      hop        = 1
      resources  = local.secret_resources
    }],
    local.plant_iam ? [{
      id   = "tok_${substr(sha256("${aws_iam_access_key.decoy[0].id}:id"), 0, 14)}"
      kit  = "aws-break-glass"
      kind = "header-key"
      # An AWS SDK pointed at the trap sends only the access key id (SigV4 Credential=), never the secret.
      secretHash = sha256(aws_iam_access_key.decoy[0].id)
      path       = "/_aws/${random_id.path.hex}"
      method     = "POST"
      tells      = []
      locations  = ["aws secretsmanager ${local.secret_name}"]
      hop        = 2
      resources  = ["aws-access-key:${aws_iam_access_key.decoy[0].id}"]
    }] : [],
  )
  manifest = {
    version = 1
    # Derived from everything registered, so a changed manifest registers as a new deployment.
    buildId       = nonsensitive("bld_tf_${substr(sha256(jsonencode([local.tokens, local.ingest_key, var.trusted_identities])), 0, 20)}")
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
