# Coding Workshop - Frontend Code

## Overview

The admin workspace uses React, TypeScript, Vite and MUI Data Grid Community.
It includes authenticated sidebar pages for incidents, users, engineer profiles,
buildings, floors, seats and incident notes. Sign in with a Facility Admin account;
the development seed creates `admin@acme.inc` with password `admin`.

## Direct local development

Use Node.js 24. From `frontend/`:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Vite uses a strict port so its origin matches the
backend's default CORS origin. Start the FastAPI app separately from `backend/`
with `fastapi dev app/main.py`; it normally listens on port 8000. Set the backend
`FRONTEND_ORIGIN` variable before startup if the browser uses a different origin.
The API client defaults to `http://localhost:8000`; set `VITE_API_URL` to override
it, for example in `.env.local` (Vite loads this file). Refresh credentials are
stored in this browser tab's session storage, rotated automatically, and revoked
on sign out. The UI verifies current admin access through `GET /auth/me`.

```bash
npm run typecheck
npm run lint
npm run build
npm run format:check
```

Production builds include TypeScript checking. `src/App.tsx` defines the admin
route boundary, `resources/definitions.tsx` configures the seven tables, and
`components/` contains reusable grids, forms, dialogs and the sidebar layout.
`services/` centralizes requests, validation errors, session persistence and
single-flight refresh; `hooks/` handles cancellable queries and relationship data.

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

The workshop LocalStack/cloud commands below describe a separate deployment path
that has not yet been wired to the incident application.

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
