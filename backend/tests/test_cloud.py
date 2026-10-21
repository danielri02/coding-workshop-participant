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
            "DATABASE_RESET_KEY": secrets.token_urlsafe(48),
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

    def test_vdi_settings_are_inherited_without_duplication_in_cloud_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shell = self.environment()
            shell.pop("AWS_REGION")
            shell["AWS_DEFAULT_REGION"] = "eu-west-1"
            (root / ".env.cloud").write_text(
                f"JWT_SECRET_KEY={shell.pop('JWT_SECRET_KEY')}\n"
            )
            values = cloud.clean_environment(cloud.settings_file(root, None, shell))
            self.assertEqual(values["PARTICIPANT_ID"], shell["PARTICIPANT_ID"])
            self.assertEqual(values["PARTICIPANT_CODE"], shell["PARTICIPANT_CODE"])
            self.assertEqual(values["AWS_REGION"], "eu-west-1")
            self.assertEqual(values["AWS_DEFAULT_REGION"], "eu-west-1")
            shell["AWS_REGION"] = "eu-central-1"
            values = cloud.clean_environment(cloud.settings_file(root, None, shell))
            self.assertEqual(values["AWS_DEFAULT_REGION"], "eu-central-1")

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

    def prepare_fixture(self, root, account="123456789012", groups=None):
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
                "describe-security-groups": {
                    "SecurityGroups": (
                        [{"GroupId": "sg-123", "VpcId": "vpc-123"}]
                        if groups is None
                        else groups
                    )
                },
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
            self.assertEqual(prepared["TF_VAR_aws_vpc_id"], "vpc-123")
            self.assertFalse(any("describe-vpcs" in args for args, _ in calls))
            group_call = next(
                args for args, _ in calls if "describe-security-groups" in args
            )
            self.assertIn("Name=group-name,Values=coding-workshop-abcd1234", group_call)
            self.assertFalse(any(arg.startswith("Name=vpc-id") for arg in group_call))
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

    def test_explicit_vpc_override_constrains_participant_group_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, calls = self.prepare_fixture(root)
            source = cloud.clean_environment(
                {**self.environment(), "TF_VAR_aws_vpc_id": "vpc-123"}
            )
            with (
                patch.object(cloud, "command", side_effect=run),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                cloud.prepare(root, root, source)
            group_call = next(
                args for args, _ in calls if "describe-security-groups" in args
            )
            self.assertIn("Name=vpc-id,Values=vpc-123", group_call)

    def test_missing_or_ambiguous_participant_groups_stop_before_terraform(self):
        for groups, message in (
            ([], "security group is missing"),
            (
                [
                    {"GroupId": "sg-123", "VpcId": "vpc-123"},
                    {"GroupId": "sg-456", "VpcId": "vpc-456"},
                ],
                "multiple VPCs",
            ),
        ):
            with (
                self.subTest(groups=groups),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                run, calls = self.prepare_fixture(root, groups=groups)
                with (
                    patch.object(cloud, "command", side_effect=run),
                    contextlib.redirect_stdout(io.StringIO()),
                    self.assertRaisesRegex(cloud.CloudError, message),
                ):
                    cloud.prepare(
                        root, root, cloud.clean_environment(self.environment())
                    )
                self.assertFalse(
                    any(
                        args[0] == "terraform" or "describe-subnets" in args
                        for args, _ in calls
                    )
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

    def maintenance_fixture(self, url="https://fixture.lambda-url.us-east-1.on.aws/"):
        def run(args, root, environment, *, capture=False):
            self.assertEqual(args[:3], ["terraform", "-chdir=infra", "output"])
            if args[-1] == "facilities_function_name":
                return "coding-workshop-facilities-abcd1234"
            self.assertEqual(args[-1], "lambda_urls")
            return json.dumps({"coding-workshop-facilities-abcd1234": url})

        return run

    def test_database_command_calls_the_key_protected_backend_api(self):
        environment = self.environment()
        output = io.StringIO()
        with (
            patch.object(
                cloud, "command", side_effect=self.maintenance_fixture()
            ) as run,
            patch.object(
                cloud,
                "request_json",
                return_value={"initialized": True, "inserted": {"users": 8}},
            ) as request,
            contextlib.redirect_stdout(output),
        ):
            cloud.maintain_database(Path.cwd(), environment)
        request.assert_called_once_with(
            "https://fixture.lambda-url.us-east-1.on.aws/api/facilities/dev/database/init",
            payload={},
            extra_headers={"X-Database-Reset-Key": environment["DATABASE_RESET_KEY"]},
            timeout=330,
        )
        self.assertIn("reinitialized to seed data", output.getvalue())
        self.assertEqual(run.call_count, 2)
        command_args = [call.args[0] for call in run.call_args_list]
        for role in cloud.ROLES:
            self.assertNotIn(
                environment[f"SEED_{role.upper()}_PASSWORD"],
                str(command_args) + str(request.call_args_list) + output.getvalue(),
            )
        self.assertNotIn(
            environment["DATABASE_RESET_KEY"],
            str(command_args) + output.getvalue(),
        )

    def test_database_upgrade_calls_upgrade_endpoint_without_seed_or_reset(self):
        with (
            patch.object(cloud, "command", side_effect=self.maintenance_fixture()),
            patch.object(
                cloud, "request_json", return_value={"upgraded": True}
            ) as request,
        ):
            cloud.maintain_database(Path.cwd(), self.environment(), upgrade=True)
        self.assertTrue(request.call_args.args[0].endswith("/dev/database/upgrade"))
        self.assertEqual(request.call_args.kwargs["payload"], {})

    def test_reset_key_is_sent_only_in_an_http_header(self):
        key = secrets.token_urlsafe(48)
        response = io.BytesIO(b'{"initialized":true,"inserted":{}}')
        response.status = 200
        response.headers = {"Content-Type": "application/json"}
        with patch.object(cloud, "urlopen", return_value=response) as request:
            cloud.request_json(
                "https://fixture.lambda-url.us-east-1.on.aws/api/facilities/dev/database/init",
                payload={},
                extra_headers={"X-Database-Reset-Key": key},
                timeout=330,
            )
        sent = request.call_args.args[0]
        self.assertEqual(sent.get_method(), "POST")
        self.assertNotIn(key, sent.full_url)
        self.assertNotIn(key, sent.data.decode())
        self.assertEqual(sent.get_header("X-database-reset-key"), key)
        self.assertEqual(request.call_args.kwargs["timeout"], 330)

    def test_database_setup_rejects_missing_keys_and_non_lambda_urls(self):
        with (
            patch.object(cloud, "command") as run,
            patch.object(cloud, "request_json") as request,
        ):
            for key in ("", "short"):
                with self.subTest(key=key), self.assertRaises(cloud.CloudError):
                    cloud.maintain_database(
                        Path.cwd(), {**self.environment(), "DATABASE_RESET_KEY": key}
                    )
            run.assert_not_called()
            request.assert_not_called()
        with (
            patch.object(
                cloud,
                "command",
                side_effect=self.maintenance_fixture("https://untrusted.example"),
            ),
            patch.object(cloud, "request_json") as request,
            self.assertRaises(cloud.CloudError),
        ):
            cloud.maintain_database(Path.cwd(), self.environment())
        request.assert_not_called()

    def test_database_errors_do_not_echo_private_response_details(self):
        private = secrets.token_urlsafe(24)
        error = HTTPError(
            "https://fixture.lambda-url.us-east-1.on.aws",
            403,
            "Forbidden",
            {"Content-Type": "application/json"},
            io.BytesIO(json.dumps({"detail": private}).encode()),
        )
        with (
            patch.object(cloud, "urlopen", side_effect=error),
            self.assertRaises(cloud.CloudError) as caught,
        ):
            cloud.request_json(error.url, payload={})
        self.assertNotIn(private, str(caught.exception))
        self.assertIn("403", str(caught.exception))

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

    def test_main_delegates_workshop_commands_and_uses_api_instead_of_local_db_scripts(
        self,
    ):
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
                    patch.object(cloud, "maintain_database") as maintenance,
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
                    maintenance.assert_called_once_with(
                        root, environment, upgrade=False
                    )
                    self.assertEqual(commands, [])
                else:
                    self.assertIn(["bash", f"bin/deploy-{action}.sh", "aws"], commands)
                    if action == "frontend":
                        self.assertLess(
                            commands.index(["npm", "ci"]),
                            commands.index(["bash", "bin/deploy-frontend.sh", "aws"]),
                        )


if __name__ == "__main__":
    unittest.main()
