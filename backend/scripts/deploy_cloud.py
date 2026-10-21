"""Prepare an isolated AWS context and delegate to the unchanged workshop scripts.

Commands: plan (default), backend, frontend, database [--seed], smoke [--login].
Configuration: repository-root .env.cloud; --env-file or APP_ENV_FILE overrides it.
No database reset runs during deployment. Requires a committed, clean checkout.
"""

import argparse
import json
import os
import re
import shutil

# Commands use argument lists; secrets are passed only through child environments.
import subprocess  # nosec B404
import sys
import tarfile
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from dotenv import dotenv_values

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

REPOSITORY = Path(__file__).resolve().parents[2]
RUNTIME_KEYS = (
    "JWT_SECRET_KEY",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "REFRESH_TOKEN_EXPIRE_DAYS",
    "FRONTEND_ORIGIN",
)
ROLES = ("admin", "employee", "engineer")


class CloudError(ValueError):
    """An actionable error whose message contains no environment/credential values."""


def command(
    args: list[str],
    root: Path,
    environment: dict[str, str],
    *,
    capture=False,
    output=None,
) -> str:
    """Never put secrets in command arguments; capture sensitive AWS JSON in memory."""
    result = subprocess.run(
        args,
        cwd=root,
        env=environment,
        check=True,
        stdout=subprocess.PIPE if capture else output,
        text=True,
    )  # nosec B603
    return result.stdout if capture else ""


def settings_file(
    root: Path, selected: str | None, shell: dict[str, str]
) -> dict[str, str]:
    path = selected if selected is not None else shell.get("APP_ENV_FILE", ".env.cloud")
    values = {}
    if path:
        target = Path(path) if Path(path).is_absolute() else root / path
        if not target.is_file():
            raise CloudError(
                "Cloud settings file is missing; copy .env.cloud.sample to .env.cloud and configure it."
            )
        values = {
            key: value
            for key, value in dotenv_values(target, interpolate=False).items()
            if value is not None
        }
    return {**values, **shell}


def clean_environment(settings: dict[str, str]) -> dict[str, str]:
    """Keep workshop inputs while removing credentials, local endpoints and host DBs."""
    blocked = (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_SECURITY_TOKEN",
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_ROLE_ARN",
        "AWS_ROLE_SESSION_NAME",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
        "AWS_ENDPOINT",
        "DATABASE_URL",
        "IS_LOCAL",
        "APP_ENV_FILE",
        "TF_DATA_DIR",
        "TF_WORKSPACE",
    )
    prefixes = (
        "AWS_ENDPOINT_URL",
        "POSTGRES_",
        "VITE_",
        "REACT_APP_",
        "TF_CLI_ARGS",
        "TF_LOG",
        "TF_VAR_",
    )
    environment = {
        key: value
        for key, value in settings.items()
        if key not in blocked and not key.startswith(prefixes)
    }
    environment.update(
        {
            "IS_LOCAL": "false",
            "APP_ENV_FILE": "",
            "VITE_API_MODE": "workshop",
            "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS": "true",
            "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_REGION": settings.get("AWS_REGION")
            or settings.get("AWS_DEFAULT_REGION")
            or "us-east-1",
        }
    )
    environment["AWS_DEFAULT_REGION"] = environment["AWS_REGION"]
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-[0-9]+", environment["AWS_REGION"]):
        raise CloudError("AWS_REGION must be a valid AWS region name.")
    for name in ("aws_vpc_id", "facilities_maintenance_security_group_ids"):
        key = "TF_VAR_" + name
        if key in settings:
            environment[key] = settings[key]
    environment.update(
        {
            "TF_VAR_aws_postgres_enabled": "true",
            "TF_VAR_aws_mongo_enabled": "false",
            "TF_VAR_aws_eks_enabled": "false",
        }
    )
    return environment


