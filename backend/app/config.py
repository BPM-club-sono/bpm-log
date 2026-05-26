import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "BPM-Log API"
    API_V1_STR: str = "/api"
    
    # Par défaut, SQLite en local pour le développement zéro-config.
    # Sera écrasé par PostgreSQL dans le fichier .env en production.
    DATABASE_URL: str = "sqlite+aiosqlite:///./bpm_log.db"
    
    # Configuration Pydantic Settings pour lire le fichier .env si présent
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
