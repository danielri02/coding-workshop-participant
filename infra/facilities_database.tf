# Explicit Lambda-to-Aurora access, within the workshop-provided VPC.
resource "aws_security_group" "facilities_database" {
  count       = local.facilities_cloud ? 1 : 0
  name_prefix = "facilities-database-${local.app_id}-"
  description = "Facilities API and approved maintenance access to PostgreSQL"
  vpc_id      = data.aws_vpc.this.id
  tags        = local.app_tags
}

resource "aws_vpc_security_group_ingress_rule" "facilities_postgres" {
  count                        = local.facilities_cloud ? 1 : 0
  security_group_id            = aws_security_group.facilities_database[0].id
  referenced_security_group_id = aws_security_group.facilities_database[0].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from facilities Lambda network interfaces"
}

resource "aws_vpc_security_group_egress_rule" "facilities_postgres" {
  count                        = local.facilities_cloud ? 1 : 0
  security_group_id            = aws_security_group.facilities_database[0].id
  referenced_security_group_id = aws_security_group.facilities_database[0].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Facilities Lambda connections to Aurora"
}

resource "aws_vpc_security_group_ingress_rule" "facilities_maintenance" {
  for_each                     = local.facilities_cloud ? var.facilities_maintenance_security_group_ids : toset([])
  security_group_id            = aws_security_group.facilities_database[0].id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Approved VPC maintenance machine"
}

resource "random_password" "facilities_database" {
  count   = local.facilities_cloud && var.aws_postgres_enabled ? 1 : 0
  length  = 32
  special = false
}
