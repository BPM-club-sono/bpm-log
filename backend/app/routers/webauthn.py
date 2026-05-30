"""Routes WebAuthn / Passkey : enregistrement et connexion sans mot de passe.

Le challenge est transporté entre les étapes « begin » et « complete » via un
token JWT court (state), ce qui évite tout état serveur partagé.
"""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import Membre, WebauthnCredential
from app.schemas.auth import TokenPair
from app.schemas.webauthn import (
    LoginBegin,
    LoginComplete,
    PasskeyRead,
    RegisterComplete,
    WebauthnOptions,
)
from app.security.jwt import (
    create_access_token,
    create_refresh_token,
    create_webauthn_state,
    decode_token,
)

router = APIRouter(prefix="/auth/webauthn", tags=["webauthn"])

_REGISTER_PURPOSE = "wa_register"
_LOGIN_PURPOSE = "wa_login"


def _decode_state(state: str, purpose: str) -> dict:
    data = decode_token(state)
    if data is None or data.get("type") != purpose or "challenge" not in data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session WebAuthn expirée ou invalide.",
        )
    return data


# --- Enregistrement d'une Passkey (utilisateur authentifié) -----------------


@router.post("/register/begin", response_model=WebauthnOptions)
async def register_begin(user: CurrentUser, db: DbSession) -> WebauthnOptions:
    existing = (
        await db.scalars(
            select(WebauthnCredential).where(WebauthnCredential.membre_id == user.id)
        )
    ).all()

    options = generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.webauthn_rp_name,
        user_id=str(user.id).encode(),
        user_name=user.email,
        user_display_name=" ".join(p for p in [user.prenom, user.nom] if p) or user.email,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=c.credential_id) for c in existing
        ],
    )

    state = create_webauthn_state(
        user.id, bytes_to_base64url(options.challenge), _REGISTER_PURPOSE
    )
    return WebauthnOptions(options=json.loads(options_to_json(options)), state=state)


@router.post("/register/complete", response_model=PasskeyRead, status_code=201)
async def register_complete(
    payload: RegisterComplete, user: CurrentUser, db: DbSession
) -> WebauthnCredential:
    data = _decode_state(payload.state, _REGISTER_PURPOSE)
    if int(data["sub"]) != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="State invalide.")

    try:
        verified = verify_registration_response(
            credential=json.dumps(payload.credential),
            expected_challenge=base64url_to_bytes(data["challenge"]),
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
        )
    except Exception as exc:  # noqa: BLE001 - lib lève des exceptions variées
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Échec de la vérification de la Passkey.",
        ) from exc

    duplicate = await db.scalar(
        select(WebauthnCredential).where(
            WebauthnCredential.credential_id == verified.credential_id
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cette Passkey est déjà enregistrée.",
        )

    credential = WebauthnCredential(
        membre_id=user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        device_name=(payload.device_name or "").strip() or None,
    )
    db.add(credential)
    await db.commit()
    await db.refresh(credential)
    return credential


# --- Connexion par Passkey (non authentifié) --------------------------------


@router.post("/login/begin", response_model=WebauthnOptions)
async def login_begin(payload: LoginBegin, db: DbSession) -> WebauthnOptions:
    membre = await db.scalar(select(Membre).where(Membre.email == payload.email))
    creds = (
        (
            await db.scalars(
                select(WebauthnCredential).where(
                    WebauthnCredential.membre_id == membre.id
                )
            )
        ).all()
        if membre is not None
        else []
    )
    if not membre or not creds:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucune Passkey pour ce compte.",
        )

    options = generate_authentication_options(
        rp_id=settings.webauthn_rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=c.credential_id) for c in creds
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    state = create_webauthn_state(
        membre.id, bytes_to_base64url(options.challenge), _LOGIN_PURPOSE
    )
    return WebauthnOptions(options=json.loads(options_to_json(options)), state=state)


@router.post("/login/complete", response_model=TokenPair)
async def login_complete(payload: LoginComplete, db: DbSession) -> TokenPair:
    data = _decode_state(payload.state, _LOGIN_PURPOSE)
    membre = await db.get(Membre, int(data["sub"]))
    if membre is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membre introuvable.")

    raw_id = payload.credential.get("rawId") or payload.credential.get("id")
    if not raw_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credential invalide.")
    credential_id = base64url_to_bytes(raw_id)

    stored = await db.scalar(
        select(WebauthnCredential).where(
            WebauthnCredential.membre_id == membre.id,
            WebauthnCredential.credential_id == credential_id,
        )
    )
    if stored is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey inconnue.")

    try:
        verified = verify_authentication_response(
            credential=json.dumps(payload.credential),
            expected_challenge=base64url_to_bytes(data["challenge"]),
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            credential_public_key=stored.public_key,
            credential_current_sign_count=stored.sign_count,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Échec de l'authentification par Passkey.",
        ) from exc

    stored.sign_count = verified.new_sign_count
    await db.commit()

    return TokenPair(
        access_token=create_access_token(membre.id, membre.role.value),
        refresh_token=create_refresh_token(membre.id),
    )


# --- Gestion des Passkeys de l'utilisateur ----------------------------------


@router.get("/credentials", response_model=list[PasskeyRead])
async def list_credentials(user: CurrentUser, db: DbSession) -> list[WebauthnCredential]:
    return list(
        (
            await db.scalars(
                select(WebauthnCredential)
                .where(WebauthnCredential.membre_id == user.id)
                .order_by(WebauthnCredential.created_at.desc())
            )
        ).all()
    )


@router.delete("/credentials/{credential_pk}", status_code=204)
async def delete_credential(
    credential_pk: int, user: CurrentUser, db: DbSession
) -> None:
    cred = await db.get(WebauthnCredential, credential_pk)
    if cred is None or cred.membre_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey introuvable.")
    await db.delete(cred)
    await db.commit()
