// CloudFront viewer-request handler for the frontend behavior only.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var navigation = request.headers.accept && request.headers.accept.value.indexOf('text/html') !== -1;
  if ((request.method === 'GET' || request.method === 'HEAD') && navigation &&
      uri !== '/api' && uri.indexOf('/api/') !== 0 &&
      uri.lastIndexOf('.') <= uri.lastIndexOf('/') &&
      (uri === '/' || /^\/(admin|employee|engineer)(\/|$)/.test(uri))) {
    request.uri = '/index.html';
  }
  return request;
}
