"""Configuration de l'application via variables d'environnement (Pydantic Settings)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Base de données
    database_url: str = "postgresql+asyncpg://bpm:bpm@localhost:5432/bpm_log"

    # Application
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:5173"]

    # OIDC (authentik) — seule source d'authentification.
    # Le backend ne signe plus aucun token : il vérifie ceux d'authentik via JWKS.
    oidc_issuer: str = "https://auth.bpmclubsono.com/application/o/bpm-log/"
    oidc_client_id: str = ""
    oidc_jwks_url: str = "https://auth.bpmclubsono.com/application/o/bpm-log/jwks/"
    oidc_jwks_cache_seconds: int = 3600

    # Web-Push
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:contact@bpm.example"

    # Stockage photos
    photos_dir: str = "/var/bpm/photos"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
