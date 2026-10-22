#!/usr/bin/env bash
# Install dependencies once with: npm --prefix frontend ci
# Examples from the repository root:
#   ./frontend/test.sh
#   ./frontend/test.sh --coverage
#   ./frontend/test.sh tests/contracts.test.ts
#   ./frontend/test.sh --e2e
#   ./frontend/test.sh --all-coverage

# Stop on failures so a later successful command cannot hide a failed test run.
set -euo pipefail

# npm commands must run inside frontend, regardless of the caller's directory.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Usage: ./frontend/test.sh [--coverage|--e2e|--all-coverage] [test-runner arguments...]

No flag:        run Vitest unit/component tests; no backend is required.
--coverage:     run unit/component tests with coverage in frontend/coverage/unit/.
--e2e:          run Playwright browser tests against an already-running seeded backend.
--all-coverage: run unit coverage, browser coverage, then combine both reports.

Setup: npm --prefix frontend ci
Browser setup: (cd frontend && npx playwright install chromium)
Browser backend: E2E_API_URL defaults to http://localhost:8000.
Use a disposable seeded backend database: browser tests create/edit/delete records.
Allow http://localhost:3011 in the backend's FRONTEND_ORIGIN; Playwright starts Vite there.
E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD default to admin@acme.inc / admin.
E2E_API_MODE=workshop exercises the workshop proxy path; direct is the default.
PLAYWRIGHT_CHROMIUM_EXECUTABLE can select an existing Chromium installation.

Extra arguments go to Vitest, or Playwright for --e2e/--all-coverage.
For example: ./frontend/test.sh --e2e --grep 'reference grids'
Filtered test runs measure only those tests; run all tests for a full baseline.
Combined HTML: frontend/coverage/combined/index.html. No coverage thresholds are enforced.
HELP
  exit 0
fi

case "${1:-}" in
  --coverage)
    shift
    # Unit coverage includes unexecuted application files in its denominator.
    npm run test:coverage -- "$@"
    ;;
  --e2e)
    shift
    # Playwright starts the test frontend; you start/seed its backend separately.
    npm run test:e2e -- "$@"
    ;;
  --all-coverage)
    shift
    # Unit coverage measures helpers/components; browser coverage adds actual
    # user journeys. The existing browser command clears old browser counters
    # so coverage from earlier source versions is not accidentally combined.
    npm run test:coverage
    npm run test:e2e:coverage -- "$@"
    npm run coverage:report
    printf '%s\n' 'Open frontend/coverage/combined/index.html to inspect combined coverage.'
    ;;
  *)
    # Forward test paths/options unchanged. Vitest runs once rather than watching.
    npm test -- "$@"
    ;;
esac
