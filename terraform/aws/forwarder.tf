# Read detection: CloudTrail -> EventBridge rule for exactly these decoys -> Lilytrap.
# CloudTrail events are regional (IAM and STS calls land in us-east-1). Add the forwarder module
# in other regions with `module.lilytrap.forwarder_inputs` to cover them.

module "forwarder" {
  count             = var.access_detection ? 1 : 0
  source            = "./modules/forwarder"
  name              = "lilytrap-${var.name_prefix}"
  lilytrap_api_url  = local.api
  ingest_key        = local.ingest_key
  secret_arn_prefix = trimsuffix(aws_secretsmanager_secret.decoy.arn, regex("-[A-Za-z0-9]{6}$", aws_secretsmanager_secret.decoy.arn))
  secret_name       = local.secret_name
  ssm_names         = local.plant_ssm ? [local.param_name] : []
  access_key_ids    = local.plant_iam ? [aws_iam_access_key.decoy[0].id] : []
  s3_objects        = local.plant_s3 ? [{ bucket = var.s3_bucket, key = local.object_key }] : []
  tags              = var.tags
}

# Optional minimal trail for accounts without one. The first copy of management events is free;
# the data event selector covers only the decoy object.
resource "aws_s3_bucket" "trail" {
  count         = var.create_trail ? 1 : 0
  bucket_prefix = "lilytrap-trail-"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.create_trail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  count  = var.create_trail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 30 }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  count  = var.create_trail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "AclCheck", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = "s3:GetBucketAcl", Resource = aws_s3_bucket.trail[0].arn },
      { Sid = "Write", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = "s3:PutObject", Resource = "${aws_s3_bucket.trail[0].arn}/AWSLogs/${local.account}/*", Condition = { StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" } } },
    ]
  })
}

resource "aws_cloudtrail" "trail" {
  count                         = var.create_trail ? 1 : 0
  name                          = "lilytrap-${var.name_prefix}"
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  is_multi_region_trail         = true
  include_global_service_events = true
  advanced_event_selector {
    name = "Management events"
    field_selector {
      field  = "eventCategory"
      equals = ["Management"]
    }
  }
  dynamic "advanced_event_selector" {
    for_each = local.plant_s3 ? [1] : []
    content {
      name = "Decoy object reads"
      field_selector {
        field  = "eventCategory"
        equals = ["Data"]
      }
      field_selector {
        field  = "resources.type"
        equals = ["AWS::S3::Object"]
      }
      field_selector {
        field  = "resources.ARN"
        equals = ["arn:${data.aws_partition.current.partition}:s3:::${var.s3_bucket}/${local.object_key}"]
      }
    }
  }
  depends_on = [aws_s3_bucket_policy.trail]
  tags       = var.tags
}