def runtime_settings(environment: dict[str, str]) -> dict[str, str]:
    from backend.app.security.config import get_security_settings

    get_security_settings(environment)
    origin = environment.get("FRONTEND_ORIGIN", "")
    if origin and not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?/?", origin):
        raise CloudError("FRONTEND_ORIGIN must be an HTTPS origin without a path.")
    return {key: environment[key] for key in RUNTIME_KEYS if key in environment}


def validate_seed(environment: dict[str, str]) -> None:
    from backend.app.security.passwords import validate_password

    for role in ROLES:
        try:
            validate_password(environment.get(f"SEED_{role.upper()}_PASSWORD", ""))
        except ValueError:
            raise CloudError(
                f"Configure SEED_{role.upper()}_PASSWORD with 12–128 nonblank characters for this command."
            ) from None


@contextmanager
def clean_snapshot(repository: Path, environment: dict[str, str]):
    """Build only committed files; ignored hot-reload vendor directories never enter AWS."""
    if command(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        repository,
        environment,
        capture=True,
    ).strip():
        raise CloudError(
            "Commit source changes before cloud deployment; packages are built from a clean Git snapshot."
        )
    cache = repository / ".cloud"
    cache.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="source-", dir=cache) as directory:
        root = Path(directory)
        with tempfile.TemporaryFile() as archive:
            command(["git", "archive", "HEAD"], repository, environment, output=archive)
            archive.seek(0)
            with tarfile.open(fileobj=archive) as source:
                source.extractall(root, filter="data")
        yield root


def aws_json(root: Path, environment: dict[str, str], *args: str):
    return json.loads(
        command(["aws", *args, "--output", "json"], root, environment, capture=True)
    )


def prepare(
    root: Path, repository: Path, environment: dict[str, str]
) -> dict[str, str]:
    """Refresh participant credentials and validate the actual AWS foundations."""
    for name in ("PARTICIPANT_ID", "PARTICIPANT_CODE"):
        if not environment.get(name) or environment[name].startswith("replace-"):
            raise CloudError(f"Configure {name} using the workshop details.")
    participant = environment["PARTICIPANT_ID"]
    if not re.fullmatch(r"[a-z0-9-]{1,40}", participant):
        raise CloudError(
            "PARTICIPANT_ID must be suitable for the workshop's S3 bucket name."
        )
    command(["bash", "bin/setup-participant.sh"], root, environment)
    generated = dotenv_values(root / "ENVIRONMENT.config", interpolate=False)
    environment.update(
        {key: value for key, value in generated.items() if value is not None}
    )
    identity = aws_json(root, environment, "sts", "get-caller-identity")
    account = identity["Account"]
    if account == "000000000000" or (
        environment.get("AWS_EXPECTED_ACCOUNT_ID")
        and account != environment["AWS_EXPECTED_ACCOUNT_ID"]
    ):
        raise CloudError("AWS account does not match the intended cloud account.")
    print(
        f"AWS account: {account}; region: {environment['AWS_REGION']}; participant: {participant}",
        flush=True,
    )
    environment["TF_DATA_DIR"] = str(
        repository / ".cloud" / participant / environment["AWS_REGION"] / "terraform"
    )
    environment["TF_VAR_facilities_cloud_environment"] = json.dumps(
        runtime_settings(environment)
    )
    bucket = f"coding-workshop-tfstate-{participant}"
    command(["aws", "s3api", "head-bucket", "--bucket", bucket], root, environment)
    command(
        [
            "aws",
            "iam",
            "get-role",
            "--role-name",
            f"coding-workshop-lambda-{environment['AWS_REGION']}-{participant}",
            "--query",
            "Role.RoleName",
            "--output",
            "text",
        ],
        root,
        environment,
        capture=True,
    )
    vpc = environment.get("TF_VAR_aws_vpc_id", "").strip()
    groups = aws_json(
        root,
        environment,
        "ec2",
        "describe-security-groups",
        "--filters",
        f"Name=group-name,Values=coding-workshop-{participant}",
        *([f"Name=vpc-id,Values={vpc}"] if vpc else []),
    )
    if not groups["SecurityGroups"]:
        raise CloudError(
            "The workshop participant security group is missing in the selected AWS region/VPC."
        )
    vpcs = {group["VpcId"] for group in groups["SecurityGroups"]}
    if len(vpcs) != 1:
        raise CloudError(
            "The participant security group exists in multiple VPCs; select one with TF_VAR_aws_vpc_id."
        )
    vpc = vpcs.pop()
    environment["TF_VAR_aws_vpc_id"] = vpc
    print(f"Workshop VPC: {vpc}", flush=True)
    subnets = aws_json(
        root,
        environment,
        "ec2",
        "describe-subnets",
        "--filters",
        f"Name=vpc-id,Values={vpc}",
    )["Subnets"]
    if len({item["AvailabilityZone"] for item in subnets}) < 2:
        raise CloudError(
            "Aurora requires workshop subnets in at least two availability zones."
        )
    versions = aws_json(
        root,
        environment,
        "rds",
        "describe-db-engine-versions",
        "--engine",
        "aurora-postgresql",
        "--engine-version",
        "17.7",
    )
    if not versions["DBEngineVersions"]:
        raise CloudError(
            "Aurora PostgreSQL 17.7 is unavailable in this region; review the application-owned RDS override."
        )
    command(
        [
            "terraform",
            "-chdir=infra",
            "init",
            "-reconfigure",
            "-input=false",
            f"-backend-config=bucket={bucket}",
            f"-backend-config=region={environment['AWS_REGION']}",
        ],
        root,
        environment,
    )
    return environment


