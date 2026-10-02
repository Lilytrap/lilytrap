# Forwards CloudTrail events that touch Lilytrap decoys to the Lilytrap ingest API.
# One per region; CloudTrail delivers each event to EventBridge in the region where it happened.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.90" }
  }
}

variable "name" {
  type    = string
  default = "lilytrap"
}
variable "lilytrap_api_url" {
  type    = string
  default = "https://api.lilytrap.com"
}
variable "ingest_key" {
  type      = string
  sensitive = true
}
variable "secret_arn_prefix" {
  description = "Decoy secret ARN without its random suffix."
  type        = string
  default     = null
}
variable "secret_name" {
  type    = string
  default = null
}
variable "ssm_names" {
  type    = list(string)
  default = []
}
variable "access_key_ids" {
  type    = list(string)
  default = []
}
variable "s3_objects" {
  type    = list(object({ bucket = string, key = string }))
  default = []
}
variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  # Each branch matches one decoy. Secrets Manager callers may pass a name, a partial ARN or a full ARN.
  branches = concat(
    var.secret_name == null ? [] : [{ requestParameters = { secretId = [var.secret_name, { prefix = var.secret_arn_prefix }] } }],
    length(var.ssm_names) == 0 ? [] : [{ requestParameters = { name = var.ssm_names } }],
    length(var.ssm_names) == 0 ? [] : [{ requestParameters = { names = var.ssm_names } }],
    length(var.access_key_ids) == 0 ? [] : [{ userIdentity = { accessKeyId = var.access_key_ids } }],
    [for o in var.s3_objects : { requestParameters = { bucketName = [o.bucket], key = [o.key] } }],
  )
}

resource "aws_cloudwatch_event_connection" "lilytrap" {
  name               = var.name
  description        = "Lilytrap ingest"
  authorization_type = "API_KEY"
  auth_parameters {
    api_key {
      key   = "x-lilytrap-ingest-key"
      value = var.ingest_key
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "lilytrap" {
  name                             = var.name
  description                      = "Lilytrap decoy access events"
  invocation_endpoint              = "${trimsuffix(var.lilytrap_api_url, "/")}/ingest/v1/aws"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 10
  connection_arn                   = aws_cloudwatch_event_connection.lilytrap.arn
}

resource "aws_cloudwatch_event_rule" "decoys" {
  name        = var.name
  description = "CloudTrail events that touch Lilytrap decoys"
  # Read-only calls such as GetSecretValue are only delivered in this state.
  state = "ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS"
  event_pattern = jsonencode({
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail        = { "$or" = local.branches }
  })
  tags = var.tags
}

resource "aws_iam_role" "events" {
  name_prefix = "${var.name}-events-"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "events.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "events" {
  role = aws_iam_role.events.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "events:InvokeApiDestination", Resource = aws_cloudwatch_event_api_destination.lilytrap.arn }]
  })
}

resource "aws_cloudwatch_event_target" "lilytrap" {
  rule     = aws_cloudwatch_event_rule.decoys.name
  arn      = aws_cloudwatch_event_api_destination.lilytrap.arn
  role_arn = aws_iam_role.events.arn
  retry_policy {
    maximum_retry_attempts       = 10
    maximum_event_age_in_seconds = 3600
  }
}
