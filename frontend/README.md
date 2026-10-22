# Coding Workshop - Frontend Code

## Overview

The application uses React, TypeScript, Vite and MUI Data Grid Community.
The backend-verified account determines the available workspaces:

- Facility Admin: sidebar pages for incidents, users, engineer profiles,
  buildings, floors, seats, notes and reports. Demo: `admin@acme.inc` / `admin`.
- Employee: submit incidents and track submitted reports, progress and updates.
  Demo: `employee@acme.inc` / `employee`.
- Engineer: assigned incidents, shared notes and status changes, plus access to
  their own submitted reports. Demo: `engineer@acme.inc` / `engineer`.

Admins and engineers have a **Workspace** selector in both the administration and member
headers. Choose Administration, My incidents, or Assigned to me (when the account
has an engineer profile). Switching preserves the login and capabilities. Personal
and assigned grids/summaries remain scoped to that account; member views hide
administration controls. Returning to Administration restores admin controls.
The selected workspace is represented by the URL and survives reload. Direct URLs
without the required capability redirect to an allowed workspace. Engineers
without admin access use the same selector for Assigned to me and My incidents.
Accounts with only the employee workspace do not need a selector.

Run the backend seed command to add the demo employee and expanded samples to an
existing development database. Existing seeded accounts and passwords are preserved.

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
The Vite proxy removes browser `Origin`, `Referer` and `Sec-Fetch-*` headers on its
server-to-server hop, matching the workshop's LocalStack CORS workaround while
retaining Authorization and JSON request bodies. This avoids LocalStack's empty
403 response before Lambda invocation. Production CloudFront routing is unaffected.

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
and loads `pages/AdminRoutes.tsx` or `pages/MemberRoutes.tsx` after login. The seven resources share grids,
forms and dialogs; `hooks/useResourceActions.ts` owns mutations, while
`resources/incidentActions.ts`, `incidentQuery.ts`, `forms.ts` and `rows.ts` keep
workflow inputs, query translation, payload construction and presentation adapters
separate from the page components.

`services/client.ts` centralizes HTTP errors and single-flight token refresh.
TanStack Query shares and cancels reads, caches successful reads for 30 seconds,
and invalidates affected collections/details after mutations. Explicit Refresh
also reloads the page's relationships. Cached data is cleared at login/logout.
Workspace routes and grid code are loaded separately from the login UI.

The header menu button collapses desktop navigation to an icon rail; links keep
their accessible names and show tooltips. Windows from 900 to 1199 pixels wide
start with the rail; smaller windows use an overlay menu. Grids retain readable
column widths and scroll horizontally within the table, with a scrollbar at the
bottom and support for horizontal wheel/trackpad input. Grid height adapts to the
window, and search/actions stack vertically on narrow screens.

### Employee workspace

`/employee/incidents` provides a server-paginated grid scoped to the current
account's submitted reports, with search, status/priority/category/building filters
and sorting. New incident uses the same validated location/category
inputs as the admin form. The backend supplies the reporter identity and starts
the report Open with Low priority.

Incident pages show location, assigned engineer name, workflow progress,
blocked/escalation reasons and the shared notes conversation. Employees can add
notes while their own incident is active or resolved. Priority starts Low and only
admins can change it or escalate an incident. Resolved and closed reports remain
readable. Assignment, status changes, edits/deletes, people-management links and
admin navigation are absent. The employee workspace
uses incident and note display names without requesting user directories. Assigned
engineer profiles can be opened on demand; other employees’ account details and
assignment lists remain unavailable. Direct admin URLs return employees to their
incident grid; backend authorization also protects direct API calls and other
employees' records.

Engineers retain this submission/tracking view in the My incidents workspace. It
filters by reporter independently of the Assigned to me tab.

Below the page header, summary cards show all the employee's active, resolved and
closed reports. They cover the full personal scope and stay unchanged when grid
search, filters or pagination change. Creating a report or refreshing reloads the
summary along with affected incident data.

### Engineer workspace

Engineers enter `/engineer/incidents` by default. Assigned to me uses the same
server-paginated grid and search/filter/sort machinery, locked to the current
engineer's assignee ID. Own reports stay under `/employee/incidents`. Each detail
page verifies the matching scope; an incident owned by the engineer but assigned
to someone else does not appear as assigned work.

Assigned incident details show the reporter, location, workflow and shared notes.
Assignment sets the incident to Assigned; the assigned engineer accepts it to
start work. Engineers may move In Progress to Blocked or Resolved, and return
Blocked or Resolved to In Progress. Only admins can close or choose arbitrary
statuses. Blocked requires a reason. Engineers can post notes
on active or resolved assignments; closed notes remain readable. Current
assignment is checked by the backend on every operation, so reassignment removes
workflow access. Refresh reloads the incident and its
notes. Priority changes remain admin-only, and engineer pages
provide no assignment, deletion or people-management controls.

Engineer summary cards below the header show awaiting acceptance, in-progress,
blocked and resolved current assignments across the full assigned scope. The My
incidents workspace uses the personal summary instead. Mutations and Refresh update summaries, and counts
never include another engineer's assignments merely because the grid is filtered.

`src/incidents/` shares list/detail/notes/progress components across employee and
engineer scopes. `components/MemberLayout.tsx` owns their responsive account
controls and workspace selection; routes require the backend-verified engineer profile. The API
includes `reporter_name`, `assignee_name` and note `author_name` within authorized
records, avoiding a people-directory request.

### Reports

The final sidebar item, **Reports**, expands to Recurring locations, Response
times, Engineer workload and Category frequency. Navigation scrolls independently
so all links remain reachable in short windows. Selecting Reports from the icon
rail expands the sidebar. Report tables reuse the CRUD grid's controls and
horizontal scrolling.

