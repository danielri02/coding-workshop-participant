# Coding Workshop - Frontend Code

## Overview

The admin workspace uses React, TypeScript, Vite and MUI Data Grid Community.
It includes authenticated sidebar pages for incidents, users, engineer profiles,
buildings, floors, seats and incident notes. Sign in with a Facility Admin account;
the development seed creates `admin@acme.inc` with password `admin`.

## Workshop local development (default)

Use the provided workshop setup and `./bin/start-dev.sh` from the repository root.
The backend is one `facilities` Lambda service under `backend/facilities/`.
After adding this service to an existing LocalStack environment, register it once
with `./backend/scripts/deploy-local.sh`, then run `./bin/start-dev.sh`. The startup
script compares service counts, so an older unrelated Lambda can otherwise make
it skip deployment of the new service.

Application settings live in the repository-root `.env`, copied from `.env.sample`.
Vite and the backend read this same file. Existing shell variables have highest
priority, followed by the root file, followed by the generated endpoint settings.
`APP_ENV_FILE` selects another shared file relative to the repository root; set it
to an empty value to disable shared-file loading. Restart Vite after changes.

The generator owns `frontend/.env.local`. Vite consumes its `VITE_API_ENDPOINTS`
map and sends browser `/api/facilities/...` requests to the mapped Lambda URL.
This preserves Authorization through an application-owned development proxy.
The supplied port-3001 proxy remains unchanged; its header whitelist would strip
bearer tokens. No manual edits to the generated file are needed.

The frontend exposes only `VITE_API_MODE`, `VITE_API_URL` and `VITE_API_ENDPOINTS`
to the browser. Backend credentials/signing keys and arbitrary `VITE_*` settings
from the shared file are not included in the bundle. Leave the URL/mapping unset
in the root file for automatic workshop discovery. The AWS frontend script's
exported API values override local-file values when building for cloud.

Open `http://localhost:3000`. Swagger is available through the same route at
`http://localhost:3000/api/facilities/docs`. Create/seed tables in the same database
used by the Lambda; see `../backend/README.md`. The seed admin is
`admin@acme.inc` / `admin`. Refresh credentials stay in this browser tab's session
storage, rotate automatically, and are revoked on sign out.

### Direct FastAPI override

For an environment without LocalStack, run FastAPI separately from `backend/`
using `fastapi dev app/main.py`, with an appropriate `DATABASE_URL`. Then, from
`frontend/`, use:

```bash
npm ci
VITE_API_MODE=direct VITE_API_URL=http://localhost:8000 npm run dev
```

Alternatively put both direct-mode values in the shared root `.env`.
`VITE_API_MODE` defaults to `workshop`; changing only `VITE_API_URL` no longer
switches the application out of workshop mode. Set `FRONTEND_ORIGIN` on the direct
backend if the browser uses a different origin than `http://localhost:3000`.

### Checks and architecture

```bash
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
```

Production builds include TypeScript checking. `src/App.tsx` owns authentication
and loads `pages/AdminRoutes.tsx` after login. The seven resources share grids,
forms and dialogs; `hooks/useResourceActions.ts` owns mutations, while
`resources/incidentActions.ts`, `incidentQuery.ts`, `forms.ts` and `rows.ts` keep
workflow inputs, query translation, payload construction and presentation adapters
separate from the page components.

`services/client.ts` centralizes HTTP errors and single-flight token refresh.
TanStack Query shares and cancels reads, caches successful reads for 30 seconds,
and invalidates affected collections/details after mutations. Explicit Refresh
also reloads the page's relationships. Cached data is cleared at login/logout.
The administrator routes and grid code are loaded separately from the login UI.

### API contracts and dependencies

`src/generated/` contains backend-generated transport types, enums, workflow
transitions, field limits and incident-grid query metadata. `src/types.ts` adds
named aliases and a separate presentation row type; engineer API responses retain
`user_id` until the grid adapter supplies an `id`. Do not edit generated files.
After changing backend schemas or workflow policy, regenerate from `frontend/`:

```bash
# Use the Python interpreter where backend dependencies are installed.
PYTHON=/path/to/backend/venv/bin/python npm run generate:api
```

No database connection is required. CI regenerates these files and rejects drift.
Commit `package-lock.json` after dependency changes and use `npm ci` for repeatable
installs. TypeScript is on the 5.9 release line to match the schema generator's
supported peer dependency. `npm test` runs focused HTTP-client, payload, adapter
and cache tests; it does not measure coverage.