def deployed_environment(root: Path, environment: dict[str, str]) -> dict[str, str]:
    """Read the actual Lambda environment; no second database URL or password file."""
    function = command(
        ["terraform", "-chdir=infra", "output", "-raw", "facilities_function_name"],
        root,
        environment,
        capture=True,
    ).strip()
    actual = aws_json(
        root,
        environment,
        "lambda",
        "get-function-configuration",
        "--function-name",
        function,
    )["Environment"]["Variables"]
    if (
        actual.get("IS_LOCAL") != "false"
        or not actual.get("POSTGRES_HOST")
        or actual.get("DATABASE_URL")
    ):
        raise CloudError(
            "Deployed facilities database settings are not the expected cloud configuration."
        )
    runtime_settings(actual)
    return {**clean_environment(environment), **actual, "APP_ENV_FILE": ""}


def request_json(url: str, *, payload=None, token=None, expected=200):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if payload is None else json.dumps(payload).encode()
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        response = urlopen(Request(url, data=data, headers=headers), timeout=45)  # nosec B310
    except HTTPError as exc:
        response = exc
    with response:
        if response.status != expected or (
            expected != 204
            and "application/json" not in response.headers.get("Content-Type", "")
        ):
            raise CloudError(
                "Cloud API smoke check returned an unexpected status or content type."
            )
        return json.load(response) if expected != 204 else None


