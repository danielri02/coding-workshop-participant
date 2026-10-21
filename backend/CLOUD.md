# Deploying the facilities application to AWS

Use the application wrapper below. The supplied `bin/*` scripts remain unchanged;
the wrapper calls their AWS branches in a cloud-only context. It never starts
LocalStack and never resets application tables.

## Configure once

Use a clean, committed checkout of the `cloud` branch and Python 3.13 with the
backend dependencies installed. The machine needs Docker, AWS CLI, Terraform 1.11+
(tested with 1.13.5), Bash, curl, jq and dig. Frontend deployment also needs Node.js
24 and npm. Docker is required for plan/backend commands because Lambda's native
dependencies are packaged using its Linux x86_64 build image.

From the repository root:

```bash
python3.13 -m pip install -r backend/requirements-dev.txt
cp .env.cloud.sample .env.cloud
chmod 600 .env.cloud
python3.13 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Edit `.env.cloud`: enter the workshop event, participant ID/code, and the generated
JWT key. Keep that key stable across deployments. Fill in the expected AWS account
ID when known. Values are literal dotenv values; exported shell settings take
precedence. `--env-file /path/to/cloud.env` selects another cloud file, and
`APP_ENV_FILE=''` selects environment variables only. The local `.env` is not read.

The workshop must already supply its participant state bucket, VPC with subnets
in at least two availability zones, participant security group and Lambda IAM
execution role. The wrapper verifies these and the selected Aurora version before
Terraform runs. It obtains temporary AWS credentials through the unchanged
`setup-participant.sh`, which updates the AWS CLI default profile as usual. The
wrapper clears inherited profile/role selectors so stale local credentials cannot
take precedence over the workshop credentials. These commands
also need the workshop permissions to create the application resources, including
its database security group/rules and CloudFront Function.

## Plan and deploy infrastructure

```bash
./backend/scripts/deploy-cloud.sh plan
# Review the changes, AWS account, region and participant.
./backend/scripts/deploy-cloud.sh backend
```

`backend` calls `bin/deploy-backend.sh aws`, which recomputes and automatically
applies its plan. It does not apply the saved plan verbatim. Run it only after
reviewing the intended changes. No AWS deployment is performed merely by pulling
this branch or running tests.

The wrapper clears inherited LocalStack endpoints/test credentials, local database
URLs and stale Vite settings. It uses `.cloud/<participant>/<region>/terraform` for
Terraform metadata; local development keeps its existing metadata. Source packages
come from a temporary `git archive HEAD` snapshot, so locally installed hot-reload
dependencies and ignored settings cannot enter the package. Commit source changes
before invoking the wrapper. The temporary checkout is removed afterwards.

Terraform supplies the Aurora connection settings, a generated database password,
and the configured JWT key to the facilities Lambda. The known development signing
key is rejected in cloud mode. Cloud JWT/runtime overrides cannot replace database
identity. Both Function URL invocation permissions are explicitly granted; FastAPI
authentication and role checks remain required on protected endpoints.

The API and Aurora share a dedicated VPC security group permitting PostgreSQL on
5432. Existing workshop security groups remain attached. The application does not
create a new VPC or enable public database access. It uses the workshop subnets,
including those with implicit main-route associations. No NAT gateway is required
by this API: configuration is injected and database access remains within the VPC.

The AWS override replaces the workshop's `random_pet` master password with a
32-character generated password. Applying this branch to an existing AWS database
rotates that credential; consumers outside this application must be updated too.
Lambda receives its corresponding new value from the same Terraform resource.

Sensitive inputs, database passwords and saved plans still exist in Terraform
state/plan data. Restrict access to the workshop state bucket and keep `.cloud`
private. These files, real cloud settings and generated inputs are ignored by Git.

## Initialize and optionally seed the database

Run maintenance on a machine with network connectivity to the Aurora VPC, such as
the workshop WorkSpace. If its existing rules do not permit access, set
`TF_VAR_facilities_maintenance_security_group_ids='["sg-..."]'` in `.env.cloud` to
the machine's security group in that same VPC, then rerun plan/backend. A security
group rule does not create connectivity from a laptop outside the VPC; use a
connected runner rather than exposing PostgreSQL publicly.

```bash
./backend/scripts/deploy-cloud.sh database
```

This reads the **actual deployed Lambda environment**, checks its database target,
then calls `initialize_database.py` to create missing tables without deleting any
records. It does not use a separately edited database password/URL. Existing table
definitions are not migrated; later schema changes need an explicit upgrade plan.

For the optional demo dataset, configure `SEED_ADMIN_PASSWORD`,
`SEED_EMPLOYEE_PASSWORD` and `SEED_ENGINEER_PASSWORD` with 12–128 nonblank characters
in the same cloud file, then run:

```bash
./backend/scripts/deploy-cloud.sh database --seed
```

The account names remain `admin@acme.inc`, `employee@acme.inc` and
`engineer@acme.inc`. Additional sample staff use their role's configured password.
Local seeding retains `admin`, `employee` and `engineer` as defaults. Seed reruns
preserve existing passwords, roles and edited data; changing the cloud password
settings does not reset accounts. No separate cloud seed program is introduced.

**Do not use `create_tables.py` as a cloud deployment step. It deliberately wipes
application data.**

## Publish the frontend and verify

```bash
./backend/scripts/deploy-cloud.sh frontend
./backend/scripts/deploy-cloud.sh smoke
# Optional: verify all three seeded logins, summaries and token refresh/logout.
./backend/scripts/deploy-cloud.sh smoke --login
```

`frontend` runs `npm ci` in the clean snapshot and invokes
`bin/deploy-frontend.sh aws`. That script exports the Terraform-derived CloudFront
URL/service mapping, builds, uploads to S3 and invalidates CloudFront. The wrapper
selects workshop API mode. It does not use `generate-env.sh` or the local proxy.

CloudFront serves frontend and API on one origin. Frontend navigation routes are
rewritten to `index.html`; API and asset paths retain their error statuses/bodies.
API caching stays disabled. `FRONTEND_ORIGIN` can remain unset for this same-origin
setup; optionally configure a complete HTTPS origin for intentional cross-origin
browser access. Function URL wildcard CORS is disabled for the cloud facilities
service, while the local path retains its existing settings.

Smoke checks verify health, JSON 401/404 responses and frontend deep links. `--login`
also verifies the seeded roles, scoped summaries and refresh/logout. These checks
do not create/delete business records. Test the actual browser journeys and verify
persistence after a normal redeployment before considering the AWS environment
accepted. Aurora pause/resume may make the first connection slower; the deployed
connection timeout is 30 seconds. `/health` alone does not establish DB readiness.

## Verification and limits

The automated checks include real PostgreSQL tests for non-destructive
initialization and cloud seed credentials, cloud wrapper isolation tests,
CloudFront request-rewrite tests, full Terraform validation, and mock AWS plans
for cloud/local configurations. They require no AWS credentials. The infrastructure
test runs with `python -m unittest backend.tests.test_cloud_terraform` when Terraform
is installed; CI also validates the full supplied configuration without a backend.

These checks cannot verify your workshop account's IAM policies, service quotas,
available Aurora capacity, network paths or actual CloudFront/Lambda behavior.
The first real AWS plan/deployment and browser acceptance remain account-specific.
