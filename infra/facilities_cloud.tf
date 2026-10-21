# Application-owned AWS settings. The supplied workshop Terraform stays intact.
variable "facilities_cloud_environment" {
  description = "Cloud facilities settings. Database identity comes only from the deployed Aurora resources."
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition = alltrue([
      for name in keys(var.facilities_cloud_environment) :
      contains(["JWT_SECRET_KEY", "ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS", "FRONTEND_ORIGIN", "DATABASE_RESET_KEY", "SEED_ADMIN_PASSWORD", "SEED_EMPLOYEE_PASSWORD", "SEED_ENGINEER_PASSWORD"], name)
    ])
    error_message = "Only JWT settings, FRONTEND_ORIGIN, DATABASE_RESET_KEY and SEED_*_PASSWORD are accepted as cloud application overrides."
  }

  validation {
    condition = data.aws_caller_identity.this.id == "000000000000" || (
      length(lookup(var.facilities_cloud_environment, "JWT_SECRET_KEY", "")) >= 32 &&
      lookup(var.facilities_cloud_environment, "JWT_SECRET_KEY", "") != "coding-workshop-local-development-signing-key"
    )
    error_message = "AWS deployment requires a dedicated JWT_SECRET_KEY of at least 32 characters in facilities_cloud_environment."
  }

  validation {
    condition = lookup(var.facilities_cloud_environment, "DATABASE_RESET_KEY", "") == "" || (
      length(lookup(var.facilities_cloud_environment, "DATABASE_RESET_KEY", "")) >= 32 &&
      trimspace(lookup(var.facilities_cloud_environment, "DATABASE_RESET_KEY", "")) != ""
    )
    error_message = "DATABASE_RESET_KEY must be empty (setup disabled) or contain at least 32 characters."
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
