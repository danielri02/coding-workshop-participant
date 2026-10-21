"""Incident management application package for FastAPI and Uvicorn entry points."""

# Initialize environment settings before database, authentication or route imports.
from .config import ENVIRONMENT_FILE as ENVIRONMENT_FILE
