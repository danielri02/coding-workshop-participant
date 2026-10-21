# Network access uses the preprovisioned workshop security group, as in rds.tf.
# Participant credentials need no permission to create or modify security groups.
resource "random_password" "facilities_database" {
  count   = local.facilities_cloud && var.aws_postgres_enabled ? 1 : 0
  length  = 32
  special = false
}
