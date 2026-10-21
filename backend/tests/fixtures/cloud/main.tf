terraform {
  required_version = ">= 1.11.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}
variable "aws_project" { default = "coding-workshop" }
variable "aws_postgres_enabled" { default = true }
locals {
  app_id            = "abcd1234"
  app_tags          = { participant = local.app_id }
  public_subnet_ids = ["subnet-111"]
  origin_id         = "website"
  env_vars          = { POSTGRES_NAME = "aurora", IS_LOCAL = data.aws_caller_identity.this.id == "000000000000" ? "true" : "false" }
  function_origins = [for name, function in module.lambda : {
    name = name, origin_id = "lambda-${name}", domain_name = replace(replace(function.lambda_function_url, "https://", ""), "/", "")
  }]
}
data "aws_caller_identity" "this" {}
data "aws_subnets" "this" {}
data "aws_security_groups" "this" {}
data "aws_vpc" "this" { id = "vpc-111" }
data "aws_partition" "this" {}
data "aws_service_principal" "cloudfront" { service_name = "cloudfront" }
module "lambda" {
  source                    = "./stub"
  for_each                  = toset(["facilities", "example"])
  function_name             = "coding-workshop-${each.key}-abcd1234"
  memory_size               = 128
  build_in_docker           = false
  docker_additional_options = []
  environment_variables     = local.env_vars
  vpc_subnet_ids            = local.public_subnet_ids
  vpc_security_group_ids    = data.aws_security_groups.this.ids
  cors                      = {}
}
resource "random_pet" "this" { length = 3 }
