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

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    # WebAuthn
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "BPM Log"
    webauthn_origin: list[str] = ["http://localhost", "http://localhost:5173"]

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

    @field_validator("webauthn_origin", mode="before")
    @classmethod
    def split_webauthn_origin(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return value  # JSON list, parsé par pydantic
            return [o.strip() for o in value.split(",") if o.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
