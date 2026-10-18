"""Création en série : numérotation des noms."""

import io
import uuid
from pathlib import Path

import pytest
from conftest import make_equipment
from fastapi import HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from starlette.datastructures import Headers

from app.config import settings
from app.models import AllocationPresta, Equipment, Membre, Modele, Prestation
from app.models.enums import TypePrestation
from app.routers.equipment import (
    apercu_noms_serie,
    create_equipment,
    creer_equipements,
    creer_serie,
    lire_photo,
)
from app.routers.prestations import creer_et_allouer
from app.schemas.equipment import EquipmentCreate
from app.schemas.prestation import EquipmentCreatePresta
from app.services.serie import noms_serie, prochain_numero


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


async def _modele(session) -> Modele:
    m = Modele(nom=f"MH-{uuid.uuid4().hex[:6]}")
    session.add(m)
    await session.flush()
    return m


def _upload(data: bytes, content_type: str, filename: str = "photo") -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


def _fichiers_photos() -> set[str]:
    dossier = Path(settings.photos_dir)
    return {f.name for f in dossier.iterdir()} if dossier.exists() else set()


def test_prochain_numero_reprend_apres_le_max():
    assert prochain_numero(["MH 1", "MH 6", "MH 3"], "MH") == 7
    assert prochain_numero([], "MH") == 1


def test_noms_serie_correspondance_exacte():
    assert prochain_numero(["MH", "MH 1a", "MHX 3", "MH 2 bis", "MH (2) 4"], "MH") == 1
    assert prochain_numero(["MH (2) 4"], "MH (2)") == 5


async def test_noms_serie_compte_les_archives(db_session):
    base = f"Base {uuid.uuid4().hex[:6]}"
    await make_equipment(db_session, f"{base} 4", archive=True)
    assert await noms_serie(db_session, f"  {base} ", 2) == [f"{base} 5", f"{base} 6"]


async def test_noms_serie_prend_le_verrou(db_session, monkeypatch):
    requetes: list[str] = []
    execute = db_session.execute

    async def espion(stmt, *a, **kw):
        requetes.append(str(stmt))
        return await execute(stmt, *a, **kw)

    monkeypatch.setattr(db_session, "execute", espion)
    await noms_serie(db_session, f"V {uuid.uuid4().hex[:6]}", 1)
    assert any("pg_advisory_xact_lock" in r for r in requetes)


async def test_noms_serie_base_vide_refusee(db_session, staff):
    with pytest.raises(HTTPException) as exc:
        await apercu_noms_serie(db_session, staff, base="   ", nombre=2)
    assert exc.value.status_code == 422


