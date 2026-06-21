"""Avancement agrégé des prestations aperçu (dashboard) : logique prep_inclus.

Pour une presta INTERNE, seul le matériel loué (présent dans
`equipments_location`) contribue aux quantités prévue/sortie/retournée.
Le matériel BPM interne est compté dans `nb_objets` mais exclu de l'avancement.

Session non commitée (rollback en teardown).
"""

import uuid

from app.models import (
    AllocationPresta,
    Equipment,
    EquipmentLocation,
    Fournisseur,
    InventaireVrac,
    Prestation,
)
from app.models.enums import StatutPrestation, TypePrestation
from app.routers.dashboard import _prestations_apercu


async def _clear_prestations(session) -> None:
    from sqlalchemy import delete, update

    await session.execute(update(InventaireVrac).values(presta_id=None))
    await session.execute(delete(AllocationPresta))
    await session.execute(delete(Prestation))
    await session.flush()


async def _mk_eq(session, nom: str) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom)
    session.add(eq)
    await session.flush()
    return eq


async def _mk_loue(session, nom: str) -> Equipment:
    eq = await _mk_eq(session, nom)
    fournisseur = Fournisseur(nom="Fournisseur-test")
    session.add(fournisseur)
    await session.flush()
    session.add(EquipmentLocation(equipment_id=eq.id, fournisseur_id=fournisseur.id))
    await session.flush()
    return eq


# --- prep_inclus : matériel interne exclu des quantités ----------------------


async def test_apercu_interne_seul_materiel_interne_quantites_nulles(db_session):
    """Presta INTERNE avec uniquement du matériel BPM interne.

    Les quantités prévue/sortie/retournée doivent être 0 car le matériel
    interne est exclu de l'avancement, mais nb_objets doit refléter l'allocation.
    """
    s = db_session
    await _clear_prestations(s)

    presta = Prestation(nom="Sono Interne", type=TypePrestation.INTERNE,
                        statut=StatutPrestation.EN_PREPARATION)
    s.add(presta)
    await s.flush()

    eq_interne = await _mk_eq(s, "Enceinte BPM")
    s.add(AllocationPresta(
        presta_id=presta.id,
        equipment_id=eq_interne.id,
        quantite=3,
        quantite_sortie=2,
        quantite_retournee=1,
    ))
    await s.flush()

    apercus = await _prestations_apercu(s)

    assert len(apercus) == 1
    ap = apercus[0]
    assert ap.id == presta.id
    assert ap.nb_objets == 1  # allocation comptée
    assert ap.qte_prevue == 0  # matériel interne exclu
    assert ap.qte_sortie == 0
    assert ap.qte_retournee == 0


async def test_apercu_interne_mixte_seul_loue_contribue(db_session):
    """Presta INTERNE avec matériel mixte interne + loué.

    Seules les lignes louées doivent contribuer aux quantités ; le matériel
    interne est compté dans nb_objets mais pas dans les totaux d'avancement.
    """
    s = db_session
    await _clear_prestations(s)

    presta = Prestation(nom="Sono Mixte", type=TypePrestation.INTERNE,
                        statut=StatutPrestation.EN_PREPARATION)
    s.add(presta)
    await s.flush()

    eq_interne = await _mk_eq(s, "Enceinte BPM")
    eq_loue = await _mk_loue(s, "Enceinte louée")

    s.add(AllocationPresta(
        presta_id=presta.id,
        equipment_id=eq_interne.id,
        quantite=5,
        quantite_sortie=3,
        quantite_retournee=1,
    ))
    s.add(AllocationPresta(
        presta_id=presta.id,
        equipment_id=eq_loue.id,
        quantite=2,
        quantite_sortie=2,
        quantite_retournee=0,
    ))
    await s.flush()

    apercus = await _prestations_apercu(s)

    assert len(apercus) == 1
    ap = apercus[0]
    assert ap.id == presta.id
    assert ap.nb_objets == 2  # les deux allocations comptées
    assert ap.qte_prevue == 2  # uniquement le loué
    assert ap.qte_sortie == 2
    assert ap.qte_retournee == 0
