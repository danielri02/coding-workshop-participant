"""Regression checks for application imports from supported working directories."""

import asyncio
import os
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
from httpx import ASGITransport, AsyncClient

app = importlib.import_module(sys.argv[1]).app
assert '/auth/login' in app.openapi()['paths']
assert '/incidents' in app.openapi()['paths']

async def check():
    origin = sys.argv[2]
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as client:
            response = await client.get('/health')
            assert response.status_code == 200 and response.json() == {'status': 'ok'}
            headers = {'Origin': origin, 'Access-Control-Request-Method': 'GET',
                       'Access-Control-Request-Headers': 'authorization,content-type'}
            response = await client.options('/incidents', headers=headers)
            assert response.status_code == 200, response.text
            assert response.headers['access-control-allow-origin'] == origin
            assert 'authorization' in response.headers['access-control-allow-headers'].lower()
            response = await client.get('/incidents', headers={'Origin': origin})
            assert response.status_code == 401
            assert response.headers['access-control-allow-origin'] == origin
            headers['Origin'] = 'https://unapproved.example'
            response = await client.options('/incidents', headers=headers)
            assert response.status_code == 400
            assert 'access-control-allow-origin' not in response.headers

asyncio.run(check())
"""
        for directory, module, origin in (
            (repository, "backend.app.main", "http://localhost:3000"),
            (repository / "backend", "app.main", "http://localhost:3000"),
            (repository / "backend", "app.main", "http://localhost:5173"),
        ):
            with self.subTest(module=module, origin=origin):
                environment = {**os.environ}
                environment.pop("FRONTEND_ORIGIN", None)
                if origin != "http://localhost:3000":
                    environment["FRONTEND_ORIGIN"] = origin
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    script,
                    module,
                    origin,
                    cwd=directory,
                    env=environment,
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