# --------------------------------------------------------------------------- #
# Création en série
# --------------------------------------------------------------------------- #
async def test_serie_cree_n_fiches_numerotees(db_session, staff):
    m = await _modele(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    eqs = await creer_equipements(
        db_session, EquipmentCreate(nom=base, modele_id=m.id, nombre=3), staff, None
    )
    assert [e.nom for e in eqs] == [f"{base} 1", f"{base} 2", f"{base} 3"]
    assert len({e.barcode_uid for e in eqs}) == 3
    assert all(e.modele_id == m.id for e in eqs)


async def test_serie_n1_garde_le_nom(db_session, staff):
    m = await _modele(db_session)
    eqs = await creer_equipements(
        db_session, EquipmentCreate(nom="Console principale", modele_id=m.id), staff, None
    )
    assert [e.nom for e in eqs] == ["Console principale"]


@pytest.mark.parametrize("nombre", [1, 2])
async def test_serie_nom_vide_refuse(db_session, staff, nombre):
    m = await _modele(db_session)
    with pytest.raises(HTTPException) as exc:
        await creer_equipements(
            db_session, EquipmentCreate(nom="  ", modele_id=m.id, nombre=nombre), staff, None
        )
    assert exc.value.status_code == 422


async def test_serie_refusee_hors_standard(db_session, staff):
    m = await _modele(db_session)
    refusees = [
        EquipmentCreate(nom="Câbles", type="vrac", nombre=2),
        EquipmentCreate(nom="Flight", est_contenant=True, nombre=2),
        EquipmentCreate(nom="Lyre", modele_id=m.id, barcode_uid="BPM-999990", nombre=2),
    ]
    for payload in refusees:
        with pytest.raises(HTTPException) as exc:
            await creer_equipements(db_session, payload, staff, None)
        assert exc.value.status_code == 422


async def test_serie_photo_copiee_par_fiche(db_session, staff):
    m = await _modele(db_session)
    eqs = await creer_equipements(
        db_session,
        EquipmentCreate(nom=f"MH {uuid.uuid4().hex[:6]}", modele_id=m.id, nombre=2),
        staff,
        (b"\xff\xd8jpeg", ".jpg"),
    )
    assert eqs[0].photo_chemin != eqs[1].photo_chemin
    assert all((Path(settings.photos_dir) / e.photo_chemin).exists() for e in eqs)


async def test_serie_echec_supprime_les_photos_ecrites(db_session, staff):
    m = await _modele(db_session)
    avant = _fichiers_photos()
    # Code-barres déjà pris : l'échec survient après l'écriture de la photo.
    pris = await make_equipment(db_session, "Déjà là")
    with pytest.raises(HTTPException) as exc:
        await creer_equipements(
            db_session,
            EquipmentCreate(nom="Doublon", modele_id=m.id, barcode_uid=pris.barcode_uid),
            staff,
            (b"\xff\xd8jpeg", ".jpg"),
        )
    assert exc.value.status_code == 409
    assert _fichiers_photos() == avant


async def test_route_json_refuse_plusieurs_exemplaires(db_session, staff):
    m = await _modele(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    with pytest.raises(HTTPException) as exc:
        payload = EquipmentCreate(nom=base, modele_id=m.id, nombre=2)
        await create_equipment(payload, staff, db_session)
    assert exc.value.status_code == 422
    assert "/equipments/serie" in exc.value.detail
    crees = await db_session.scalars(select(Equipment).where(Equipment.nom.startswith(base)))
    assert crees.all() == []


async def test_lire_photo_valide_le_format():
    assert await lire_photo(None) is None
    assert await lire_photo(_upload(b"\x89PNG", "image/png")) == (b"\x89PNG", ".png")
    with pytest.raises(HTTPException) as exc:
        await lire_photo(_upload(b"x", "text/plain"))
    assert exc.value.status_code == 415


async def test_route_serie_cree_les_fiches(db_session, staff):
    m = await _modele(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    donnees = EquipmentCreate(nom=base, modele_id=m.id, nombre=2).model_dump_json()
    res = await creer_serie(staff, db_session, donnees, _upload(b"\xff\xd8", "image/jpeg"))
    assert res.noms == [f"{base} 1", f"{base} 2"]
    assert res.modele_id == m.id
    eqs = [await db_session.get(Equipment, i) for i in res.ids]
    assert [e.nom for e in eqs] == res.noms
    assert eqs[0].photo_chemin != eqs[1].photo_chemin


async def test_route_serie_donnees_invalides(db_session, staff):
    with pytest.raises(RequestValidationError):
        await creer_serie(staff, db_session, '{"nombre": 0}', None)


async def test_serie_photo_invalide_ne_cree_rien(db_session, staff):
    m = await _modele(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    avant = _fichiers_photos()
    donnees = EquipmentCreate(nom=base, modele_id=m.id, nombre=2).model_dump_json()
    with pytest.raises(HTTPException) as exc:
        await creer_serie(staff, db_session, donnees, _upload(b"x", "text/plain"))
    assert exc.value.status_code == 415
    crees = await db_session.scalars(select(Equipment).where(Equipment.nom.startswith(base)))
    assert crees.all() == []
    assert _fichiers_photos() == avant


async def _presta(session) -> Prestation:
    p = Prestation(nom="Presta série", type=TypePrestation.INTERNE)
    session.add(p)
    await session.flush()
    return p


async def _allocations(session, presta) -> list[AllocationPresta]:
    res = await session.scalars(
        select(AllocationPresta)
        .where(AllocationPresta.presta_id == presta.id)
        .order_by(AllocationPresta.equipment_id)
    )
    return list(res.all())


async def test_presta_cree_et_alloue_chaque_exemplaire(db_session, staff):
    m = await _modele(db_session)
    presta = await _presta(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    donnees = EquipmentCreatePresta(nom=base, modele_id=m.id, nombre=3).model_dump_json()
    res = await creer_et_allouer(presta.id, staff, db_session, donnees, None)
    allocs = await _allocations(db_session, presta)
    assert [a.equipment_id for a in allocs] == sorted(res.ids)
    assert len(res.ids) == 3
    assert {a.quantite for a in allocs} == {1}


async def test_presta_vrac_quantite_allouee(db_session, staff):
    presta = await _presta(db_session)
    nom = f"Vrac {uuid.uuid4().hex[:6]}"
    donnees = EquipmentCreatePresta(
        nom=nom, type="vrac", quantite_theorique=50, quantite_allouee=12
    ).model_dump_json()
    res = await creer_et_allouer(presta.id, staff, db_session, donnees, None)
    allocs = await _allocations(db_session, presta)
    assert len(res.ids) == 1
    assert [(a.equipment_id, a.quantite) for a in allocs] == [(res.ids[0], 12)]


async def test_presta_unitaire_quantite_allouee_refusee(db_session, staff):
    m = await _modele(db_session)
    presta = await _presta(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    donnees = EquipmentCreatePresta(
        nom=base, modele_id=m.id, quantite_allouee=2
    ).model_dump_json()
    with pytest.raises(HTTPException) as exc:
        await creer_et_allouer(presta.id, staff, db_session, donnees, None)
    assert exc.value.status_code == 422
    crees = await db_session.scalars(select(Equipment).where(Equipment.nom.startswith(base)))
    assert crees.all() == []
    assert await _allocations(db_session, presta) == []
