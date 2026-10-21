# Coding Workshop - Backend Code

## Incident application: direct local development

Run these commands from `backend/`, using Python 3.13 and your activated virtual
environment:

```bash
python -m pip install -r requirements-dev.txt
# Set DATABASE_URL to your PostgreSQL connection URL if the default does not fit.
python scripts/check_database.py
python scripts/create_tables.py
SEED_PASSWORD='development-only' python scripts/seed_database.py
fastapi dev app/main.py
```

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

### Swagger login

Open `http://127.0.0.1:8000/docs`, click **Authorize**, and enter:

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

The workshop Lambda/LocalStack packaging and cloud configuration below are a
separate path; the direct application is not yet wired into that deployment path.

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
