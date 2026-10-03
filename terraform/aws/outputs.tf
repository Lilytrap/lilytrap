output "deployment_id" {
  description = "Lilytrap deployment id for these decoys."
  value       = local.manifest.buildId
}

output "decoy_secret_arn" {
  value = aws_secretsmanager_secret.decoy.arn
}

output "decoy_aws_access_key_id" {
  description = "Permissionless decoy key id. Plant it on machines with LILYTRAP_DECOY_AWS_KEY_ID / LILYTRAP_DECOY_AWS_SECRET and lilytrap plant."
  value       = local.plant_iam ? aws_iam_access_key.decoy[0].id : null
}

output "decoy_aws_secret_access_key" {
  value     = local.plant_iam ? aws_iam_access_key.decoy[0].secret : null
  sensitive = true
}

output "forwarder_inputs" {
  description = "Pass to modules/forwarder in other regions (with a provider alias) to catch decoy use there."
  sensitive   = true
  value = {
    lilytrap_api_url  = local.api
    ingest_key        = local.ingest_key
    secret_arn_prefix = trimsuffix(aws_secretsmanager_secret.decoy.arn, regex("-[A-Za-z0-9]{6}$", aws_secretsmanager_secret.decoy.arn))
    secret_name       = local.secret_name
    ssm_names         = local.plant_ssm ? [local.param_name] : []
    access_key_ids    = local.plant_iam ? [aws_iam_access_key.decoy[0].id] : []
  }
}

output "ignored_decoys" {
  description = "Decoy resource paths skipped because a Lilytrap ignore rule matched them."
  value       = local.ignored
}
