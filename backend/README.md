# Coding Workshop - Backend Code

For AWS deployment, use the application-owned wrapper described in [CLOUD.md](CLOUD.md).
It keeps cloud settings and state separate from local development and delegates to
the unchanged workshop scripts.

## Incident application: workshop local development

The application is packaged as `backend/facilities/`, discovered by the provided
workshop scripts through its `requirements.txt` and `function.py`. Its
`function.handler` adapts FastAPI with Mangum. All business routes stay in one
service; no Lambda per table is needed. `backend/app` is a relative symlink to
`facilities/app`, preserving existing script imports and direct-development paths
without a second copy of application code. Dependencies installed into the
service by the workshop are ignored by Git.

Use the existing workshop setup. After pulling the new service into an existing
LocalStack environment, run from the repository root:

```bash
cp -n .env.sample .env  # Keep an existing .env; edit its database settings.
./backend/scripts/deploy-local.sh
./bin/start-dev.sh
```

The deployment wrapper starts LocalStack if needed, waits for its local and S3
endpoints, installs Python service dependencies for hot reload, and calls the
unmodified `bin/deploy-backend.sh local`. It loads `ENVIRONMENT.config` when
present and uses local test credentials. Docker must already be running, and
Docker, LocalStack CLI, curl, AWS CLI, Terraform, and Python 3.13 with pip must be
installed. Use `PYTHON=/path/to/python3.13` to select a specific interpreter and
`LOCALSTACK_WAIT_SECONDS=120` to allow a longer startup wait. The wrapper can run
from any directory; run it again to explicitly deploy backend changes.

The wrapper leaves existing LocalStack state intact and does not initialize or
seed the database. `start-dev.sh` handles database and frontend startup; subsequent
normal starts use that command. Explicit deployment is useful because the
provided script can skip deployment when unrelated previously deployed functions
make its service count look sufficient. The workshop scripts remain unchanged.

`infra/facilities_local_access.tf` grants the local `facilities` Function URL the
invocation permissions needed to reach FastAPI. These permissions apply only in
LocalStack; direct function invocation is not granted. Application login and
role checks still apply. Redeploy with the wrapper after pulling access changes.
Check `http://localhost:3000/api/facilities/health` after starting the frontend:
it should return JSON with `status: ok`; a 403 here occurs before any database use.

### Shared application configuration

The repository-root `.env` is shared by the backend, Python scripts, local
deployment and Vite frontend. Edit `POSTGRES_NAME`, `POSTGRES_USER`, `POSTGRES_PASS`,
host/port and any authentication/CORS overrides there. Explicit shell variables
win. A configured `DATABASE_URL` takes precedence over the individual PostgreSQL
fields; unset an old exported URL if you want the component settings to apply.
`APP_ENV_FILE` selects a different shared file relative to the repository root;
`APP_ENV_FILE=''` disables file loading. Values are literal, without interpolation.
Lambda uses injected settings rather than reading a host-side file.

`deploy-local.sh` uses the same Python database configuration and writes
`infra/facilities.local.auto.tfvars.json`, an ignored, owner-readable generated
file. The application-owned Terraform override injects its settings into only the
local `facilities` Lambda, taking priority over workshop defaults. Keeping this
generated input lets later unmodified `start-dev.sh` redeployments use the same
settings. Do not edit the generated file; rerun the wrapper after editing `.env`.
It is ignored for real AWS deployments.

On the host, use the database's normal address (`localhost` by default). For a
loopback address, deployment automatically uses `172.17.0.1` inside Linux Lambda
containers or `host.docker.internal` on other platforms. `POSTGRES_LAMBDA_HOST`
overrides that alias if necessary. It must point to the same PostgreSQL server;
the database name, port, credentials and URL options are shared without changes.

With PostgreSQL running, initialize its application tables from `backend/` using
Python 3.13 and an activated virtual environment:

```bash
python -m pip install -r requirements-dev.txt
python scripts/check_database.py
python scripts/create_tables.py
python scripts/seed_database.py
python scripts/check_database.py --check-admin
```

