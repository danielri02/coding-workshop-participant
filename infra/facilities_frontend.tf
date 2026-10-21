resource "aws_cloudfront_function" "facilities_spa" {
  count   = local.facilities_cloud ? 1 : 0
  name    = "facilities-spa-${local.app_id}"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite frontend navigation while preserving API and asset responses"
  publish = true
  code    = file("${path.module}/facilities_spa.js")
}
