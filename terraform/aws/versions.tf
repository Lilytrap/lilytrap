terraform {
  required_version = ">= 1.5"
  required_providers {
    aws    = { source = "hashicorp/aws", version = ">= 5.90" }
    http   = { source = "hashicorp/http", version = ">= 3.4" }
    random = { source = "hashicorp/random", version = ">= 3.6" }
  }
}
