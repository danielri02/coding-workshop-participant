resource "aws_cloudfront_distribution" "this" {
  # Replace the workshop's global 404-to-HTML fallback. API errors retain JSON.
  custom_error_response {
    error_code            = 403
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    error_caching_min_ttl = 0
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    default_ttl            = 3600
    max_ttl                = 86400
    min_ttl                = 0
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.facilities_spa[0].arn
    }
  }
}
