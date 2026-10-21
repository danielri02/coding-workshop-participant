"""HTTP-to-Lambda event bridge for integration tests without LocalStack.

Use a disposable DATABASE_URL and run this file with --port. This is a test
harness exercising the real packaged Mangum handler, not a deployment server.
"""

import argparse
import asyncio
import base64
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "facilities"))
os.environ.setdefault("AWS_LAMBDA_FUNCTION_NAME", "facilities-contract-test")

from function import handler


class LambdaRequestHandler(BaseHTTPRequestHandler):
    """Translate HTTP requests into Function URL v2 events without changing auth."""

    def log_message(self, format: str, *args: object) -> None:
        """Keep request details and credentials out of test harness logs."""

    def handle_request(self) -> None:
        """Invoke the application entrypoint and serialize its actual response."""

        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        event = {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": url.path,
            "rawQueryString": url.query,
            "headers": {key.lower(): value for key, value in self.headers.items()},
            "requestContext": {
                "domainName": self.headers.get("Host", "localhost"),
                "http": {
                    "method": self.command,
                    "path": url.path,
                    "sourceIp": self.client_address[0],
                    "protocol": "HTTP/1.1",
                },
            },
            "body": base64.b64encode(body).decode(),
            "isBase64Encoded": True,
        }
        response = handler(event, None)
        raw = response.get("body", "")
        payload = (
            base64.b64decode(raw) if response.get("isBase64Encoded") else raw.encode()
        )
        self.send_response(response["statusCode"])
        for key, value in response.get("headers", {}).items():
            if key.lower() not in {"content-length", "connection"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    do_GET = do_POST = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = handle_request


def main() -> None:
    """Run the real Lambda entrypoint behind an ephemeral local HTTP listener."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    asyncio.set_event_loop(asyncio.new_event_loop())
    with HTTPServer(("127.0.0.1", args.port), LambdaRequestHandler) as server:
        print(f"Lambda contract test server listening on {args.port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
