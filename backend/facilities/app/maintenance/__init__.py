"""Shared database operations for CLI scripts and the key-protected setup API."""

# Serialize create/reset/seed transactions across both execution paths.
SETUP_LOCK_ID = 716043921
