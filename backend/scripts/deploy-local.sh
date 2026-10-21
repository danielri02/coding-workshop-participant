#!/usr/bin/env bash
# Prepare local dependencies, then delegate deployment to the workshop script.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: backend/scripts/deploy-local.sh

Start LocalStack if needed and deploy the backend locally using the unmodified
workshop script. Run from any directory. Docker must already be running.

Required commands: docker, localstack, curl, aws, terraform, python3.13
Overrides:
  PYTHON                    Python 3.13 executable (default: python3.13)
  LOCALSTACK_WAIT_SECONDS    Startup timeout in seconds (default: 60)
  LOCALSTACK_IMAGE           Image used when starting LocalStack
  TF_VAR_aws_postgres_host   Database host reachable from Lambda containers
  TF_VAR_aws_mongo_host      MongoDB host reachable from Lambda containers

Runtime settings come from the root .env (or APP_ENV_FILE). Shell values win.
POSTGRES_LAMBDA_HOST changes the database host alias used inside Docker.

Next, run ./bin/start-dev.sh to start the databases and frontend.
EOF
}

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi
[[ $# -eq 0 ]] || { usage >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
cd "$PROJECT_ROOT"

# Match start-dev.sh's participant settings without invoking AWS setup.
if [[ -f "$PROJECT_ROOT/ENVIRONMENT.config" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/ENVIRONMENT.config"
    set +a
fi

# Always use the local branch of the workshop deployment, including its state
# bucket override (its no-participant fallback otherwise names a different bucket).
export PARTICIPANT_ID="${PARTICIPANT_ID:-abcd1234}"
export AWS_ENDPOINT_URL="http://localhost.localstack.cloud:4566"
export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
unset AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
export LOCALSTACK_IMAGE="${LOCALSTACK_IMAGE:-localstack/localstack-pro}"
# Local endpoints must bypass any corporate HTTP proxy, including S3 subdomains.
export NO_PROXY="${NO_PROXY:-},${no_proxy:-},localhost,127.0.0.1,localhost.localstack.cloud,.localhost.localstack.cloud"
export no_proxy="$NO_PROXY"

PYTHON="${PYTHON:-python3.13}"
LOCALSTACK_WAIT_SECONDS="${LOCALSTACK_WAIT_SECONDS:-60}"
[[ "$LOCALSTACK_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "LOCALSTACK_WAIT_SECONDS must be a positive integer."
for command_name in docker localstack curl aws terraform "$PYTHON"; do
    command -v "$command_name" >/dev/null 2>&1 || fail "Required command '$command_name' is missing. See --help."
done
"$PYTHON" -c 'import sys; sys.exit(sys.version_info[:2] != (3, 13))' || fail "PYTHON must select Python 3.13 to match the Lambda runtime."
"$PYTHON" -m pip --version >/dev/null 2>&1 || fail "Install pip for $PYTHON."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker and retry."

localstack_ready() {
    curl --fail --silent --output /dev/null --connect-timeout 1 --max-time 2 \
        "http://127.0.0.1:4566/_localstack/health"
}

if ! localstack_ready; then
    if [[ "$(docker inspect --format '{{.State.Running}}' localstack-main 2>/dev/null || true)" == "true" ]]; then
        echo "Waiting for the running LocalStack container..."
    else
        echo "Starting LocalStack..."
        localstack start -d || fail "LocalStack could not start. Check Docker and the workshop's LocalStack configuration."
    fi
fi

deadline=$((SECONDS + LOCALSTACK_WAIT_SECONDS))
until localstack_ready; do
    (( SECONDS < deadline )) || fail "LocalStack did not become ready within ${LOCALSTACK_WAIT_SECONDS}s. Check 'docker logs localstack-main'."
    sleep 1
done

for endpoint in "$AWS_ENDPOINT_URL" "$AWS_ENDPOINT_URL_S3"; do
    curl --fail --silent --output /dev/null --connect-timeout 2 --max-time 5 \
        "$endpoint/_localstack/health" || fail "LocalStack is running, but $endpoint is unreachable. Check that localhost.localstack.cloud and s3.localhost.localstack.cloud resolve to 127.0.0.1."
done

# Match the workshop's platform defaults while allowing an explicit host override.
if [[ "$OSTYPE" == linux-gnu* ]]; then
    database_host="172.17.0.1"
else
    database_host="host.docker.internal"
fi
export TF_VAR_aws_postgres_host="${TF_VAR_aws_postgres_host:-$database_host}"
export TF_VAR_aws_mongo_host="${TF_VAR_aws_mongo_host:-$database_host}"

# The workshop switches local Lambdas to hot reload from these service folders,
# so their dependencies must exist there as well as in Terraform's zip packages.
for requirements in "$PROJECT_ROOT"/backend/*/requirements.txt; do
    [[ -f "$requirements" ]] || continue
    service_dir="$(dirname -- "$requirements")"
    [[ "$(basename -- "$service_dir")" != [_.]* ]] || continue
    echo "Installing local runtime dependencies for $(basename -- "$service_dir")..."
    "$PYTHON" -m pip install --upgrade --target="$service_dir" -r "$requirements"
done

echo "Preparing shared application settings..."
PYTHONPATH="$PROJECT_ROOT/backend/facilities${PYTHONPATH:+:$PYTHONPATH}" \
    "$PYTHON" "$SCRIPT_DIR/configure_local.py"

echo "LocalStack is ready. Deploying the backend..."
exec bash "$PROJECT_ROOT/bin/deploy-backend.sh" local
