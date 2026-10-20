
from fastapi import FastAPI

app = FastAPI(
    title="Coding Workshop"
)

@app.get("/health")
async def health_check():
    return {"status":"ok"}

