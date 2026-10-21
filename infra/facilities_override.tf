# Application-owned runtime setting; keep the supplied workshop files unchanged.
# FastAPI/SQLAlchemy plus Argon2 verification peaked at ~139 MiB in a clean runtime.
# Terraform merges *_override.tf into the original module configuration.
module "lambda" {
  memory_size               = each.key == "facilities" ? 256 : 128
  build_in_docker           = each.key == "facilities" && local.facilities_cloud
  docker_additional_options = each.key == "facilities" && local.facilities_cloud ? ["--platform=linux/amd64"] : []
  vpc_subnet_ids            = each.key == "facilities" && local.facilities_cloud ? data.aws_subnets.this.ids : local.public_subnet_ids
  vpc_security_group_ids    = data.aws_security_groups.this.ids
  cors = { for key, value in {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["*"]
    allow_origins     = ["*"]
    expose_headers    = []
    max_age           = 0
  } : key => value if !(each.key == "facilities" && local.facilities_cloud) }

  # The shared local configuration takes priority over workshop DB defaults and
  # survives start-dev.sh redeployments. Never apply host settings to real AWS.
  environment_variables = merge(
    local.facilities_base_environment,
    each.key == "facilities" ? (local.facilities_cloud ? local.facilities_cloud_runtime : var.facilities_local_environment) : {}
  )
}
