"""Cold-package checks for the workshop's exact function.handler convention."""

import asyncio
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


class LambdaPackageTests(unittest.IsolatedAsyncioTestCase):
    """Invoke the packaged service without the repository on Python's import path."""

    async def test_standalone_package_routes_both_prefixes_and_swagger(self) -> None:
        """Local Lambda paths and CloudFront prefixes share one authenticated app."""

        service = Path(__file__).resolve().parents[1] / "facilities"
        with tempfile.TemporaryDirectory() as directory:
            shutil.copytree(
                service / "app",
                Path(directory) / "app",
                ignore=shutil.ignore_patterns("__pycache__"),
            )
            shutil.copyfile(service / "function.py", Path(directory) / "function.py")
            script = """
import asyncio, base64, json
asyncio.set_event_loop(asyncio.new_event_loop())
from function import handler
from app.database.session import engine
from sqlalchemy.pool import NullPool
assert isinstance(engine.pool, NullPool)
def invoke(path):
    return handler({
        "version": "2.0", "routeKey": "$default", "rawPath": path,
        "rawQueryString": "", "headers": {"host": "lambda.example"},
        "requestContext": {"domainName": "lambda.example", "http": {
            "method": "GET", "path": path, "sourceIp": "127.0.0.1", "protocol": "HTTP/1.1"
        }}, "body": None, "isBase64Encoded": False,
    }, None)
for path in ('/health', '/api/facilities/health'):
    response = invoke(path)
    assert response['statusCode'] == 200, response
    assert json.loads(response['body']) == {'status': 'ok'}
for path in ('/users', '/api/facilities/users'):
    assert invoke(path)['statusCode'] == 401
response = invoke('/api/facilities/docs')
assert response['statusCode'] == 200
assert '/api/facilities/openapi.json' in response['body']
response = invoke('/api/facilities/openapi.json')
spec = json.loads(response['body'])
assert {'url': '/api/facilities'} in spec['servers']
assert spec['components']['securitySchemes']['OAuth2PasswordBearer']['flows']['password']['tokenUrl'] == 'auth/token'
"""
            environment = {
                **os.environ,
                "AWS_LAMBDA_FUNCTION_NAME": "facilities-contract-test",
            }
            environment.pop("PYTHONPATH", None)
            environment.pop("API_ROOT_PATH", None)
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                script,
                cwd=directory,
                env=environment,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=30
                )
            except TimeoutError:
                process.kill()
                await process.wait()
                raise
            self.assertEqual(process.returncode, 0, stderr.decode() + stdout.decode())
