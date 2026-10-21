# Deploying the facilities application to AWS

Use the application wrapper below. The supplied `bin/*` scripts remain unchanged;
the wrapper calls their AWS branches in a cloud-only context. It never starts
LocalStack. The explicit `database` command reinitializes application data to the
seed dataset; plan/backend/frontend commands do not reset data.

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

Edit `.env.cloud` to enter the generated JWT key. Keep that key stable across
deployments. Workshop event, participant ID/code and AWS region are inherited from
the VDI environment; do not duplicate them in this file. `AWS_REGION` takes
precedence over `AWS_DEFAULT_REGION`, with `us-east-1` as the fallback. Optional
overrides are commented in the sample for use outside the VDI. Generate a separate
`DATABASE_RESET_KEY` with the same command and set the three `SEED_*_PASSWORD`
values (12–128 nonblank characters) before deploying the reset API. Leaving the
reset key empty disables that endpoint. Fill in the expected
AWS account ID when known. Values are literal dotenv values; exported shell
settings take precedence. `--env-file /path/to/cloud.env` selects another cloud file, and
`APP_ENV_FILE=''` selects environment variables only. The local `.env` is not read.

The workshop must already supply its participant state bucket, VPC with subnets
in at least two availability zones, participant security group and Lambda IAM
execution role. The wrapper discovers the VPC containing the participant's
`coding-workshop-<participant-id>` security group and prints the selected VPC ID.
`TF_VAR_aws_vpc_id` is only needed if that group name exists in multiple VPCs or
you intentionally want to constrain selection. It does not select the default VPC.
The wrapper verifies these resources and the selected Aurora version before
Terraform runs. It obtains temporary AWS credentials through the unchanged
`setup-participant.sh`, which updates the AWS CLI default profile as usual. The
wrapper clears inherited profile/role selectors so stale local credentials cannot
take precedence over the workshop credentials. These commands
also need the workshop permissions to create the application resources, including
the CloudFront Function. No new security groups or rules are created.

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

The API and Aurora share the preprovisioned participant security group, matching
the original workshop configuration. Its existing rules must permit PostgreSQL on
5432 between them; deployment prints the selected group IDs and does not create
groups or change rules. The application does not create a new VPC or enable public
database access. It uses the workshop subnets,
including those with implicit main-route associations. No NAT gateway is required
by this API: configuration is injected and database access remains within the VPC.

The AWS override replaces the workshop's `random_pet` master password with a
32-character generated password. Applying this branch to an existing AWS database
rotates that credential; consumers outside this application must be updated too.
Lambda receives its corresponding new value from the same Terraform resource.

Sensitive inputs, database passwords and saved plans still exist in Terraform
state/plan data. Restrict access to the workshop state bucket and keep `.cloud`
private. These files, real cloud settings and generated inputs are ignored by Git.

## Reinitialize application data through the backend API

The VDI does not connect to Aurora's private PostgreSQL port. Database setup runs
inside the existing facilities Lambda through its normal FastAPI application:

- `POST /dev/database/init` (under `/api/facilities` in the deployed API).
- Supply `X-Database-Reset-Key`, matching `DATABASE_RESET_KEY` in Lambda.
- No application login is required: this operation creates the initial accounts.
- Missing/invalid keys are rejected before database access. The endpoint is disabled
  unless a key of at least 32 bytes is explicitly configured.
- The optional JSON body is `{}`; database targets and operation flags cannot be
  supplied by the caller. The target is Lambda's deployed PostgreSQL configuration.

**This operation replaces all application data with the seed dataset.** It creates
missing application tables, clears application rows, and inserts demo accounts,
facilities, incidents and notes in one transaction. A seeding failure rolls back
the reset. Unrelated tables remain intact. ID sequences keep advancing so old
access tokens cannot identify newly seeded users; old refresh tokens are removed.
It does not migrate existing table definitions.

Configure a separate `DATABASE_RESET_KEY` and the three `SEED_*_PASSWORD` values in
`.env.cloud`. Those values are injected into the facilities Lambda during backend
deployment. Keep them out of frontend/VITE variables. After pulling this change,
run plan/backend to deploy the route and its settings, then:

```bash
./backend/scripts/deploy-cloud.sh database
# Compatibility alias: the --seed option now performs the same reset-and-seed.
./backend/scripts/deploy-cloud.sh database --seed
```

Run one of these commands, not both. Each invocation resets application data.
The wrapper sends the key only in an HTTPS header, not the URL, body or command
arguments. It calls the existing Lambda Function URL API directly to avoid
CloudFront's shorter origin response timeout during setup. There is no custom
Lambda event handler, new Lambda resource, public database access, or security-group
change. You can also use the CloudFront Swagger page: authorize DatabaseResetKey
and execute the Development operation; normal user JWTs do not grant reset access.

The seed account names remain `admin@acme.inc`, `employee@acme.inc`, and
`engineer@acme.inc`. Their passwords are the deployed `SEED_*_PASSWORD` values;
additional sample staff use their role's configured password. Changing these values
requires redeploying the backend. An explicit reset replaces accounts/passwords;
normal redeployments and the standalone additive seed script do not.

The reset key can be cleared followed by backend redeployment to disable this
operation after initialization. Other authenticated endpoints continue normally.
Local scripts retain their existing behavior: `create_tables.py` wipes/recreates
application tables and `seed_database.py` adds missing samples. Direct scripts
still require a network connection to the configured database. The cloud wrapper
no longer runs those scripts on the VDI.

If a previous deployment failed with `ec2:CreateSecurityGroup`, pull the updated
branch, review plan, and rerun backend; no infrastructure cleanup is needed.
Lambda and Aurora retain the preprovisioned workshop security group. The reset API
still requires Lambda-to-Aurora connectivity; reaching Swagger alone does not prove
that connection works.

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
initialization, atomic reset rollback, reset-key authorization and cloud seed
credentials, cloud wrapper isolation tests,
CloudFront request-rewrite tests, full Terraform validation, and mock AWS plans
for cloud/local configurations. They require no AWS credentials. The infrastructure
test runs with `python -m unittest backend.tests.test_cloud_terraform` when Terraform
is installed; CI also validates the full supplied configuration without a backend.

These checks cannot verify your workshop account's IAM policies, service quotas,
available Aurora capacity, network paths or actual CloudFront/Lambda behavior.
The first real AWS plan/deployment and browser acceptance remain account-specific.