**`create_tables.py` wipes and recreates all application tables**, including users,
incidents, notes, facilities and refresh tokens, in the configured database.
Unrelated tables and PostgreSQL accounts are preserved. Run it only when you want
a fresh database; rerunning `seed_database.py` alone adds missing samples while
preserving existing records. These commands never run at Lambda startup. Changing
database configuration does not move data from a previously used database.
The admin check distinguishes a missing seed account from an existing account
without Admin capability; it never promotes accounts.

To detect generated configuration that no longer matches the shared settings,
run `python backend/scripts/configure_local.py --check` from the repository root.
This checks the generated deployment input, not the live Lambda: redeployment is
still required to apply changes. Signing-key changes require signing in again.

### Database configuration

The Lambda consumes the workshop's injected `POSTGRES_HOST`, `POSTGRES_PORT`,
`POSTGRES_NAME`, `POSTGRES_USER`, `POSTGRES_PASS` and `IS_LOCAL`. Host-side commands
default to localhost:5432, database `postgres`, user `postgres`, and the workshop's
local password `postgres123`. LocalStack injects the Docker-reachable host address.
`IS_LOCAL=true` disables TLS; false requires TLS. An explicit `DATABASE_URL`
overrides component settings and preserves its own SSL/query parameters, which is
useful for isolated tests and direct development.

`check_database.py` reports the selected host/database/role and configuration
source without printing credentials. Configure host-side commands to match the
Lambda database if your workshop setup uses different values. Lambda requests
use NullPool so connections cannot leak between invocation event loops.

### Direct development override

For environments without LocalStack, set DATABASE_URL if required and run from
`backend/`:

```bash
fastapi dev app/main.py
```

Then use `VITE_API_MODE=direct VITE_API_URL=http://localhost:8000 npm run dev` in
`frontend/`. This is an explicit alternative to the workshop default.

Authentication works without environment configuration for local development.
Unset variables use these defaults:

| Variable | Default |
| --- | --- |
| `JWT_SECRET_KEY` | `coding-workshop-local-development-signing-key` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` |

Environment values override the defaults. The development signing key stays the
same across restarts. Creating tables does not migrate existing table definitions.

If Swagger Authorize reports **Service Unavailable (503)**, inspect the FastAPI
terminal log or the response from `POST /auth/login` for the configuration error.
Explicitly invalid overrides (such as an empty/short `JWT_SECRET_KEY` or invalid
token lifetime) still produce 503. Unset invalid overrides to restore defaults,
or correct them in the shared root `.env`, then restart the server. The file is
loaded automatically by `fastapi dev app/main.py` and maintenance scripts.
An overridden key must contain at least 32 bytes.

### Frontend origin

FastAPI CORS permits `http://localhost:3000` by default, matching the Vite starter.
Override it by setting `FRONTEND_ORIGIN` before starting the backend, for example
`FRONTEND_ORIGIN=http://127.0.0.1:3000 fastapi dev app/main.py`. Supply the complete
browser origin (scheme, host and port). Authorization and Content-Type headers
are allowed for GET/POST/PATCH/DELETE requests. Browser access uses bearer tokens;
cross-origin cookies are not required.

### Incident grid API

`GET /incidents/grid` provides paginated rows for MUI Data Grid. It accepts:

| Parameter | Behavior |
| --- | --- |
| `page` | Zero-based page number, default 0 |
| `page_size` | Rows per page, 1–100, default 25 |
| `sort_by` | Default `created_at`; also id, title, category, status, priority, assignee_name, building_id, floor_id, seat_id, reporter_id, assignee_id and milestone timestamps |
| `sort_direction` | `desc` (default) or `asc`; nulls sort last and IDs break ties |
| `search` | Case-insensitive literal substring in incident title or description; whitespace-only searches clear this filter; maximum 200 characters |
| `escalated` | `true` for incidents with an escalation reason, `false` for those without; omit for both |
| `unassigned` | `true` for incidents without an engineer, `false` for assigned incidents; omit for both |
| Structured filters | Exact reporter_id, assignee_id, building_id, floor_id, seat_id, status, priority and category |

