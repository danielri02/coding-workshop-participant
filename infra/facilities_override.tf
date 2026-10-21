# Application-owned runtime setting; keep the supplied workshop files unchanged.
# FastAPI/SQLAlchemy plus Argon2 verification peaked at ~139 MiB in a clean runtime.
# Terraform merges *_override.tf into the original module configuration.
module "lambda" {
  memory_size = each.key == "facilities" ? 256 : 128

  # The shared local configuration takes priority over workshop DB defaults and
  # survives start-dev.sh redeployments. Never apply host settings to real AWS.
  environment_variables = merge(
    {
      for key, value in local.env_vars :
      key => trimspace(value) if try(trimspace(value), "") != ""
    },
    each.key == "facilities" && data.aws_caller_identity.this.id == "000000000000" ? var.facilities_local_environment : {}
  )
}
