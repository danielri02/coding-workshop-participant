resource "aws_db_subnet_group" "this" {
  # Include implicit main-route associations too. Public accessibility stays off.
  subnet_ids = data.aws_subnets.this.ids
}

resource "aws_rds_cluster" "this" {
  master_password   = one(random_password.facilities_database[*].result)
  apply_immediately = true
  vpc_security_group_ids = concat(
    data.aws_security_groups.this.ids,
    local.facilities_cloud ? [aws_security_group.facilities_database[0].id] : []
  )
}

resource "aws_rds_cluster_instance" "this" {
  publicly_accessible = false
}
