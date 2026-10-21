# Coding Workshop - Backend Code

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
./bin/deploy-backend.sh local
./bin/start-dev.sh
```

The first command registers the new service explicitly; subsequent normal starts
use `start-dev.sh`. The provided script can skip deployment when unrelated
previously deployed functions make its service count look sufficient.

With PostgreSQL running, initialize its application tables from `backend/` using
Python 3.13 and an activated virtual environment:

```bash
python -m pip install -r requirements-dev.txt
python scripts/check_database.py
python scripts/create_tables.py
SEED_PASSWORD='development-only' python scripts/seed_database.py
```

These additive commands target the same database/role as the workshop defaults.
They never run at Lambda startup. Existing tables/data are preserved; changing the
database configuration does not move data from a previously used database.

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
or correct them in the shell that launches FastAPI, then restart the server. A
`.env` file is not automatically loaded by `fastapi dev app/main.py`; use an
exported variable or an explicit environment-file loading option. An overridden
key must contain at least 32 bytes.

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
| `sort_by` | Default `id`; also title, category, status, priority, assignee_name, building_id, floor_id, seat_id, reporter_id, assignee_id and milestone timestamps |
| `sort_direction` | `asc` (default) or `desc`; nulls sort last and IDs break ties |
| `search` | Case-insensitive literal substring in incident title or description; whitespace-only searches clear this filter; maximum 200 characters |
| `escalated` | `true` for incidents with an escalation reason, `false` for those without; omit for both |
| Structured filters | Exact reporter_id, assignee_id, building_id, floor_id, seat_id, status, priority and category |

For example, `/incidents/grid?page=0&page_size=25&search=printer&sort_by=created_at&sort_direction=desc`
returns `{ "rows": [...], "row_count": 42, "page": 0, "page_size": 25 }`, where the
count reflects the same filters and caller permissions as the rows. Search/filter
conditions combine with AND. Sorting status, priority and category uses their
stored text labels. Page requests beyond the last page return empty rows and the
matching count. Unsupported sort fields and invalid inputs return 422.

The existing `GET /incidents` still returns the full matching array and supports
the same search and filter parameters. Incident responses now include
`assignee_name` (null when unassigned), and note responses include `author_name`.
These names are available only within incidents/notes the caller may read;
employee access to other users' account records remains restricted.

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

The simple admin credential is a development seed default. Rerun the seed command
to create this account in an existing development database; existing accounts and
passwords are preserved. `SEED_PASSWORD` controls newly created
`demo.engineer@acme.inc` and `demo.employee@acme.inc` accounts, independently of
the admin default. A pre-existing non-admin `admin@acme.inc` account is rejected
rather than promoted. Public registration still requires 12–128 character
passwords; the seeded admin is the explicit exception.

### Route permissions

All business operations require a bearer access token except public registration.
Health, login/token/refresh/logout and API documentation are public. Refresh and
logout authenticate the supplied refresh credential rather than an access JWT.

| Operation | Access |
| --- | --- |
| Read incidents and their complete shared notes | Own reports; engineers also get current assignments; admins get all |
| Create incidents | Any signed-in employee; reporter comes from the access token |
| Correct submitted incident details, assign/unassign, delete incidents | Admin |
| Change incident status | Assigned engineer or admin, following valid transitions |
| Change priority/escalation | Reporter on own active incident; admin on any incident |
| Post notes | Reporter, assigned engineer or admin on an active incident; author comes from the access token |
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
