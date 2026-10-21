"""Shared configuration, host/Lambda parity and safe generated deployment inputs."""

import asyncio
import json
import os
import secrets
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.engine import make_url

from backend.app.config import load_environment
from backend.scripts.configure_local import local_environment, write_settings


class SharedEnvironmentTests(unittest.IsolatedAsyncioTestCase):
    """One dotenv file configures entry points without shell sourcing or secrets in logs."""

    def test_file_values_are_literal_and_shell_values_win(self) -> None:
        """Load quoted values without expansion, retaining explicit process overrides."""

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "POSTGRES_NAME=shared_database\n"
                "POSTGRES_PASS='literal-${POSTGRES_NAME}-$(not-a-command)#'\n"
                "JWT_SECRET_KEY=key-from-file\n"
            )
            with patch.dict(
                os.environ,
                {"APP_ENV_FILE": str(path), "POSTGRES_NAME": "shell_database"},
                clear=True,
            ):
                self.assertEqual(load_environment(), path)
                self.assertEqual(os.environ["POSTGRES_NAME"], "shell_database")
                self.assertEqual(
                    os.environ["POSTGRES_PASS"],
                    "literal-${POSTGRES_NAME}-$(not-a-command)#",
                )
                self.assertEqual(os.environ["JWT_SECRET_KEY"], "key-from-file")

    def test_lambda_and_explicit_disable_never_read_host_file(self) -> None:
        """Deployment injection is authoritative in Lambda; tests can disable dotenv."""

        for environment in (
            {"APP_ENV_FILE": ""},
            {"APP_ENV_FILE": "/missing/file", "AWS_LAMBDA_FUNCTION_NAME": "facilities"},
        ):
            with (
                self.subTest(environment=environment),
                patch.dict(os.environ, environment, clear=True),
            ):
                self.assertIsNone(load_environment())
        with (
            patch.dict(os.environ, {"APP_ENV_FILE": "/missing/file"}, clear=True),
            self.assertRaisesRegex(ValueError, "APP_ENV_FILE"),
        ):
            load_environment()

    async def test_file_configures_application_from_root_and_backend(self) -> None:
        """Database/authentication configuration loads before their first imports."""

        repository = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "POSTGRES_NAME=shared_incidents\nPOSTGRES_PORT=5437\n"
                "ACCESS_TOKEN_EXPIRE_MINUTES=27\n"
                "JWT_SECRET_KEY=" + secrets.token_urlsafe(32) + "\n"
            )
            for working, package in (
                (repository, "backend.app"),
                (repository / "backend", "app"),
            ):
                script = (
                    f"from {package}.database.config import get_database_url; "
                    f"from {package}.security.config import get_security_settings; "
                    "assert get_database_url().database == 'shared_incidents'; "
                    "assert get_database_url().port == 5437; "
                    "assert get_security_settings().access_token_minutes == 27"
                )
                environment = {"PATH": os.environ["PATH"], "APP_ENV_FILE": str(path)}
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    script,
                    cwd=working,
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

    def test_deployment_preserves_database_identity_credentials_and_options(
        self,
    ) -> None:
        """An explicit URL wins over components and only the host alias changes."""

        password = secrets.token_urlsafe(24) + "@:/#"
        source = (
            make_url("postgresql+psycopg://worker@localhost:5437/incidents")
            .set(password=password)
            .update_query_dict(
                {"sslmode": "disable", "options": "-csearch_path=fixture"}
            )
        )
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": source.render_as_string(hide_password=False),
                "POSTGRES_NAME": "ignored",
                "POSTGRES_LAMBDA_HOST": "container-db",
                "JWT_SECRET_KEY": secrets.token_urlsafe(32),
                "FRONTEND_ORIGIN": "http://localhost:3000",
                "SEED_PASSWORD": secrets.token_urlsafe(18),
                "VITE_API_URL": "not-a-backend-setting",
            },
            clear=True,
        ):
            host, values = local_environment()
            deployed = make_url(values["DATABASE_URL"])
            self.assertEqual(host, source)
            self.assertEqual(deployed, source.set(host="container-db"))
            self.assertEqual(values["POSTGRES_NAME"], "incidents")
            self.assertEqual(values["POSTGRES_PORT"], "5437")
            self.assertEqual(values["POSTGRES_USER"], "worker")
            self.assertEqual(values["POSTGRES_PASS"], password)
            self.assertIn("JWT_SECRET_KEY", values)
            self.assertNotIn("SEED_PASSWORD", values)
            self.assertNotIn("VITE_API_URL", values)

    def test_default_host_translation_and_remote_hosts(self) -> None:
        """Translate loopback per platform and preserve remotely reachable hosts."""

        for platform_name, database_host, expected in (
            ("Linux", "localhost", "172.17.0.1"),
            ("Darwin", "127.0.0.1", "host.docker.internal"),
            ("Linux", "shared-db.example", "shared-db.example"),
        ):
            with (
                self.subTest(platform=platform_name, host=database_host),
                patch.dict(os.environ, {"POSTGRES_HOST": database_host}, clear=True),
                patch(
                    "backend.scripts.configure_local.platform.system",
                    return_value=platform_name,
                ),
            ):
                _, values = local_environment()
                self.assertEqual(values["POSTGRES_HOST"], expected)

    def test_invalid_and_nonlocal_settings_do_not_generate_deployment(self) -> None:
        """Reject ambiguous connection identities and cloud mode in the local wrapper."""

        for environment in (
            {"IS_LOCAL": "false"},
            {"POSTGRES_LAMBDA_HOST": ""},
            {"DATABASE_URL": "postgresql://localhost/database"},
            {"DATABASE_URL": "postgresql://user@localhost/database?host=another-db"},
        ):
            with (
                self.subTest(environment=environment),
                patch.dict(os.environ, environment, clear=True),
                self.assertRaises(ValueError),
            ):
                local_environment()

    def test_generated_input_is_private_and_is_replaced_atomically(self) -> None:
        """Only a complete owner-readable JSON file survives, including on reruns."""

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "facilities.local.auto.tfvars.json"
            for value in ("first", "second"):
                write_settings(path, {"DATABASE_URL": value})
                self.assertEqual(
                    json.loads(path.read_text()),
                    {"facilities_local_environment": {"DATABASE_URL": value}},
                )
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(list(path.parent.iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
