"""Vérification des id_token OIDC émis par authentik.

Les tokens sont signés en RS256 : le backend ne connaît que la clé *publique*,
téléchargée depuis le JWKS d'authentik et gardée en cache. Aucun appel réseau
n'est fait à chaque requête.
"""

import time
from typing import Any

import httpx
from jose import JWTError, jwt

from app.config import settings

_jwks_cache: dict[str, Any] | None = None
_jwks_fetched_at: float = 0.0


async def _fetch_jwks() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(settings.oidc_jwks_url)
        response.raise_for_status()
    return response.json()


async def _get_jwks(*, force_refresh: bool = False) -> dict[str, Any]:
    global _jwks_cache, _jwks_fetched_at

    fresh = time.monotonic() - _jwks_fetched_at < settings.oidc_jwks_cache_seconds
    if _jwks_cache is not None and fresh and not force_refresh:
        return _jwks_cache

    _jwks_cache = await _fetch_jwks()
    _jwks_fetched_at = time.monotonic()
    return _jwks_cache


def _decode(token: str, jwks: dict[str, Any]) -> dict[str, Any]:
    return jwt.decode(
        token,
        jwks,
        algorithms=["RS256"],
        audience=settings.oidc_client_id,
        issuer=settings.oidc_issuer,
    )


async def decode_oidc_token(token: str) -> dict[str, Any] | None:
    """Retourne les claims si le token est valide, None sinon.

    Vérifie d'un coup la signature, `iss`, `aud` et `exp` — les quatre sont
    nécessaires : sans `aud`, un token émis pour une autre application du même
    authentik serait accepté.
    """
    try:
        jwks = await _get_jwks()
    except httpx.HTTPError:
        return None

    try:
        return _decode(token, jwks)
    except JWTError:
        pass

    # Échec possible après une rotation de clé côté authentik : on retente une
    # fois avec un JWKS frais avant de rejeter.
    try:
        return _decode(token, await _get_jwks(force_refresh=True))
    except (JWTError, httpx.HTTPError):
        return None