For example, `/incidents/grid?page=0&page_size=25&search=printer&sort_by=created_at&sort_direction=desc`
returns `{ "rows": [...], "row_count": 42, "page": 0, "page_size": 25 }`, where the
count reflects the same filters and caller permissions as the rows. Search/filter
conditions combine with AND. Sorting status, priority and category uses their
stored text labels. Page requests beyond the last page return empty rows and the
matching count. Unsupported sort fields and invalid inputs return 422.

The existing `GET /incidents` still returns the full matching array and supports
the same search and filter parameters. Incident responses now include
`reporter_name` and `assignee_name` (null when unassigned), and note responses
include `author_name`.
These names are available only within incidents/notes the caller may read;
employee access to other users' account records remains restricted.

### Report API

Read-only report endpoints calculate across the complete authorized incident set:

| Endpoint | Result |
| --- | --- |
| `GET /reports/summary?scope=personal` | Total, active and per-status counts across all the caller's own reports; `assigned` requires Engineer capability, `visible` follows existing read grants |
| `GET /reports/locations?level=building` | Location counts, ranked by frequency; `level` also accepts `floor` and `seat`; optional `category` and `repeated_only` filters |
| `GET /reports/categories` | Counts, active counts and percentage per category, including categories with zero incidents |
| `GET /reports/timings` | First assignment, acknowledgment and resolution averages, sample counts and paged incident timing rows |
| `GET /reports/workload` | Every engineer's availability, active/status/high-priority counts and the active unassigned incident count; admin only |

Locations, categories and timings accept `scope=visible` (default, caller's existing
incident access), `personal` (own reports), or `assigned` (engineer assignments;
requires Engineer capability). Employee and engineer access cannot be broadened
by changing scope. Admin report pages always use the complete visible scope; personal/assigned scope
selectors are reserved for future employee/engineer views, while the API retains
its existing scoped access checks.

The summary defaults to `personal` and always covers the entire requested scope,
independent of grid search, filters and pagination. Employee cards show active,
resolved and closed reports; engineer cards show awaiting acceptance, in-progress, blocked and resolved
current assignments. Ordinary users cannot choose another employee/engineer ID.

Locations, categories and timings accept `period=week|month|year|all`, defaulting
to `month`: rolling 7 days, 30 days, 12 calendar months, or all time. Windows use
**incident reported/created date**, not assignment or resolution date. Responses
include the exact UTC `start_at` (null for all time) and `end_at`. Future-dated
incidents are excluded. Summary cards over employee/engineer grids remain all-time;
engineer workload remains a current snapshot.

Location counts combine all categories by default; `category` selects one category.
`repeated_only=true` keeps locations with at least two incidents in the selected
period/category. Floor/seat grouping excludes incidents without those locations.
Category frequency accepts `building_id`, `floor_id`, and `seat_id`; absent filters
include all locations, and category shares use the complete matching incident set.
Active means Open, Assigned, In Progress or Blocked. Workload includes idle and
unavailable engineers; availability is independent of assignment count.

Timing durations start at reporting. Assignment enters Assigned; the assigned
engineer accepts into In Progress to record acknowledgment. An admin can skip
stages; resolving without acknowledgment records both at that instant. First
milestones are retained when work resumes or is reassigned. Timings accept
`category` and `assignee_id` (the **current/latest assigned engineer**). Attribution
uses current assignment, not assignment history: first milestones may include work
by previous engineers. Existing pre-upgrade acknowledgment timestamps retain their
original meaning and are not rewritten.
Missing milestones are excluded from averages and have null durations,
not zero. Timing summaries cover all matching incidents, independent of the current
page. `/reports/timings` accepts `search` (literal title/description substring, max
200 characters), `page`, `page_size` (1–100), `sort_by` and `sort_direction`. Sorts
support id, title, status, priority, category, created_at, assignee_name and the
three `*_minutes` fields; defaults are created_at/desc, with nulls last and ID ties.

Open/blocked/escalated incident lists and notes remain in the CRUD grids rather
than duplicate report endpoints.

### Admin incident quick views

