"""FastAPI application and database-pool lifecycle."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database.session import engine
from .errors import ErrorResponseMiddleware
from .routes import (
    auth,
    buildings,
    deletions,
    dev,
    engineer_profiles,
    floors,
    incidents,
    notes,
    reports,
    seats,
    tickets,
    users,
)
from .routes.health import router as health_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Dispose pooled database connections when the application shuts down."""

    try:
        yield
    finally:
        await engine.dispose()


app = FastAPI(title="Coding Workshop", lifespan=lifespan)
app.add_middleware(ErrorResponseMiddleware)
# CORS wraps the error boundary, including sanitized unexpected-error responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
)

app.include_router(health_router)

for api_router in (
    auth.router,
    users.router,
    engineer_profiles.router,
    buildings.router,
    floors.router,
    seats.router,
    incidents.router,
    tickets.router,
    notes.router,
    reports.router,
    dev.router,
    deletions.router,
):
    app.include_router(api_router)
