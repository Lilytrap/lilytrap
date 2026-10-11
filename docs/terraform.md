# Terraform

Lilytrap ships Terraform modules for AWS, Google Cloud and Azure, plus a provider for anywhere else. Each module plants a decoy break-glass secret. It also reports reads of the decoy from the cloud's own audit log.

Rules for agents:

- Add the module in a pull request. A human runs `terraform apply`.
- Pass the API key from the team's secret store, for example `TF_VAR_lilytrap_api_key`. Never commit it.
- Pin `?ref=v0` for the latest release, or a release tag such as `?ref=v0.9`.

Every module checks each decoy's resource path against the workspace's ignore rules and its own `ignore` list before it creates anything. See [configuration.md](configuration.md#ignore-rules).

## AWS

```hcl
module "lilytrap" {
  source           = "github.com/lilytrap/lilytrap//terraform/aws?ref=v0"
  lilytrap_api_key = var.lilytrap_api_key
  name_prefix      = "prod"
  # Roles that run `terraform plan` here read the decoy on every refresh.
  # The identity applying the module is trusted automatically. Add CI roles that plan with a different role.
  trusted_identities = []
}
```

- Needs a CloudTrail trail that records management events. If the account has none, set `create_trail = true`.
- Decoys: a Secrets Manager secret. Optional: an SSM parameter, an S3 object, and a real IAM access key with no permissions.
- Resource paths it checks:
  - `aws/<account>/<region>/secretsmanager/<name>`
  - `aws/<account>/<region>/ssm/<name>`
  - `aws/<account>/s3/<bucket>/<key>`
  - `aws/<account>/iam/users/<name>`
- An ignored optional decoy is skipped and listed in `ignored_decoys`. An ignored secret fails the plan.
- If a default name collides with something real, set `secret_name`, `ssm_parameter_name` or `s3_key`.
- With `s3_bucket`, pick an `s3_key` that doesn't exist. S3 replaces an existing object at the same key.

<!-- gen:tf-aws -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `lilytrap_api_key` | `string` | **required** | Workspace API key (wsk_...). Used only to register the decoys' hashes with Lilytrap. Sensitive. |
| `lilytrap_api_url` | `string` | `"https://api.lilytrap.com"` | Lilytrap API. |
| `name_prefix` | `string` | `"prod"` | Prefix that makes the decoys look like they belong here, e.g. prod or payments-prod. |
| `ssm_parameter` | `bool` | `true` | Also plant the admin token as an SSM SecureString parameter. |
| `iam_key_decoy` | `bool` | `true` | Create an IAM user with no permissions (explicit deny-all) and an access key. The key goes into the decoy secret; any use of it shows up in CloudTrail. |
| `s3_bucket` | `string` | `null` | Existing bucket to drop a decoy state backup into. Null to skip. |
| `access_detection` | `bool` | `true` | Forward CloudTrail reads of the decoys to Lilytrap through EventBridge. Needs a CloudTrail trail recording management events (read and write) in this account, or create_trail. |
| `create_trail` | `bool` | `false` | Create a minimal multi-region trail (management events, plus data events for the decoy object) if the account has none. |
| `trusted_identities` | `list(string)` | `[]` | Extra identities expected to read the decoys (e.g. a CI role that runs terraform plan). The identity running this module is trusted automatically. |
| `rotation` | `string` | `"1"` | Change this value to rotate every decoy (or use terraform apply -replace=module.<name>.random_password.token). |
| `ignore` | `list(string)` | `[]` | Extra .lilyignore patterns for this module (the workspace's rules always apply). Matched against aws/<account>/<region>/secretsmanager/<name>, aws/<account>/<region>/ssm/<name>, aws/<account>/s3/<bucket>/<key> and aws/<account>/iam/users/<name>. Ignored optional decoys are skipped; an ignored secret fails the plan. |
| `secret_name` | `string` | `null` | Name for the decoy secret, if <name_prefix>/platform/admin-api collides with something or is ignored. |
| `ssm_parameter_name` | `string` | `null` | Name for the decoy SSM parameter, instead of /<name_prefix>/platform/admin-token. |
| `s3_key` | `string` | `null` | Object key for the decoy state backup in s3_bucket, instead of terraform/<name_prefix>.tfstate.backup. S3 overwrites an existing object at the same key, so pick one that's free. |
| `tags` | `map(string)` | `{}` | Tags for the decoys. Anyone who finds them can read these: never mention decoys or Lilytrap. |

Outputs:

| Name | Description |
|---|---|
| `deployment_id` | Lilytrap deployment id for these decoys. |
| `decoy_secret_arn` | ARN of the decoy Secrets Manager secret. |
| `decoy_aws_access_key_id` | Permissionless decoy key id. Plant it on machines with LILYTRAP_DECOY_AWS_KEY_ID / LILYTRAP_DECOY_AWS_SECRET and lilytrap plant. |
| `decoy_aws_secret_access_key` | Secret for decoy_aws_access_key_id. Null when iam_key_decoy is false. Sensitive. |
| `forwarder_inputs` | Pass to modules/forwarder in other regions (with a provider alias) to catch decoy use there. Sensitive. |
| `ignored_decoys` | Decoy resource paths skipped because a Lilytrap ignore rule matched them. |
<!-- /gen -->

### Other regions

CloudTrail delivers each event in the region where it happened. IAM and STS events arrive in `us-east-1`. The main module listens in its own region. Add a forwarder for each other region where decoys can be read:

```hcl
module "lilytrap_us_east_1" {
  source    = "github.com/lilytrap/lilytrap//terraform/aws/modules/forwarder?ref=v0"
  providers = { aws = aws.us_east_1 }

  lilytrap_api_url  = module.lilytrap.forwarder_inputs.lilytrap_api_url
  ingest_key        = module.lilytrap.forwarder_inputs.ingest_key
  secret_arn_prefix = module.lilytrap.forwarder_inputs.secret_arn_prefix
  secret_name       = module.lilytrap.forwarder_inputs.secret_name
  ssm_names         = module.lilytrap.forwarder_inputs.ssm_names
  access_key_ids    = module.lilytrap.forwarder_inputs.access_key_ids
}
```

<!-- gen:tf-aws-forwarder -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | `"lilytrap"` |  |
| `lilytrap_api_url` | `string` | `"https://api.lilytrap.com"` |  |
| `ingest_key` | `string` | **required** |  Sensitive. |
| `secret_arn_prefix` | `string` | `null` | Decoy secret ARN without its random suffix. |
| `secret_name` | `string` | `null` |  |
| `ssm_names` | `list(string)` | `[]` |  |
| `access_key_ids` | `list(string)` | `[]` |  |
| `s3_objects` | `list(object({ bucket = string, key = string }))` | `[]` |  |
| `tags` | `map(string)` | `{}` |  |
<!-- /gen -->

### Blocking in AWS WAF

`terraform/aws/modules/waf-block` creates IP sets and a role so Lilytrap can block attackers in your web ACL. See [blocking.md](blocking.md#aws-waf).

<!-- gen:tf-aws-waf-block -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `workspace_id` | `string` | **required** | Your Lilytrap workspace id (ws_…). The role's external ID. |
| `scope` | `string` | `"REGIONAL"` | REGIONAL (ALB, API Gateway, AppSync, Cognito, App Runner, Verified Access) or CLOUDFRONT. |
| `name` | `string` | `"lilytrap-block"` | Prefix for the IP sets and role. Must start with lilytrap: Lilytrap can only assume roles named that way. |
| `ipv6` | `bool` | `true` | Also create an IPv6 IP set. |
| `lilytrap_account_id` | `string` | `"899042279902"` | Lilytrap's AWS account. Shown in the dashboard under Settings → Block list. |

Outputs:

| Name | Description |
|---|---|
| `role_arn` | The role Lilytrap assumes. Goes in respond.awsWaf.roleArn. |
| `ip_set_arns` | Every IP set this module created. Goes in respond.awsWaf.ipSets. |
| `ipv4_ip_set_arn` | The IPv4 IP set. |
| `ipv6_ip_set_arn` | The IPv6 IP set, or null when ipv6 is false. |
| `lilytrap_config` | Put under "respond" in lilytrap.json. |
| `rule_example` | A rule for your aws_wafv2_web_acl. Give it a priority ahead of your allow rules. |
<!-- /gen -->

## Google Cloud

```hcl
module "lilytrap" {
  source           = "github.com/lilytrap/lilytrap//terraform/gcp?ref=v0"
  project          = "my-project"
  lilytrap_api_key = var.lilytrap_api_key
}
```

- Turns on Secret Manager data-access audit logs.
- Pushes reads of the decoy to Lilytrap through Pub/Sub.
- Resource path: `gcp/<project>/secretmanager/<secret_id>`. If an ignore rule matches it, the plan fails. Set `secret_id` to rename it.

<!-- gen:tf-gcp -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `project` | `string` | **required** | Project to plant the decoy in. |
| `lilytrap_api_key` | `string` | **required** |  Sensitive. |
| `lilytrap_api_url` | `string` | `"https://api.lilytrap.com"` |  |
| `name_prefix` | `string` | `"prod"` |  |
| `access_detection` | `bool` | `true` | Enable DATA_READ audit logs for Secret Manager in this project and forward reads of the decoy to Lilytrap. |
| `trusted_identities` | `list(string)` | `[]` |  |
| `rotation` | `string` | `"1"` |  |
| `labels` | `map(string)` | `{}` |  |
| `secret_id` | `string` | `null` | Secret id for the decoy, if <name_prefix>-platform-admin-api collides with something or is ignored. |
| `ignore` | `list(string)` | `[]` | Extra .lilyignore patterns for this module (the workspace's rules always apply), matched against gcp/<project>/secretmanager/<secret_id>. An ignored decoy fails the plan before anything is created. |

Outputs:

| Name | Description |
|---|---|
| `deployment_id` | Lilytrap deployment id for these decoys. |
| `decoy_secret` | Resource name of the decoy secret. |
<!-- /gen -->

## Azure

```hcl
module "lilytrap" {
  source              = "github.com/lilytrap/lilytrap//terraform/azure?ref=v0"
  key_vault_id        = azurerm_key_vault.main.id
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  lilytrap_api_key    = var.lilytrap_api_key
}
```

- Sends the vault's audit logs to Log Analytics.
- Alerts Lilytrap when the decoy is read.
- Resource path: `azure/<vault>/secrets/<name>`. Set `secret_name` to rename it.

<!-- gen:tf-azure -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `key_vault_id` | `string` | **required** | Existing Key Vault to plant the decoy secret in. The identity running Terraform needs permission to set secrets. |
| `resource_group_name` | `string` | **required** | Resource group for the Log Analytics workspace, alert rule and action group. |
| `location` | `string` | **required** |  |
| `log_analytics_workspace_id` | `string` | `null` | Existing Log Analytics workspace for the vault's audit logs. Null creates a small one (30-day retention). |
| `lilytrap_api_key` | `string` | **required** |  Sensitive. |
| `lilytrap_api_url` | `string` | `"https://api.lilytrap.com"` |  |
| `name_prefix` | `string` | `"prod"` |  |
| `access_detection` | `bool` | `true` |  |
| `trusted_identities` | `list(string)` | `[]` |  |
| `rotation` | `string` | `"1"` |  |
| `tags` | `map(string)` | `{}` |  |
| `secret_name` | `string` | `null` | Name for the decoy Key Vault secret, if <name_prefix>-platform-admin-api collides with something or is ignored. |
| `ignore` | `list(string)` | `[]` | Extra .lilyignore patterns for this module (the workspace's rules always apply), matched against azure/<vault>/secrets/<name>. An ignored decoy fails the plan before anything is created. |

Outputs:

| Name | Description |
|---|---|
| `deployment_id` | Lilytrap deployment id for these decoys. |
<!-- /gen -->

### Microsoft Sentinel export

`terraform/azure/modules/sentinel` creates a `Lilytrap_CL` table and an app that can only write to it. See [alerts.md](alerts.md#microsoft-sentinel).

<!-- gen:tf-azure-sentinel -->
Inputs:

| Name | Type | Default | Description |
|---|---|---|---|
| `log_analytics_workspace_id` | `string` | **required** | Resource id of the Log Analytics workspace Sentinel uses. |
| `resource_group_name` | `string` | **required** | Where the data collection endpoint and rule go. |
| `location` | `string` | **required** | Region of the Log Analytics workspace. |
| `name` | `string` | `"lilytrap"` | Prefix for the endpoint, rule and app. |
| `retention_days` | `number` | `null` | How long Lilytrap_CL keeps rows. Null uses the workspace default. |

Outputs:

| Name | Description |
|---|---|
| `endpoint` | Data collection endpoint logs ingestion URL. |
| `dcr_id` | Immutable id of the data collection rule. |
| `client_id` | Client id of the Entra app Lilytrap sends with. |
| `tenant_id` | Entra tenant id. |
| `lilytrap_config` | Put under "alerts" in lilytrap.json. Holds the client secret: reference it as ${ENV} instead of committing it. Sensitive. |
<!-- /gen -->

## Terraform provider

Use the `lilytrap/lilytrap` provider when the decoy should live somewhere the modules don't cover: Vault, a CI secret store, a config repository.

```hcl
terraform {
  required_providers {
    lilytrap = { source = "lilytrap/lilytrap" }
  }
}

provider "lilytrap" {} # reads LILYTRAP_API_KEY

resource "lilytrap_decoy_credential" "admin" {}

resource "lilytrap_deployment" "vault" {
  name  = "vault/prod"
  paths = ["vault/secret/prod/admin"]
  decoys = [{
    kit    = "cloud-secret"
    secret = lilytrap_decoy_credential.admin.secret
    path   = "${lilytrap_decoy_credential.admin.path}/clusters"
  }]
}

# Write lilytrap_decoy_credential.admin.url and .secret wherever the decoy should live.
```

| Name | Kind | What it does |
|---|---|---|
| `lilytrap_decoy_credential` | resource | Makes a decoy credential: `secret`, `url`, `path`, `trap_url`. Set `keepers` to replace it. |
| `lilytrap_deployment` | resource | Registers the decoys' hashes. Retires them on destroy. Fails the plan if one of `paths` is ignored. With `access_detection`, it returns `ingest_key` and `ingest_url` for your own audit forwarder. |
| `lilytrap_policy` | data source | Takes `paths`. Returns `allowed` and `ignored`. Use `allowed` in `for_each` to skip ignored locations. |
| `lilytrap_trap` | data source | Returns the trap URL and the ingest URL. |

The provider's full docs are on the Terraform Registry under `lilytrap/lilytrap`. Its source is https://github.com/lilytrap/terraform-provider-lilytrap.

## Removing decoys

`terraform destroy` retires the deployment. Its decoys stop matching. Past events stay.
