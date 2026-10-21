"""Run maintenance commands with python -m backend.scripts.<module> from repo root."""

# Serialize create/reset/seed transactions against other invocations of these scripts.
SETUP_LOCK_ID = 716043921