The incident grid offers All incidents, Needs assignment (Open and unassigned),
Awaiting acceptance (Assigned), Blocked, Escalated, and Ready to close (Resolved).
Each preset clears old search/filter state, restores newest-first ordering, resets
the page, and selects useful columns. Blocked/Escalated include the matching reason
column. Manual changes are labeled Custom; All incidents restores the default view.

### Unexpected errors and maintenance

Unexpected request failures return a sanitized JSON 500 response with `detail`
and `request_id`. The same ID appears in the `X-Request-ID` response header and
the server log, alongside the exception class. The error boundary avoids logging
SQL parameters, credentials or request input, and allowed frontend origins still
receive CORS headers on these responses. Validation and conflict responses retain
their usual 422/409 behavior.

To preview expired refresh credentials, run from `backend/`:

```bash
python scripts/prune_refresh_tokens.py
# Explicitly delete only credentials whose absolute expiry has passed:
python scripts/prune_refresh_tokens.py --apply
```

Consumed/revoked credentials remain until their expiry so replay detection and
refresh-chain invalidation continue to work. This is a manual maintenance command;
API startup performs no cleanup. Existing last-admin access policy is unchanged.

Backend workflow policy lives in `app/domain/incidents.py`. After changing schemas
or workflow rules, regenerate frontend contracts with its `npm run generate:api`
command. The exporter imports the application without connecting to PostgreSQL.

### Swagger login

Open `http://localhost:3000/api/facilities/docs` in workshop mode (or
`http://127.0.0.1:8000/docs` for direct development), click **Authorize**, and enter:

- **username:** `admin@acme.inc`
- **password:** `admin`
- Leave client ID, client secret and scopes empty.

Swagger uses the form-based `POST /auth/token` endpoint and sends the returned
bearer access token with protected requests. `POST /auth/login` remains available
for JSON `{ "email": "...", "password": "..." }` clients. Registration is public
through `POST /users`; it grants employee access only. `GET /auth/me` returns the
authenticated account and its current capabilities, without credential fields;
the frontend uses it when restoring a login.

On the frontend sign-in screen, **Create an account** accepts a name, an exact
`@acme.inc` email address and a 12–128 character password. New accounts have
employee access only. Successful registration returns to sign-in with the email
filled in; duplicate accounts show a field error without discarding the form.

Development seed logins are `admin@acme.inc` / `admin`, `employee@acme.inc` /
`employee`, and `engineer@acme.inc` / `engineer`. No password environment variable
is needed. Additional sample staff (`employee2`, `employee3`, `engineer2`,
`engineer3`, `engineer4`, all at `acme.inc`) use their base role as the password.
Existing accounts, passwords, roles, availability and edited content are preserved
on seed reruns. A pre-existing non-admin `admin@acme.inc` account is rejected rather
than promoted. Public registration still requires 12–128 character passwords;
these simple development seed credentials are explicit exceptions.

A fresh seed includes 16 users, eight engineers (including unavailable and idle
engineers), six buildings, 18 floors, 108 seats, 240 incidents and 653 notes.
The primary employee has 192 incidents across every status; five other employees
own the remaining 48. Dates are relative to the time seeding runs: the dataset
spans recent days through approximately 20 months, with every status and completed
milestones in the last seven days. Category hotspots, priorities, engineer workloads,
and response durations vary. The newest six tickets form an unassigned intake queue.
Generated milestones and notes never lie in the future. Refresh tokens are created
by actual logins, not by seeding.

Additive seeding preserves existing ticket content and dates. To refresh a demo
dataset's clock, explicitly reset and seed it again. For cloud, run
`./backend/scripts/deploy-cloud.sh database --seed`; locally, run `create_tables.py`
then `seed_database.py`. This replaces application data; normal redeployments do
not move timestamps or reset records.

### Route permissions

All business operations require a bearer access token except public registration.
Health, login/token/refresh/logout and API documentation are public. Refresh and
logout authenticate the supplied refresh credential rather than an access JWT.

