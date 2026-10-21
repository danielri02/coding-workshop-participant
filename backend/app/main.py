"""FastAPI application and database-pool lifecycle."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.database.session import engine
from backend.app.routes import (
    auth,
    buildings,
    engineer_profiles,
    floors,
    incidents,
    notes,
    seats,
    users,
)
from backend.app.routes.health import router as health_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Dispose pooled database connections when the application shuts down."""

    try:
        yield
    finally:
        await engine.dispose()


app = FastAPI(title="Coding Workshop", lifespan=lifespan)

app.include_router(health_router)

for api_router in (
    auth.router,
    users.router,
    engineer_profiles.router,
    buildings.router,
    floors.router,
    seats.router,
    incidents.router,
    notes.router,
):
    app.include_router(api_router)
