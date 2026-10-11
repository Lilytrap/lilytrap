# Lets Lilytrap block attackers in your AWS WAF.
#
# Creates IP sets that Lilytrap owns (it replaces their contents on every sync) and a role it can
# assume to do that and nothing else: wafv2:GetIPSet and wafv2:UpdateIPSet on these sets. The role
# trusts Lilytrap's AWS account only with your workspace id as the external ID.
#
# Reference the IP sets from a block rule in your web ACL (see the `rule_example` output), then put
# the `lilytrap_config` output under "respond" in lilytrap.json, or paste it in the dashboard.
#
# For CloudFront web ACLs, use scope = "CLOUDFRONT" with an aws provider in us-east-1.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.90" }
  }
}

variable "workspace_id" {
  description = "Your Lilytrap workspace id (ws_…). The role's external ID."
  type        = string
  validation {
    condition     = can(regex("^ws_[0-9a-f]{16}$", var.workspace_id))
    error_message = "workspace_id looks like ws_ followed by 16 hex characters. It's in the dashboard under Settings."
  }
}

variable "scope" {
  description = "REGIONAL (ALB, API Gateway, AppSync, Cognito, App Runner, Verified Access) or CLOUDFRONT."
  type        = string
  default     = "REGIONAL"
  validation {
    condition     = contains(["REGIONAL", "CLOUDFRONT"], var.scope)
    error_message = "scope is REGIONAL or CLOUDFRONT."
  }
}

variable "name" {
  description = "Prefix for the IP sets and role. Must start with lilytrap: Lilytrap can only assume roles named that way."
  type        = string
  default     = "lilytrap-block"
  validation {
    condition     = can(regex("^lilytrap[A-Za-z0-9_-]{0,40}$", var.name))
    error_message = "name must start with lilytrap and use only letters, digits, - and _."
  }
}

variable "ipv6" {
  description = "Also create an IPv6 IP set."
  type        = bool
  default     = true
}

variable "lilytrap_account_id" {
  description = "Lilytrap's AWS account. Shown in the dashboard under Settings → Block list."
  type        = string
  default     = "899042279902"
}

data "aws_partition" "current" {}

resource "aws_wafv2_ip_set" "v4" {
  name               = "${var.name}-v4"
  description        = "Managed by Lilytrap. Contents are replaced on every sync."
  scope              = var.scope
  ip_address_version = "IPV4"
  addresses          = []
  # Lilytrap owns the contents; Terraform owns the set.
  lifecycle { ignore_changes = [addresses, description] }
}

resource "aws_wafv2_ip_set" "v6" {
  count              = var.ipv6 ? 1 : 0
  name               = "${var.name}-v6"
  description        = "Managed by Lilytrap. Contents are replaced on every sync."
  scope              = var.scope
  ip_address_version = "IPV6"
  addresses          = []
  lifecycle { ignore_changes = [addresses, description] }
}

locals {
  ip_set_arns = concat([aws_wafv2_ip_set.v4.arn], aws_wafv2_ip_set.v6[*].arn)
}

resource "aws_iam_role" "lilytrap" {
  name                 = "${var.name}-waf"
  description          = "Lilytrap replaces the contents of its block-list IP sets. Nothing else."
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${var.lilytrap_account_id}:root" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "sts:ExternalId" = var.workspace_id } }
    }]
  })
}

resource "aws_iam_role_policy" "lilytrap" {
  name = "update-block-list"
  role = aws_iam_role.lilytrap.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["wafv2:GetIPSet", "wafv2:UpdateIPSet"]
      Resource = local.ip_set_arns
    }]
  })
}

output "role_arn" {
  value = aws_iam_role.lilytrap.arn
}

output "ip_set_arns" {
  value = local.ip_set_arns
}

output "ipv4_ip_set_arn" {
  value = aws_wafv2_ip_set.v4.arn
}

output "ipv6_ip_set_arn" {
  value = try(aws_wafv2_ip_set.v6[0].arn, null)
}

output "lilytrap_config" {
  description = "Put under \"respond\" in lilytrap.json."
  value       = jsonencode({ awsWaf = { roleArn = aws_iam_role.lilytrap.arn, ipSets = local.ip_set_arns } })
}

locals {
  v4_ref = "ip_set_reference_statement { arn = \"${aws_wafv2_ip_set.v4.arn}\" }"
  statement = var.ipv6 ? join("\n", [
    "or_statement {",
    "  statement { ${local.v4_ref} }",
    "  statement { ip_set_reference_statement { arn = \"${try(aws_wafv2_ip_set.v6[0].arn, "")}\" } }",
    "}",
  ]) : local.v4_ref
}

output "rule_example" {
  description = "A rule for your aws_wafv2_web_acl. Give it a priority ahead of your allow rules."
  value       = <<-HCL
    rule {
      name     = "lilytrap-block"
      priority = 0
      action {
        block {}
      }
      statement {
        ${indent(4, local.statement)}
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "lilytrap-block"
        sampled_requests_enabled   = true
      }
    }
  HCL
}
