"""Point d'entrée FastAPI : application, CORS, routers, health check."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.routers import auth, equipment, inventory, prestations, sync, tickets


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(
    title="BPM Log API",
    version="0.1.0",
    description="API offline-first de gestion du parc matériel BPM.",
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.debug else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(equipment.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(prestations.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")

# Service statique des photos de panne (volume bpm_photos).
_photos_dir = Path(settings.photos_dir)
_photos_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/photos", StaticFiles(directory=_photos_dir), name="photos")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db", tags=["health"])
async def health_db() -> dict[str, str]:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
