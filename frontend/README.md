# Coding Workshop - Frontend Code

## Overview

The starter uses React, TypeScript, Vite and MUI. MUI Data Grid Community is
installed for the upcoming incident grid. The application screens and API client
are not implemented yet.

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

```bash
npm run typecheck
npm run lint
npm run build
```

Production builds include TypeScript checking. `src/App.tsx` is the starter
component, `src/main.tsx` provides the MUI theme/CssBaseline, and Vite/ESLint
configuration also uses TypeScript. The `.env.sample` file uses Vite's `VITE_*`
variable names for the future API client.

The incident grid API is `GET /incidents/grid`; its pagination, filtering and sort
parameters are documented in `../backend/README.md`. MUI's zero-based `page` and
`pageSize` map to `page` and `page_size`, and the response's `row_count` maps to
`rowCount`. Use server modes for pagination, sorting and filtering, sending grid
model changes as requests. The endpoint returns flat `assignee_name` fields and
incident notes include `author_name` for display without a people-directory lookup.

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