def smoke(root: Path, environment: dict[str, str], login: bool) -> None:
    base = command(
        ["terraform", "-chdir=infra", "output", "-raw", "api_base_url"],
        root,
        environment,
        capture=True,
    ).strip()
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+", base):
        raise CloudError("Terraform did not return an HTTPS CloudFront API origin.")
    api = base + "/api/facilities"
    if request_json(api + "/health").get("status") != "ok":
        raise CloudError("Cloud API health check failed.")
    request_json(api + "/incidents/grid", expected=401)
    request_json(api + "/cloud-smoke-missing-route", expected=404)
    with urlopen(
        Request(base + "/employee/incidents", headers={"Accept": "text/html"}),
        timeout=45,
    ) as response:  # nosec B310
        if response.status != 200 or "text/html" not in response.headers.get(
            "Content-Type", ""
        ):
            raise CloudError("Cloud frontend deep-link check failed.")
    if login:
        for role in ROLES:
            tokens = request_json(
                api + "/auth/login",
                payload={
                    "email": f"{role}@acme.inc",
                    "password": environment[f"SEED_{role.upper()}_PASSWORD"],
                },
            )
            refresh = tokens["refresh_token"]
            try:
                user = request_json(api + "/auth/me", token=tokens["access_token"])
                if user["is_admin"] != (role == "admin") or bool(
                    user.get("engineer_profile")
                ) != (role == "engineer"):
                    raise CloudError(
                        "A cloud demo account has unexpected capabilities."
                    )
                request_json(
                    api
                    + "/reports/summary?scope="
                    + ("assigned" if role == "engineer" else "personal"),
                    token=tokens["access_token"],
                )
                rotated = request_json(
                    api + "/auth/refresh", payload={"refresh_token": refresh}
                )
                refresh = rotated["refresh_token"]
                request_json(api + "/auth/me", token=rotated["access_token"])
            finally:
                request_json(
                    api + "/auth/logout",
                    payload={"refresh_token": refresh},
                    expected=204,
                )
    print(
        "PASS CloudFront health, JSON errors and frontend deep links"
        + (", role logins and refresh/logout" if login else "")
    )


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("plan", "backend", "frontend", "database", "smoke"),
        nargs="?",
        default="plan",
    )
    parser.add_argument("--env-file")
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Seed after non-destructive initialization (database only)",
    )
    parser.add_argument(
        "--login", action="store_true", help="Also check demo logins (smoke only)"
    )
    args = parser.parse_args()
    try:
        if sys.version_info[:2] != (3, 13):
            raise CloudError("Use Python 3.13 to match the Lambda runtime.")
        if (args.seed and args.action != "database") or (
            args.login and args.action != "smoke"
        ):
            raise CloudError("--seed requires database; --login requires smoke.")
        settings = settings_file(REPOSITORY, args.env_file, dict(os.environ))
        if settings.get("IS_LOCAL", "false").lower() != "false":
            raise CloudError(
                "Cloud settings require IS_LOCAL=false; use .env.cloud rather than the local .env."
            )
        environment = clean_environment(settings)
        # Prevent package imports from reading the local root .env.
        os.environ["APP_ENV_FILE"] = ""
        runtime_settings(environment)
        if args.seed or args.login:
            validate_seed(environment)
        for tool in ("git", "bash", "aws", "terraform", "curl", "jq", "dig"):
            if not shutil.which(tool, path=environment.get("PATH")):
                raise CloudError(f"Required command is missing: {tool}")
        if args.action in {"plan", "backend"}:
            if not shutil.which("docker", path=environment.get("PATH")):
                raise CloudError(
                    "Docker is required to build a Lambda-compatible Python package."
                )
            command(["docker", "info"], REPOSITORY, environment, capture=True)
        with clean_snapshot(REPOSITORY, environment) as root:
            environment = prepare(root, REPOSITORY, environment)
            if args.action == "plan":
                plan = Path(environment["TF_DATA_DIR"]).parent / "cloud.tfplan"
                command(
                    [
                        "terraform",
                        "-chdir=infra",
                        "plan",
                        "-input=false",
                        f"-out={plan}",
                    ],
                    root,
                    environment,
                )
                plan.chmod(0o600)
                print(
                    "Plan prepared. The workshop backend command recomputes and auto-applies its plan; run backend only after review."
                )
            elif args.action == "backend":
                command(["bash", "bin/deploy-backend.sh", "aws"], root, environment)
            elif args.action == "frontend":
                command(["npm", "ci"], root / "frontend", environment)
                command(["bash", "bin/deploy-frontend.sh", "aws"], root, environment)
            elif args.action == "database":
                actual = deployed_environment(root, environment)
                for script in (
                    "check_database",
                    "initialize_database",
                    *(["seed_database"] if args.seed else []),
                ):
                    command(
                        [sys.executable, f"backend/scripts/{script}.py"], root, actual
                    )
            else:
                smoke(root, environment, args.login)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Cloud command failed. Check tool output, AWS access, and VPC connectivity; no reset was attempted."
        )
        parser.exit(1, message + "\n")


if __name__ == "__main__":
    main()