Report calculations come from dedicated `/reports/*` endpoints (documented in
`../backend/README.md`). Response times supports backend search, paging and
sorting, with all matching incidents included in its averages and sample counts.
Select a timing row’s incident title or ID to inspect it in the shared record
dialog. Other reports paginate and filter their complete aggregate rows in MUI
Data Grid. Report caches are invalidated after CRUD changes; Refresh reloads the current report.

Open incidents, blocked/escalated incidents and ticket notes stay in the existing
CRUD pages. Reports focus on calculations across records. This is the admin UI;
report endpoints enforce the caller's incident visibility for future persona UIs.

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
supported peer dependency. `npm test` runs Vitest unit/contract tests and React Testing Library component tests.
The component tests cover workspace selection and capability-aware routing.

### Coverage measurement

Coverage is reported without pass/fail percentage thresholds. From `frontend/`:

```bash
npm run test:coverage
# With the disposable seeded backend described in Browser verification:
E2E_API_URL=http://localhost:8000 npm run test:e2e:coverage
npm run coverage:report
```

Vitest/Istanbul writes unit/component reports to `coverage/unit/`. Playwright saves
browser counters across reloads/navigation in `coverage/browser/`. The report
command remaps browser counters to the TypeScript/TSX source and merges them with
unit coverage, writing HTML, JSON and LCOV to `coverage/combined/`. Open
`coverage/combined/index.html` for source-level uncovered lines. A combined report
requires both runs; a filtered browser run gives coverage only for those journeys.
Repeat the full browser suite for an application-wide baseline.

All runtime files under `src/` are included, even if untested. Generated contracts,
type-only aliases and declaration files are excluded. Third-party library code,
Vite configuration and test helpers are outside this runtime measurement; their
existing tests still run. Unit-only coverage does not measure browser journeys.
Lines, statements, functions and branches are distinct metrics, and none proves
complete user-path/error-case coverage.

Browser instrumentation is enabled only by `test:e2e:coverage` (or explicitly
`E2E_COVERAGE=1`) on the development server. Hot-reload wrappers are disabled in
that mode so they do not inflate counters. Production builds remain uninstrumented.
CI publishes the reports as the `frontend-coverage` artifact. Generated reports are
ignored by Git.

Grids provide view/edit/delete actions; the row's extra-actions menu handles admin
access and incident assignment, priority/escalation, status and notes. Notes use an
searchable incident selector (ID, title or description), with bounded server results. User creation registers an employee; admin access and Engineer
capability are separate explicit actions. Forms use labeled relationship selects,
required/length validation, pending states and visible API errors. Parent facility
associations stay fixed during label edits, matching the API.

Incident details expose Assign engineer, Priority and escalation, and Change
status; the three-dot row menu provides the same controls. Admins can choose any
other status, including reopening Closed tickets, with a reason required for
Blocked. Assigning a new engineer sets the status to Assigned.

Select an entity’s ID, name or title to open its details; double-clicking rows has
no navigation behavior. `src/dialogs/` owns one shared dialog and its Back history.
Related links replace its contents with another record or a scoped grid:
incident → notes/engineer/location, engineer → assignments, building → floors,
floor → seats, and note → incident/author. Editing and confirmations opened there
also use the same dialog. Back restores the previous grid’s search, filters,
paging and sorting. Close returns to the original page with its grid state and
scroll position preserved. Mutations refresh affected grids and reports.

Related grids use the existing authorized endpoints. Incident relationships keep
their parent filter fixed while using server pagination/search/sorting. Facility
and note lists filter their existing authorized results locally. Non-admins can
open only their own account details, and the backend continues enforcing incident
visibility and workflow permissions. Older admin `?record=<id>` links still open
the dialog, but browsing records no longer changes the URL.

The incident grid defaults to most recently reported first (`created_at desc`).
Its Quick view selector includes Unassigned and Assigned alongside workflow views.
Each preset resets stale filters and search; further search and grid filters refine the view. The incident grid API is
`GET /incidents/grid`; its pagination, filtering and sort parameters are documented
in `../backend/README.md`. MUI's zero-based `page` and
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
If health succeeds with curl but adding `-H 'Origin: http://localhost:3000'` returns
an empty 403, restart Vite after pulling the proxy header fix. The request is being
rejected by LocalStack before reaching FastAPI; changing database credentials or
application CORS settings does not address that rejection.

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

Admin delete confirmations show affected record counts before enabling Confirm.
Facilities remove their contained locations, incidents and notes. User deletion
removes their reports, authored notes, engineer profile and sign-in sessions.
Deleting an engineer profile preserves assigned incidents and notes, unassigns the
incidents, and returns active work to Open; Resolved and Closed statuses remain.
If affected records change after the preview, review the updated counts and confirm
again. Location reports include all matching locations; the repeated-only switch
has been removed.


Employee incident details show 30-day response expectations for the same category
and building. Only aggregate first-assignment, acknowledgment and resolution
averages and sample counts are returned; peer incident details remain private.
Engineers see acknowledgment and resolution averages below their assignment
counts, covering current assignments reported in the last 30 days regardless of
grid filters. Times run from reporting to each first milestone. Missing milestones
are excluded independently, and empty samples show a dash. These are historical
averages, not a promised completion time. The assigned-work grid hides its redundant
Assigned engineer column initially; it remains available in the column chooser.

Incident notes are returned newest timestamp first, with descending ID for ties.
Notes grids and related-note dialogs also default to descending creation timestamp.
