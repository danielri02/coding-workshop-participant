"""Regression checks for application imports from supported working directories."""

import asyncio
import sys
import unittest
from pathlib import Path


class StartupTests(unittest.IsolatedAsyncioTestCase):
    """The app must work from backend/ as well as from the repository root."""

    async def test_application_starts_in_both_package_contexts(self) -> None:
        """Import every router and handle a real ASGI request in each child process."""

        repository = Path(__file__).resolve().parents[2]
        script = """
import asyncio
import importlib
import json
import sys

app = importlib.import_module(sys.argv[1]).app
assert '/auth/login' in app.openapi()['paths']
assert '/incidents' in app.openapi()['paths']

async def check():
    messages = []
    async def receive():
        return {'type': 'http.request', 'body': b'', 'more_body': False}
    async def send(message):
        messages.append(message)
    async with app.router.lifespan_context(app):
        await app({
            'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
            'method': 'GET', 'scheme': 'http', 'path': '/health',
            'raw_path': b'/health', 'query_string': b'', 'root_path': '',
            'headers': [], 'server': ('testserver', 80), 'client': ('127.0.0.1', 1234),
        }, receive, send)
    start = next(message for message in messages if message['type'] == 'http.response.start')
    body = b''.join(message.get('body', b'') for message in messages if message['type'] == 'http.response.body')
    assert start['status'] == 200 and json.loads(body) == {'status': 'ok'}

asyncio.run(check())
"""
        for directory, module in (
            (repository, "backend.app.main"),
            (repository / "backend", "app.main"),
        ):
            with self.subTest(module=module):
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    script,
                    module,
                    cwd=directory,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                try:
                    _, stderr = await asyncio.wait_for(
                        process.communicate(), timeout=30
                    )
                except TimeoutError:
                    process.kill()
                    await process.wait()
                    raise
                self.assertEqual(process.returncode, 0, stderr.decode())


if __name__ == "__main__":
    unittest.main()
