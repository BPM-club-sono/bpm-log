"""Format des références matériel (le contenu des QR codes).

Contrainte physique, d'où tout le reste découle : les étiquettes partent en
tournée sur du matériel qui prend la poussière et les chocs, donc les QR sont
générés en correction d'erreur **H** (~30 % de récupération) ; et pour que le
symbole ne grossisse pas, on veut rester en **version 1** (21×21 modules).

Un QR v1 en correction H tient exactement **10 caractères** en mode
alphanumérique. Le mode alphanumérique QR n'accepte que ``0-9 A-Z espace
$ % * + - . / :`` — **toute minuscule fait basculer le symbole en mode Byte et
force la version 2**. D'où le format :

    PPP-NNNNNN        exactement 10 caractères, majuscules obligatoires

``PPP`` identifie le propriétaire (``BPM`` pour le parc interne, le trigramme
du fournisseur pour du matériel loué) et ``NNNNNN`` est l'id de l'équipement.

Attention : le préfixe est figé à la création, parce qu'il est imprimé sur une
étiquette physique. Ce n'est **pas** un indicateur fiable du propriétaire
actuel — un matériel loué puis racheté garde son trigramme d'origine. La seule
source de vérité reste ``EquipmentLocation``.
"""

from __future__ import annotations

import re
import unicodedata

#: Trigramme du parc interne.
PREFIXE_INTERNE = "BPM"
#: Repli pour du matériel loué chez un fournisseur sans trigramme.
PREFIXE_EXTERNE = "EXT"
#: Réservé aux fixtures de test.
PREFIXE_TEST = "TST"

#: Trigrammes qu'un fournisseur ne peut pas s'attribuer.
PREFIXES_RESERVES = frozenset({PREFIXE_INTERNE, PREFIXE_EXTERNE, PREFIXE_TEST})

#: Le format complet d'une référence.
FORMAT_REFERENCE = r"^[A-Z]{3}-[0-9]{6}$"
#: Le format d'un trigramme seul.
FORMAT_TRIGRAMME = r"^[A-Z]{3}$"

_RE_REFERENCE = re.compile(FORMAT_REFERENCE)
_RE_TRIGRAMME = re.compile(FORMAT_TRIGRAMME)

#: Au-delà, le numéro ne tient plus sur 6 chiffres.
NUMERO_MAX = 999_999


def construire(prefixe: str, numero: int) -> str:
    """Assemble une référence. Lève `ValueError` si elle ne tiendrait pas."""
    if not _RE_TRIGRAMME.match(prefixe):
        raise ValueError(f"Trigramme invalide : {prefixe!r} (attendu : 3 lettres majuscules).")
    if not 0 <= numero <= NUMERO_MAX:
        raise ValueError(f"Numéro hors plage : {numero} (maximum {NUMERO_MAX}).")
    return f"{prefixe}-{numero:06d}"


def normaliser(code: str) -> str:
    """Met une saisie en forme canonique : sans espaces superflus, en majuscules.

    Toutes les résolutions d'équipement par code passent par ici — une douchette,
    une saisie au clavier et un QR décodé doivent aboutir au même résultat.
    """
    return code.strip().upper()


def est_conforme(code: str) -> bool:
    return bool(_RE_REFERENCE.match(code))


def deriver_trigramme(nom: str) -> str | None:
    """Propose un trigramme à partir d'un nom de fournisseur.

    Les 3 premières lettres, accents retirés (« Événement Loc » → ``EVE``). Un
    nom trop court est complété par des ``X``. Renvoie `None` si le nom ne
    contient aucune lettre, ou si le trigramme obtenu est réservé — à charge de
    l'appelant de laisser l'admin trancher, plutôt que de fabriquer un code
    dérivé que personne ne saurait dicter au téléphone.
    """
    sans_accents = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    lettres = "".join(c for c in sans_accents if c.isalpha()).upper()
    if not lettres:
        return None
    candidat = lettres[:3].ljust(3, "X")
    return None if candidat in PREFIXES_RESERVES else candidat
