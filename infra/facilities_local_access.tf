# Application-owned access settings for the workshop's local Function URL.
locals {
  facilities_local_functions = {
    for name, function in module.lambda : name => function.lambda_function_name
    if name == "facilities" && data.aws_caller_identity.this.id == "000000000000"
  }
}

# Let browser requests reach FastAPI through the existing NONE-authenticated URL.
# Application login and role checks still protect the business endpoints.
resource "aws_lambda_permission" "facilities_local_function_url" {
  for_each = local.facilities_local_functions

  statement_id           = "FacilitiesLocalFunctionURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = each.value
  principal              = "*"
  function_url_auth_type = "NONE"

  depends_on = [module.lambda]
}

# Function URLs also require InvokeFunction; restrict that grant to URL requests.
resource "aws_lambda_permission" "facilities_local_function_url_invoke" {
  for_each = local.facilities_local_functions

  statement_id             = "FacilitiesLocalFunctionURLInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = each.value
  principal                = "*"
  invoked_via_function_url = true

  depends_on = [module.lambda]
}
