# Application-owned AWS settings. The supplied workshop Terraform stays intact.
variable "facilities_cloud_environment" {
  description = "Cloud facilities settings. Database identity comes only from the deployed Aurora resources."
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition = alltrue([
      for name in keys(var.facilities_cloud_environment) :
      contains(["JWT_SECRET_KEY", "ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS", "FRONTEND_ORIGIN"], name)
    ])
    error_message = "Only JWT_SECRET_KEY, token lifetimes and FRONTEND_ORIGIN are accepted as cloud application overrides."
  }

  validation {
    condition = data.aws_caller_identity.this.id == "000000000000" || (
      length(lookup(var.facilities_cloud_environment, "JWT_SECRET_KEY", "")) >= 32 &&
      lookup(var.facilities_cloud_environment, "JWT_SECRET_KEY", "") != "coding-workshop-local-development-signing-key"
    )
    error_message = "AWS deployment requires a dedicated JWT_SECRET_KEY of at least 32 characters in facilities_cloud_environment."
  }
}

variable "facilities_maintenance_security_group_ids" {
  description = "Optional security groups of VPC-connected maintenance machines allowed to reach Aurora on 5432."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for id in var.facilities_maintenance_security_group_ids : can(regex("^sg-[a-f0-9]+$", id))])
    error_message = "Maintenance access must use security group IDs from the same VPC."
  }
}

locals {
  facilities_cloud = data.aws_caller_identity.this.id != "000000000000"
  facilities_base_environment = {
    for key, value in local.env_vars : key => trimspace(value) if try(trimspace(value), "") != ""
  }
  facilities_cloud_runtime = merge(
    local.facilities_base_environment,
    { APP_ENV_FILE = "", FRONTEND_ORIGIN = "", PGCONNECT_TIMEOUT = "30" },
    var.facilities_cloud_environment
  )
}

output "facilities_function_name" {
  description = "Facilities Lambda used by the application-owned cloud maintenance wrapper."
  value       = module.lambda["facilities"].lambda_function_name
}

resource "aws_lambda_permission" "facilities_cloud_url" {
  count                  = local.facilities_cloud ? 1 : 0
  statement_id           = "FacilitiesCloudFunctionURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = module.lambda["facilities"].lambda_function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "facilities_cloud_url_invoke" {
  count                    = local.facilities_cloud ? 1 : 0
  statement_id             = "FacilitiesCloudURLInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = module.lambda["facilities"].lambda_function_name
  principal                = "*"
  invoked_via_function_url = true
}
