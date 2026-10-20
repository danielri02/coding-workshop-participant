
from fastapi import FastAPI

from backend.app.routes.health import router as health_router

app = FastAPI(
    title="Coding Workshop"
)

app.include_router(health_router)

