"""Contrôle d'accès basé sur les rôles (RBAC)."""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.deps import CurrentUser
from app.models.enums import RoleMembre


def require_role(*roles: RoleMembre) -> Callable:
    """Dépendance FastAPI : exige que l'utilisateur courant ait l'un des rôles donnés.

    Admin a implicitement accès à tout.
    """
    allowed = set(roles) | {RoleMembre.ADMIN}

    async def _checker(user: CurrentUser) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Rôle insuffisant pour cette action.",
            )
        return user

    return _checker


# Raccourcis prêts à l'emploi
RequireAdmin = Annotated[CurrentUser, Depends(require_role(RoleMembre.ADMIN))]
RequireStaff = Annotated[CurrentUser, Depends(require_role(RoleMembre.STAFF))]
RequireTech = Annotated[CurrentUser, Depends(require_role(RoleMembre.TECH))]
