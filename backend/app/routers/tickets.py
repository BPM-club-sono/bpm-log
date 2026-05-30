"""Routes tickets de réparation : upload des photos (après sync du ticket)."""

import uuid as uuid_lib
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import PhotoPanne, TicketReparation
from app.schemas.ticket import PhotoRead

router = APIRouter(prefix="/tickets", tags=["tickets"])

_ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_BYTES = 8 * 1024 * 1024  # 8 Mo


@router.post(
    "/photos",
    response_model=PhotoRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_photo(
    user: CurrentUser,
    db: DbSession,
    uuid_client: str = Form(...),
    file: UploadFile = File(...),
) -> PhotoPanne:
    """Attache une photo à un ticket déjà synchronisé (identifié par uuid_client)."""
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format image non supporté (jpeg, png, webp).",
        )

    ticket = await db.scalar(
        select(TicketReparation).where(TicketReparation.uuid_client == uuid_client)
    )
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket non synchronisé : réessaie après synchronisation.",
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image trop volumineuse (max 8 Mo).",
        )

    photos_dir = Path(settings.photos_dir)
    photos_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid_lib.uuid4().hex}{ext}"
    (photos_dir / filename).write_bytes(data)

    photo = PhotoPanne(
        ticket_id=ticket.id,
        membre_id=user.id,
        chemin=filename,
    )
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return photo