| Operation | Access |
| --- | --- |
| Read incidents and their complete shared notes | Own reports; engineers also get current assignments; admins get all |
| Create incidents | Any signed-in employee; reporter comes from the access token, priority defaults to Low; only admins may supply priority/escalation |
| Correct submitted incident details, assign/unassign, delete incidents | Admin |
| Change incident status | Assigned engineer: Assigned → In Progress, In Progress → Blocked/Resolved, Blocked/Resolved → In Progress; admin: any status, including Open and Closed |
| Change priority/escalation | Admin |
| Post notes | Reporter, assigned engineer or admin until closure, including Resolved; author comes from the access token |
| Edit/delete existing notes | Admin, including after resolution/closure |
| Read facilities and engineer profiles | Any signed-in employee, for location/assignee lookups |
| Create/update/delete facilities or engineer profiles | Admin |
| Read/edit an account | Account owner or admin; credentials and roles are excluded from ordinary updates |
| List/delete users or grant/remove admin capability | Admin |

Employee, Engineer and Admin grants combine. Capabilities are read from the
database for every request, so role changes and reassignment do not require a new
access token. Incident list filters cannot expand the caller's read scope.
Missing/invalid credentials return 401; denied actions return 403. Updates use
PATCH, validation errors use 422, and conflicting operations use 409.

### Member response-time summaries

`GET /incidents/{id}/response-times` first checks incident visibility, then returns
aggregate response expectations for that incident's category and building across
all reporters. It never returns peer incident rows, titles, descriptions, author
names or IDs. `GET /reports/my-response-times` requires Engineer capability and is
fixed to the signed-in engineer's current assignments, even for admin-engineers.
Caller-supplied report/grid filters do not change either fixed cohort.

Both use incidents reported within a rolling 30-day UTC window, including its
boundaries and excluding future reports. Responses contain the window, cohort
size, and independent averages/sample counts for reporting-to-first-assignment,
reporting-to-first-acknowledgment and reporting-to-first-resolution. Missing
milestones are excluded from their own averages; no samples means null, not zero.
The engineer UI displays acknowledgment and resolution, since assignment is an
admin action. With no assignment history, current assignee determines membership;
first milestones remain historical and may predate reassignment. These summaries
reuse the existing SQL timing calculations without loading incident rows.

`GET /incidents/{id}/notes` returns newest timestamps first, with descending IDs
for deterministic ties. No schema change or data reset is needed for this batch.

### Confirmed cascade deletion

Admins can request `GET /deletions/{resource}/{id}` for `users`,
`engineer-profiles`, `buildings`, `floors`, `seats`, `incidents` or `notes`.
The preview includes affected business-record counts, the number of retained
incidents that will be unassigned, and a `confirmation_token`. Pass that token as
`?confirmation=...` to the resource's existing DELETE endpoint. A deletion with
dependents or assignments requires confirmation; an unreferenced leaf may still
be deleted directly. A missing or stale confirmation returns 409 without deleting
anything. Reload the preview, review the changed impact and confirm again.

Buildings/floors/seats cascade contained facilities, incidents and notes. Users
cascade their reported incidents, authored notes, engineer profiles and refresh
sessions. Engineer profile removal preserves other reporters' incidents and notes,
unassigns their work and resets active incidents to Open; Resolved and Closed keep
their status. First assignment, acknowledgment and resolution timestamps remain.

Cascades lock affected parents and delete children before parents in one database
transaction. Existing restrictive foreign keys remain in place as integrity
checks; this change requires no schema migration, table reset or reseeding.

A new engineer assignment or reassignment sets Assigned and clears an obsolete
blocked reason. The assigned engineer clicks **Accept and start work** to enter
In Progress; Assigned cannot transition directly to Blocked or Resolved for an
engineer. Saving the same assignee preserves status; unassigning active work returns
it to Open. First assignment, acknowledgment and resolution milestones are retained.
Only admins close tickets, reopen Closed tickets, or choose arbitrary statuses.
Blocked requires a reason; resolution does not. Notes remain writable until closure.