Grids provide view/edit/delete actions; the row's extra-actions menu handles admin
access and incident assignment, priority/escalation, status and notes. Notes use an
incident selector. User creation registers an employee; admin access and Engineer
capability are separate explicit actions. Forms use labeled relationship selects,
required/length validation, pending states and visible API errors. Parent facility
associations stay fixed during label edits, matching the API.

The incident grid API is `GET /incidents/grid`; its pagination, filtering and sort
parameters are documented in `../backend/README.md`. MUI's zero-based `page` and
`pageSize` map to `page` and `page_size`, and the response's `row_count` maps to
`rowCount`. The incident page uses server modes for pagination, sorting and
filtering. Other tables use client-side grid pagination/filtering on the complete
authorized list. The endpoint returns flat `assignee_name` fields and
incident notes include `author_name` for display without a people-directory lookup.

## Login troubleshooting

In workshop mode, browser requests should use `/api/facilities/auth/login` on the
Vite origin. If the mapping is missing, deploy the `facilities` service with the
application wrapper `./backend/scripts/deploy-local.sh`, rerun `./bin/start-dev.sh` to regenerate
the mapping, and restart Vite if it was already running. Keep the workshop's
`.env.local`; remove stale `VITE_API_MODE=direct` overrides when returning to this
mode. `VITE_API_ENDPOINTS` must contain a `facilities` entry.

Unexpected token/account responses report a configuration error. A valid
`is_admin: false` account receives the admin-access message. Swagger Authorize
itself accepts both employee and admin credentials. The wrapper deploys the same
database configuration used by the seed scripts. Run
`python backend/scripts/check_database.py --check-admin` to inspect the host target
and admin capability. A 403 on `/auth/login` itself is not the response for an
incorrect password (that is 401); if `/api/facilities/health` also returns 403,
inspect Lambda Function URL access before changing database users or permissions.

## Browser verification

With a seeded development backend running, install Chromium and run:

```bash
npx playwright install chromium
E2E_API_URL=http://localhost:8000 npm run test:e2e
```

The test frontend runs on port 3011; start its backend with
`FRONTEND_ORIGIN=http://localhost:3011`. Tests create and remove their own records;
use a disposable test database. Override `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` if
needed. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing Chromium executable;
test artifacts default to `/tmp/coding-workshop-e2e-results` outside the repo.
The suite covers CRUD across the seven business tables, admin capability changes,
incident actions and validation, login/refresh/logout, mobile navigation, and
backend grid search/paging/sorting. Non-admin login checks create a temporary
employee account, so no particular demo employee password is required.

To exercise the workshop request path without LocalStack, start the real Lambda
handler through the test-only HTTP event bridge, using a disposable DATABASE_URL:

```bash
# From the repository root, after creating and seeding that test database:
python backend/tests/support/lambda_server.py --port 8000
# From frontend/ in another terminal:
E2E_API_MODE=workshop E2E_API_URL=http://localhost:8000 npm run test:e2e
```

This verifies Vite forwarding and Mangum/SQLAlchemy behavior; it does not emulate
LocalStack deployment. CI uses this path. The default browser-test mode remains
direct when targeting a separately running FastAPI process.

## Prerequisites

- React - JavaScript library for building user interfaces
- React Router - Client-side routing for React
- Material UI - Comprehensive UI component library

## Structure

```
coding-workshop-participant/
├── frontend/              # React frontend
│   ├── public/              # Public assets
│   ├── src/                 # Source code
│   │   ├── pages/             # Page components
│   │   ├── components/        # Reusable components
│   │   ├── services/          # API client
│   │   └── App.tsx            # Main app
│   ├── .env.sample          # React environment variables
│   ├── eslint.config.ts     # TypeScript-aware ESLint configuration
│   ├── index.html           # Landing page
│   ├── package.json         # App metadata with dependencies
│   ├── README.md            # Frontend guide (YOU ARE HERE)
│   └── vite.config.ts       # Vite build tool configuration
├── ...
```

## Usage

### Local Development

To run your application locally:

```sh
./bin/start-dev.sh
```

To view your application, open the browser and navigate to `http://localhost:3000`.

### Cloud Deployment

To deploy your frontend to AWS:

```sh
./bin/deploy-frontend.sh
```

To view your application, open the browser and navigate to CloudFront URL.

## Clean Up

To remove all deployed resources (including frontend):

```sh
./bin/cleanup-environment.sh
```

**Warning**: This removes all infra resources. Cannot be undone.
