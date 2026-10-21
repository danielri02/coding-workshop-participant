"""Plan the actual app-owned Terraform overrides using mocked AWS, never an account."""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.scripts.deploy_cloud import command


class CloudTerraformTests(unittest.TestCase):
    def test_cloud_and_local_overrides_with_mocked_aws(self):
        terraform = os.environ.get("TERRAFORM") or shutil.which("terraform")
        if not terraform:
            self.skipTest("Install Terraform to run infrastructure contract tests")
        repository = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="cloud-terraform-test-") as directory:
            root = Path(directory)
            shutil.copytree(
                Path(__file__).parent / "fixtures/cloud", root, dirs_exist_ok=True
            )
            for name in (
                "facilities.tf",
                "facilities_override.tf",
                "facilities_cloud.tf",
                "facilities_local_access.tf",
                "facilities_database.tf",
                "facilities_rds_override.tf",
                "facilities_frontend.tf",
                "facilities_frontend_override.tf",
                "facilities_spa.js",
                "cloudfront.tf",
                "s3.tf",
                "rds.tf",
            ):
                shutil.copy(repository / "infra" / name, root / name)
            environment = {
                key: value
                for key, value in os.environ.items()
                if not key.startswith(("TF_", "AWS_"))
            }
            init = [terraform, "init", "-backend=false", "-input=false", "-no-color"]
            if plugins := os.environ.get("TERRAFORM_PLUGIN_DIR"):
                init.append("-plugin-dir=" + plugins)
            command(init, root, environment, capture=True)
            command(
                [terraform, "validate", "-no-color"], root, environment, capture=True
            )
            output = command(
                [terraform, "test", "-verbose", "-no-color"],
                root,
                environment,
                capture=True,
            )
            self.assertIn("3 passed, 0 failed", output)
            self.assertNotRegex(
                output,
                r'resource "aws_(?:security_group(?:_rule)?|vpc_security_group_(?:ingress|egress)_rule)"',
                "Workshop deployment must not create or modify EC2 security groups/rules.",
            )


if __name__ == "__main__":
    unittest.main()
