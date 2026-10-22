#!/usr/bin/env bash
# Run Python tests with your active virtual environment. Install dependencies once:
#   python3 -m pip install -r backend/requirements-dev.txt
# Examples from the repository root:
#   ./backend/test.sh
#   ./backend/test.sh --coverage
#   ./backend/test.sh backend.tests.test_routes
# PYTHON can select another interpreter, e.g. PYTHON=python3.13 ./backend/test.sh.

# Stop on a failed command, an unset variable or a failed command in a pipeline.
set -euo pipefail

# Resolve paths from this file so callers do not need to cd to a particular folder.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Usage: ./backend/test.sh [--coverage] [unittest arguments...]

No arguments: discover and run all backend tests.
--coverage:  also measure lines/branches and write terminal, HTML, JSON and XML reports.
Other arguments go to unittest, e.g. backend.tests.test_routes or -v backend.tests.test_schemas.

Setup: activate your virtual environment and install backend/requirements-dev.txt.
Set TEST_DATABASE_URL to a disposable PostgreSQL database to include integration tests.
Those tests create/drop temporary schemas; the database role needs permission to do so.
Without TEST_DATABASE_URL, PostgreSQL integration tests are skipped.
Optional Terraform tests need Terraform and its providers; they use mocked AWS.

HTML coverage: coverage/backend/html/index.html (relative to the repository root).
Coverage measures executed code; no minimum percentage is enforced.
HELP
  exit 0
fi

python_bin="${PYTHON:-python3}"
measure_coverage=false
if [[ "${1:-}" == "--coverage" ]]; then
  measure_coverage=true
  shift
fi

# TEST_DATABASE_URL is the test connection, independent of the application's
# DATABASE_URL. Never print it: it may contain a password. Each database test
# class isolates its tables in a temporary schema on that connection.
if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  printf '%s\n' 'TEST_DATABASE_URL is unset; PostgreSQL integration tests will be skipped.' >&2
fi

# With no selected test/module, use the same discovery command as CI.
if [[ "$#" -eq 0 ]]; then
  set -- discover -s backend/tests
fi

if [[ "$measure_coverage" == true ]]; then
  # .coveragerc defines the measured files and all report paths. Each run starts
  # a fresh measurement; reports for selected tests cover only that selection.
  "$python_bin" -m coverage run -m unittest "$@"
  "$python_bin" -m coverage report
  "$python_bin" -m coverage html
  "$python_bin" -m coverage json
  "$python_bin" -m coverage xml
  printf '%s\n' 'Open coverage/backend/html/index.html to inspect covered/uncovered lines.'
else
  "$python_bin" -m unittest "$@"
fi
