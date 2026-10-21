mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { id = "123456789012", account_id = "123456789012" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_subnets" { defaults = { ids = ["subnet-111", "subnet-222"] } }
  mock_data "aws_security_groups" { defaults = { ids = ["sg-111"] } }
  mock_data "aws_vpc" { defaults = { id = "vpc-111" } }
  mock_data "aws_service_principal" { defaults = { name = "cloudfront.amazonaws.com" } }
}
variables {
  facilities_local_environment = { DATABASE_URL = "postgresql://local/local", JWT_SECRET_KEY = "local-only" }
  facilities_cloud_environment = { JWT_SECRET_KEY = "cloud-fixture-signing-key-at-least-32-characters" }
}
run "cloud_uses_cloud_only_settings_and_url_grants" {
  command = plan
  assert {
    condition     = module.lambda["facilities"].environment["JWT_SECRET_KEY"] == var.facilities_cloud_environment["JWT_SECRET_KEY"] && !contains(keys(module.lambda["facilities"].environment), "DATABASE_URL")
    error_message = "Cloud must not inherit local database identity or the local JWT key."
  }
  assert {
    condition     = !contains(keys(module.lambda["example"].environment), "JWT_SECRET_KEY") && module.lambda["facilities"].memory == 256 && module.lambda["example"].memory == 128
    error_message = "Facilities changes must leave other services alone."
  }
  assert {
    condition     = module.lambda["facilities"].docker && module.lambda["facilities"].docker_options == tolist(["--platform=linux/amd64"]) && length(keys(module.lambda["facilities"].cors)) == 0
    error_message = "Cloud must build native dependencies in the matching runtime and avoid wildcard Function URL CORS."
  }
  assert {
    condition     = length(aws_lambda_permission.facilities_cloud_url) == 1 && length(aws_lambda_permission.facilities_cloud_url_invoke) == 1 && aws_lambda_permission.facilities_cloud_url_invoke[0].invoked_via_function_url && length(aws_lambda_permission.facilities_local_function_url) == 0
    error_message = "AWS needs both URL-restricted permissions and no local grants."
  }
  assert {
    condition     = length(module.lambda["facilities"].subnets) == 2 && toset(module.lambda["facilities"].groups) == toset(data.aws_security_groups.this.ids) && toset(aws_rds_cluster.this[0].vpc_security_group_ids) == toset(data.aws_security_groups.this.ids)
    error_message = "Lambda and Aurora must share only the existing workshop security groups."
  }
  assert {
    condition     = alltrue([for rule in aws_cloudfront_distribution.this[0].custom_error_response : rule.response_code == null && rule.response_page_path == null && rule.error_caching_min_ttl == 0]) && length(aws_cloudfront_distribution.this[0].default_cache_behavior[0].function_association) == 1
    error_message = "API errors must retain status/body; only frontend navigation is rewritten."
  }
  assert {
    condition     = length(random_password.facilities_database) == 1 && random_password.facilities_database[0].length == 32 && aws_rds_cluster.this[0].apply_immediately && !aws_rds_cluster_instance.this[0].publicly_accessible
    error_message = "Aurora must use a generated cloud password rather than a visible workshop name."
  }
}
run "local_settings_and_access_still_work" {
  command = plan
  override_data {
    target = data.aws_caller_identity.this
    values = { id = "000000000000", account_id = "000000000000" }
  }
  variables { facilities_cloud_environment = {} }
  assert {
    condition     = module.lambda["facilities"].environment["DATABASE_URL"] == "postgresql://local/local" && module.lambda["facilities"].environment["JWT_SECRET_KEY"] == "local-only" && !module.lambda["facilities"].docker && length(keys(module.lambda["facilities"].cors)) > 0
    error_message = "The existing local override and hot reload path must survive cloud changes."
  }
  assert {
    condition     = length(aws_lambda_permission.facilities_cloud_url) == 0 && length(aws_lambda_permission.facilities_local_function_url) == 1 && length(aws_cloudfront_function.facilities_spa) == 0
    error_message = "Cloud-only resources must never be added to LocalStack."
  }
}
run "cloud_without_signing_key_is_rejected" {
  command = plan
  variables { facilities_cloud_environment = {} }
  expect_failures = [var.facilities_cloud_environment]
}
