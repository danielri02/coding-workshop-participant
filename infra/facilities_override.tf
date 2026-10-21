# Application-owned runtime setting; keep the supplied workshop files unchanged.
# FastAPI/SQLAlchemy plus Argon2 verification peaked at ~139 MiB in a clean runtime.
# Terraform merges *_override.tf into the original module configuration.
module "lambda" {
  memory_size = each.key == "facilities" ? 256 : 128
}
