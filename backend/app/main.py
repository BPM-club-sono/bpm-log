from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.routers import equipment, sync

# Cycle de vie de l'application (Lifespan) pour initialiser la BDD asynchrone
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Création automatique des tables dans PostgreSQL au démarrage
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Nettoyage à la fermeture (optionnel)
    await engine.dispose()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API de gestion de parc matériel et logistique offline-first pour l'association BPM",
    version="1.0.0",
    lifespan=lifespan
)

# Configuration de CORS pour autoriser le frontend (React SPA) à requêter l'API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Dans un environnement de prod, restreindre à l'origine du frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusion des routeurs modulaires
app.include_router(equipment.router, prefix=settings.API_V1_STR)
app.include_router(sync.router, prefix=settings.API_V1_STR)

@app.get("/")
async def root():
    return {
        "message": "Bienvenue sur l'API de logistique BPM-Log !",
        "docs_url": "/docs",
        "status": "online"
    }

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "connected"
    }