Existing databases need the non-destructive status constraint upgrade before using
Assigned. Run `python backend/scripts/initialize_database.py` for a reachable local
database, or use the cloud procedure in [CLOUD.md](CLOUD.md). Existing In Progress
records remain in progress. New databases and explicit resets already include it.

### Refresh and logout

`POST /auth/refresh` accepts `{ "refresh_token": "..." }` and returns a replacement
token pair. Refresh hashes, expiration and family IDs are stored in
`refresh_tokens`; raw refresh credentials are not stored. Tokens are consumed
once, and reusing a consumed token revokes that login's complete refresh chain.

`POST /auth/logout` accepts the same payload and returns 204. Any refresh token
from the login, including a consumed ancestor, invalidates all descendants.
Unknown/already-invalidated credentials also return 204. Independent logins stay
active. Already issued access JWTs remain usable until their short expiration
(15 minutes by default); logout invalidates the refresh chain.

The service accepts both the local stripped path and `/api/facilities` prefixes.
The provided workshop files are unchanged. The application-owned
`infra/facilities_override.tf` raises only this service to 256 MiB: a clean Python
runtime login peaked around 139 MiB, exceeding the supplied 128 MiB setting.
Other services retain the provided 128 MiB allocation. AWS deployment has not
been run or verified as part of this local integration.

## Overview

This folder contains backend services for CRUD operations with examples. Python with PostgreSQL are preferred, but Java and NodeJS with MongoDB options are available.

## Coverage measurement

Install `backend/requirements-dev.txt` and point `TEST_DATABASE_URL` at a disposable
PostgreSQL database, then run from the repository root:

```bash
python -m coverage run -m unittest discover -s backend/tests
python -m coverage report
python -m coverage html
python -m coverage xml
python -m coverage json
```

`.coveragerc` measures statements/lines and branches in the facilities runtime and
application-owned maintenance/deployment scripts, including untested files. Tests,
provided workshop scripts, examples and third-party packages are outside the
measurement. Reports go to `coverage/backend/`; open `html/index.html` for the
source-level report. CI uploads the same reports as `backend-coverage`.

This is measurement only: no percentage thresholds are enforced. Coverage is not
an endpoint/error-scenario or user-journey completeness claim. PostgreSQL-backed
tests require `TEST_DATABASE_URL`; without it those integration classes skip and
the reported coverage will be lower. Optional Terraform-dependent tests likewise
need their tools/providers. Generated reports are ignored by Git. Alembic remains
deferred; no migration framework is introduced by this setup.

## Prerequisites

- Compute environment
    - AWS Lambda with Python Runtime and AWS SDK for Python (Boto3)
    - AWS Lambda with NodeJS Runtime and AWS SDK for JavaScript
    - AWS Lambda with Java Runtime and AWS SDK for Java
- Database environment
    - AWS Aurora for PostgreSQL-compatible database
    - AWS DocumentDB for MongoDB-compatible database

Predefined environment variables are injected into each backend service automatically, simplifying the need to manage them manually:

| Variable        | Description           | Local                  | Cloud                   |
| --------------- | --------------------- | ---------------------- | ----------------------- |
| `IS_LOCAL`      | Is it local or cloud? | `true`                 | `false`                 |
| `POSTGRES_HOST` | PostgreSQL hostname   | `localhost`            | AWS Aurora endpoint     |
| `POSTGRES_PORT` | PostgreSQL port       | `5432`                 | `5432`                  |
| `POSTGRES_NAME` | PostgreSQL name       | *(empty)*              | AWS Aurora database     |
| `POSTGRES_USER` | PostgreSQL username   | *(empty)*              | AWS Aurora username     |
| `POSTGRES_PASS` | PostgreSQL password   | *(empty)*              | AWS Aurora password     |
| `MONGO_HOST`    | MongoDB hostname      | `172.17.0.1` (Linux) / `host.docker.internal` (Mac/Windows) | AWS DocumentDB endpoint |
| `MONGO_PORT`.   | MongoDB port          | `27017`                | `27017`                 |
| `MONGO_NAME`    | MongoDB db name       | *(empty)*              | AWS DocumentDB database |
| `MONGO_USER`    | MongoDB username      | *(empty)*              | AWS DocumentDB username |
| `MONGO_PASS`    | MongoDB password      | *(empty)*              | AWS DocumentDB password |

