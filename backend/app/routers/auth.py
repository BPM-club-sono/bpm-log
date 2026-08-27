"""Route d'authentification : profil du membre courant.

Le login, le refresh et WebAuthn sont assurés par authentik (voir
docs/authentik-sso.md). L'API ne fait plus que vérifier l'id_token reçu :
elle n'émet plus aucun token.
"""

from fastapi import APIRouter

from app.deps import CurrentUser
from app.models import Membre
from app.schemas.auth import MembreRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MembreRead)
async def me(user: CurrentUser) -> Membre:
    return user
