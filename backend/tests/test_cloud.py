"""Cloud orchestration boundaries verified without AWS calls or credential setup."""

import contextlib
import io
import json
import os
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.scripts import deploy_cloud as cloud


class CloudTests(unittest.TestCase):
    def environment(self):
        return {
            "PATH": os.environ["PATH"],
            "APP_ENV_FILE": "",
            "IS_LOCAL": "false",
            "PARTICIPANT_ID": "abcd1234",
            "PARTICIPANT_CODE": "fixture",
            "AWS_REGION": "us-east-1",
            "JWT_SECRET_KEY": secrets.token_urlsafe(48),
            **{
                f"SEED_{role.upper()}_PASSWORD": secrets.token_urlsafe(24)
                for role in cloud.ROLES
            },
        }

    def test_configuration_is_cloud_specific_literal_and_shell_overridable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("DATABASE_URL=must-not-load\n")
            (root / ".env.cloud").write_text(
                "JWT_SECRET_KEY='literal-$(command)-${VARIABLE}'\nAWS_REGION=us-east-1\n"
            )
            values = cloud.settings_file(root, None, {"AWS_REGION": "eu-west-1"})
            self.assertNotIn("DATABASE_URL", values)
            self.assertEqual(values["AWS_REGION"], "eu-west-1")
            self.assertEqual(values["JWT_SECRET_KEY"], "literal-$(command)-${VARIABLE}")

    def test_cloud_environment_cannot_inherit_local_endpoints_db_or_tf_arguments(self):
        values = cloud.clean_environment(
            {
                **self.environment(),
                "AWS_ACCESS_KEY_ID": "test",
                "AWS_PROFILE": "localstack",
                "AWS_WEB_IDENTITY_TOKEN_FILE": str(Path.cwd() / "identity-file"),
                "AWS_SECRET_ACCESS_KEY": secrets.token_urlsafe(24),
                "AWS_SESSION_TOKEN": secrets.token_urlsafe(24),
                "AWS_ENDPOINT_URL": "http://localhost:4566",
                "AWS_ENDPOINT_URL_S3": "http://localhost:4566",
                "AWS_ENDPOINT": "--endpoint-url=http://localhost:4566",
                "DATABASE_URL": "postgresql://localhost/local",
                "POSTGRES_HOST": "localhost",
                "POSTGRES_PASS": secrets.token_urlsafe(24),
                "TF_DATA_DIR": "/local-state",
                "TF_WORKSPACE": "local",
                "TF_CLI_ARGS_apply": "-destroy",
                "TF_LOG": "TRACE",
                "TF_VAR_facilities_local_environment": "private-local",
                "VITE_API_MODE": "direct",
                "VITE_API_URL": "http://localhost:8000",
                "TF_VAR_aws_vpc_id": "vpc-123",
            }
        )
        for name in (
            "AWS_ACCESS_KEY_ID",
            "AWS_PROFILE",
            "AWS_WEB_IDENTITY_TOKEN_FILE",
            "AWS_ENDPOINT_URL",
            "AWS_ENDPOINT_URL_S3",
            "AWS_ENDPOINT",
            "DATABASE_URL",
            "POSTGRES_HOST",
            "POSTGRES_PASS",
            "TF_DATA_DIR",
            "TF_CLI_ARGS_apply",
            "TF_LOG",
            "TF_WORKSPACE",
            "TF_VAR_facilities_local_environment",
            "VITE_API_URL",
        ):
            self.assertNotIn(name, values)
        self.assertEqual(values["VITE_API_MODE"], "workshop")
        self.assertEqual(values["TF_VAR_aws_vpc_id"], "vpc-123")
        self.assertEqual(values["IS_LOCAL"], "false")

    def test_snapshot_excludes_vendor_and_settings_and_refuses_dirty_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = {
                **os.environ,
                "GIT_AUTHOR_NAME": "Fixture",
                "GIT_AUTHOR_EMAIL": "fixture@example.test",
                "GIT_COMMITTER_NAME": "Fixture",
                "GIT_COMMITTER_EMAIL": "fixture@example.test",
            }
            (root / ".gitignore").write_text(".cloud/\n.env*\nvendor/\n")
            (root / "source.txt").write_text("committed")
            (root / ".env.cloud").write_text("JWT_SECRET_KEY=not-in-the-package")
            (root / "vendor").mkdir()
            (root / "vendor/native.so").write_text("host-only")
            (root / "backend/facilities/app").mkdir(parents=True)
            (root / "backend/facilities/app/__init__.py").write_text("")
            (root / "backend/app").symlink_to(
                "facilities/app", target_is_directory=True
            )
            for args in (
                ["git", "init", "-q"],
                ["git", "add", ".gitignore", "source.txt", "backend"],
                ["git", "commit", "-qm", "fixture"],
            ):
                cloud.command(args, root, environment, capture=True)
            with cloud.clean_snapshot(root, environment) as snapshot:
                self.assertEqual((snapshot / "source.txt").read_text(), "committed")
                self.assertFalse((snapshot / "vendor").exists())
                self.assertFalse((snapshot / ".env.cloud").exists())
                self.assertTrue((snapshot / "backend/app/__init__.py").is_file())
            self.assertFalse(snapshot.exists())
            (root / "source.txt").write_text("dirty")
            with (
                self.assertRaisesRegex(cloud.CloudError, "Commit source"),
                cloud.clean_snapshot(root, environment),
            ):
                self.fail("Dirty worktree was archived")

    def prepare_fixture(self, root, account="123456789012"):
        calls = []

        def command(args, work, environment, *, capture=False):
            calls.append((args, environment.copy()))
            if args == ["bash", "bin/setup-participant.sh"]:
                (root / "ENVIRONMENT.config").write_text(
                    'export AWS_ACCESS_KEY_ID="fixture-real"\nexport AWS_SESSION_TOKEN="fixture-session"\n'
                )
            if args[:3] == ["aws", "sts", "get-caller-identity"]:
                return json.dumps({"Account": account})
            responses = {
                "describe-vpcs": {"Vpcs": [{"VpcId": "vpc-123", "IsDefault": True}]},
                "describe-security-groups": {"SecurityGroups": [{"GroupId": "sg-123"}]},
                "describe-subnets": {
                    "Subnets": [
                        {"AvailabilityZone": "us-east-1a"},
                        {"AvailabilityZone": "us-east-1b"},
                    ]
                },
                "describe-db-engine-versions": {
                    "DBEngineVersions": [{"EngineVersion": "17.7"}]
                },
            }
            return (
                json.dumps(responses[args[2]])
                if len(args) > 2 and args[2] in responses
                else ""
            )

        return command, calls

    def test_preparation_uses_real_identity_and_an_isolated_shared_state_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, calls = self.prepare_fixture(root)
            source = cloud.clean_environment(self.environment())
            with (
                patch.object(cloud, "command", side_effect=run),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                prepared = cloud.prepare(root, root, source)
            self.assertIn(
                ".cloud/abcd1234/us-east-1/terraform", prepared["TF_DATA_DIR"]
            )
            self.assertEqual(prepared["AWS_ACCESS_KEY_ID"], "fixture-real")
            self.assertNotIn("AWS_ACCESS_KEY_ID", calls[0][1])
            self.assertEqual(
                json.loads(prepared["TF_VAR_facilities_cloud_environment"])[
                    "JWT_SECRET_KEY"
                ],
                source["JWT_SECRET_KEY"],
            )
            self.assertTrue(
                any(
                    "-backend-config=bucket=coding-workshop-tfstate-abcd1234" in args
                    for args, _ in calls
                )
            )
            self.assertTrue(
                all(source["JWT_SECRET_KEY"] not in str(args) for args, _ in calls)
            )

    def test_wrong_aws_account_stops_before_terraform_or_bucket_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for account in ("000000000000", "999999999999"):
                run, calls = self.prepare_fixture(root, account)
                with (
                    patch.object(cloud, "command", side_effect=run),
                    self.assertRaises(cloud.CloudError),
                ):
                    cloud.prepare(
                        root,
                        root,
                        cloud.clean_environment(
                            {
                                **self.environment(),
                                "AWS_EXPECTED_ACCOUNT_ID": "123456789012",
                            }
                        ),
                    )
                self.assertFalse(
                    any(
                        args[0] == "terraform" or "head-bucket" in args
                        for args, _ in calls
                    )
                )

    def test_maintenance_uses_deployed_configuration_instead_of_local_database_settings(
        self,
    ):
        actual = {
            "IS_LOCAL": "false",
            "POSTGRES_HOST": "database.internal",
            "POSTGRES_NAME": "cloud_database",
            "POSTGRES_PASS": secrets.token_urlsafe(24),
            "JWT_SECRET_KEY": secrets.token_urlsafe(48),
        }
        with (
            patch.object(cloud, "command", return_value="facilities-cloud"),
            patch.object(
                cloud, "aws_json", return_value={"Environment": {"Variables": actual}}
            ),
        ):
            values = cloud.deployed_environment(
                Path.cwd(),
                {
                    **self.environment(),
                    "DATABASE_URL": "postgresql://localhost/local",
                    "POSTGRES_NAME": "wrong",
                },
            )
        self.assertNotIn("DATABASE_URL", values)
        self.assertEqual(values["POSTGRES_NAME"], "cloud_database")
        self.assertEqual(values["POSTGRES_PASS"], actual["POSTGRES_PASS"])
        self.assertEqual(values["APP_ENV_FILE"], "")

    def test_smoke_requires_json_errors_and_rejects_spa_fallbacks(self):
        url = "https://fixture.cloudfront.net/api/facilities/missing"
        response = HTTPError(
            url,
            404,
            "Not Found",
            {"Content-Type": "application/json"},
            io.BytesIO(b'{"detail":"Not Found"}'),
        )
        with patch.object(cloud, "urlopen", side_effect=response):
            self.assertEqual(
                cloud.request_json(url, expected=404), {"detail": "Not Found"}
            )
        html = io.BytesIO(b"<html>SPA fallback</html>")
        html.status = 200
        html.headers = {"Content-Type": "text/html"}
        with (
            patch.object(cloud, "urlopen", return_value=html),
            self.assertRaises(cloud.CloudError),
        ):
            cloud.request_json(url, expected=404)

    def test_main_delegates_workshop_commands_and_never_resets_database(self):
        for action in ("backend", "frontend", "database"):
            environment = cloud.clean_environment(self.environment())
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with (
                    patch.dict(os.environ, environment, clear=True),
                    patch.object(
                        cloud.sys,
                        "argv",
                        [
                            "deploy_cloud.py",
                            action,
                            *(["--seed"] if action == "database" else []),
                        ],
                    ),
                    patch.object(cloud.os, "umask"),
                    patch.object(cloud.shutil, "which", return_value="/tool"),
                    patch.object(
                        cloud,
                        "clean_snapshot",
                        return_value=contextlib.nullcontext(root),
                    ),
                    patch.object(cloud, "prepare", return_value=environment),
                    patch.object(
                        cloud, "deployed_environment", return_value=environment
                    ),
                    patch.object(cloud, "command", return_value="") as run,
                ):
                    cloud.main()
                commands = [call.args[0] for call in run.call_args_list]
                self.assertFalse(
                    any(
                        "create_tables" in str(args) or "--reset" in args
                        for args in commands
                    )
                )
                if action == "database":
                    self.assertEqual(
                        [args[-1] for args in commands],
                        [
                            "backend/scripts/check_database.py",
                            "backend/scripts/initialize_database.py",
                            "backend/scripts/seed_database.py",
                        ],
                    )
                else:
                    self.assertIn(["bash", f"bin/deploy-{action}.sh", "aws"], commands)
                    if action == "frontend":
                        self.assertLess(
                            commands.index(["npm", "ci"]),
                            commands.index(["bash", "bin/deploy-frontend.sh", "aws"]),
                        )


if __name__ == "__main__":
    unittest.main()