> **Connection behavior:** When `IS_LOCAL` is `true`, the connection uses no TLS even if credentials are present (local MongoDB requires auth but not TLS). When `IS_LOCAL` is `false`, TLS is required for DocumentDB.

## Structure

The backend is organized into Lambda functions, one for each CRUD service:

```
coding-workshop-participant/
├── backend/                             # Backend services
│   ├── _examples/                         # Hello world examples
│   │   ├── java-service/                    # Backend service example for Java developers
│   │   │   ├── src/main/java/com/example/     # Path to Java package
│   │   │   │   ├── Handler.java               # Business logic using Java
│   │   │   │   ├── MongoService.java          # MongoDB connectivity service
│   │   │   │   └── PostgresService.java       # PostgreSQL connectivity service
│   │   │   └── pom.xml                        # Java configuration and dependencies
│   │   ├── nodejs-service/                  # Backend service example for NodeJS developers
│   │   │   ├── eslint.config.js               # ESLint JS tool configuration
│   │   │   ├── index.js                       # Business logic using NodeJS
│   │   │   ├── mongo-service.js               # MongoDB connectivity service
│   │   │   ├── package.json                   # NodeJS configuration and dependencies
│   │   │   └── postgres-service.js            # PostgreSQL connectivity service
│   │   └── python-service/                  # Backend service example for Python developers
│   │       ├── function.py                    # Business logic using Python
│   │       ├── mongo_service.py               # MongoDB connectivity service
│   │       ├── postgres_service.py            # PostgreSQL connectivity service
│   │       └── requirements.txt               # Python configuration and dependencies
│   └── README.md                        # Backend guide (YOU ARE HERE)
├── ...
```

## Adding a New Service

Place your service folder **directly under `backend/`** — one level deep:

```
backend/
├── my-service/          ✓ will be deployed
│   └── function.py
├── _examples/
│   └── my-service/      ✗ will NOT be deployed (underscore prefix)
│       └── function.py
└── group/
    └── my-service/      ✗ will NOT be deployed (too deep)
        └── function.py
```

Terraform auto-discovers services by looking for `function.py` (Python), `package.json` (Node.js), or `pom.xml` (Java) one level under `backend/`. Any folder prefixed with `_` is ignored.

## Usage

### Local Development

To run your application locally:

```sh
./bin/start-dev.sh
```

To test your code changes:

```sh
# Example: Get all records for {{service-name}}
curl -X GET https://localhost:3001/api/{{service-name}} \
     -H "Content-Type: application/json"
```

Replace `{{service-name}}` with corresponding service name
(e.g. `python-service`).

To tail logs in real-time:

```sh
# Example: Get logs for {{service-name}}
AWS_ENDPOINT_URL="http://localhost.localstack.cloud:4566" \
    aws logs tail /aws/lambda/{{function-name}} \
        --follow --format short --color on
```

Replace `{{function-name}}` with corresponding service name
(e.g. `coding-workshop-python-service-abcd1234`).

### Cloud Deployment

To deploy your backend to AWS:

```sh
./bin/deploy-backend.sh
```

To test your newly deployed code:

```sh
# Example: Get all records for {{service-name}}
curl -X GET https://{API_BASE_URL}/api/{{service-name}} \
     -H "Content-Type: application/json"
```

Replace `{{service-name}}` with corresponding service name
(e.g. `python-service`).

To tail logs in real-time:

```sh
# Example: Get logs for {{service-name}}
aws logs tail /aws/lambda/{{function-name}} \
    --follow --format short --color on
```

Replace `{{function-name}}` with corresponding service name
(e.g. `coding-workshop-python-service-abcd1234`).

## Clean Up

To remove all deployed resources (including backend):

```sh
./bin/cleanup-environment.sh
```

This will remove all AWS resources such as Lambda functions, CloudFront distributions, and much more.

**Warning**: This removes all infra resources. Cannot be undone.
