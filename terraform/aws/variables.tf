variable "lilytrap_api_key" {
  description = "Workspace API key (wsk_...). Used only to register the decoys' hashes with Lilytrap."
  type        = string
  sensitive   = true
}

variable "lilytrap_api_url" {
  description = "Lilytrap API."
  type        = string
  default     = "https://api.lilytrap.com"
}

variable "name_prefix" {
  description = "Prefix that makes the decoys look like they belong here, e.g. prod or payments-prod."
  type        = string
  default     = "prod"
}

variable "ssm_parameter" {
  description = "Also plant the admin token as an SSM SecureString parameter."
  type        = bool
  default     = true
}

variable "iam_key_decoy" {
  description = "Create an IAM user with no permissions (explicit deny-all) and an access key. The key goes into the decoy secret; any use of it shows up in CloudTrail."
  type        = bool
  default     = true
}

variable "s3_bucket" {
  description = "Existing bucket to drop a decoy state backup into. Null to skip."
  type        = string
  default     = null
}

variable "access_detection" {
  description = "Forward CloudTrail reads of the decoys to Lilytrap through EventBridge. Needs a CloudTrail trail recording management events (read and write) in this account, or create_trail."
  type        = bool
  default     = true
}

variable "create_trail" {
  description = "Create a minimal multi-region trail (management events, plus data events for the decoy object) if the account has none."
  type        = bool
  default     = false
}

variable "trusted_identities" {
  description = "Extra identities expected to read the decoys (e.g. a CI role that runs terraform plan). The identity running this module is trusted automatically."
  type        = list(string)
  default     = []
}

variable "rotation" {
  description = "Change this value to rotate every decoy (or use terraform apply -replace=module.<name>.random_password.token)."
  type        = string
  default     = "1"
}

variable "tags" {
  type    = map(string)
  default = {}
}
