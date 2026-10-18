# Création en série et allocation unitaire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une fiche = un objet physique : le formulaire crée N exemplaires d'un modèle (Parc et prestation), une allocation d'item unitaire vaut toujours 1, et une prestation clôturée archive en lot ses locations rendues.

**Architecture:** Côté serveur, une fonction `creer_equipements` (sans commit) crée les N fiches avec numérotation sérialisée et copies de photo ; deux routes multipart l'exposent (Parc ; prestation = création + allocation dans la même transaction). Le tri des locations rendues vit dans un service dédié, l'archivage réutilise la cascade existante déplacée dans `services/contenants.py`. Côté client, `EquipmentForm` gagne « Nombre d'exemplaires » et n'envoie plus qu'une requête multipart.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, PostgreSQL, pytest ; React 18 + TypeScript, Vite PWA, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-creation-en-serie-design.md`

## Global Constraints

- Code, routes, libellés UI et messages d'erreur en français (cf. `CLAUDE.md`).
- Création et allocations : en ligne uniquement, aucune nouvelle entrée dans la file de sync.
- « Nombre d'exemplaires » : défaut 1, minimum 1, **pas de maximum**. Uniquement type Standard non-flight.
- N = 1 : nom utilisé tel quel. N > 1 : noms `« <base> <n> »`, `n` reprend après le plus grand numéro existant (archivés compris), correspondance exacte `<base>` + espace + entier.
- N > 1 : code-barres personnalisé refusé (422) et masqué dans l'UI.
- Création en série tout ou rien, photo comprise ; chaque fiche a **sa propre copie** du fichier photo.
- Allocation d'un item unitaire (ni vrac ni consommable) : quantité 1, sinon 422.
- Libellés exacts : « Nombre d'exemplaires », « Nom de base », « Archiver les locations rendues (N) », toast Parc « N équipements créés ».
- Règles d'allocation (blocage, chevauchement) : réutiliser `app/services/disponibilite.py`, ne pas dupliquer.
- Pas de changement de schéma attendu : `MCD.dbml` intouché sauf si un task en introduit un.
- Toute modif frontend de parcours → test e2e (`frontend/e2e/`), lancé avec `npm run e2e`.

## Review Focus

1. Nom de base avec caractères spéciaux ou espaces de bord (« MH (2) », « MH  ») : la base est `strip()`ée, et seuls les noms exactement `<base> <entier>` comptent — « MH 1a », « MHX 3 », « MH » seul sont ignorés. → Task 2, `test_noms_serie_correspondance_exacte`.
2. Photo invalide (type ou taille) avec N > 1 : aucune fiche créée, aucun fichier laissé sur disque. → Task 3, `test_serie_photo_invalide_ne_cree_rien`.
3. Deux séries simultanées sur la même base : jamais deux « MH 7 » (verrou consultatif dans `noms_serie`). → Task 2, `test_noms_serie_prend_le_verrou` (vérifie l'appel du verrou ; la course réelle n'est pas reproductible en test).
4. Flight loué contenant du matériel BPM ou une location non rendue : le flight entier est gardé avec la raison « contenu du flight non rendu ». → Task 5, `test_flight_loue_garde_si_contenu_non_rendu`.
5. Double clic sur « Créer » : le bouton est en `loading` pendant la requête, une seule série créée. → Task 6, état `saving` déjà en place, vérifié dans l'e2e (un seul clic attendu, compte exact des fiches).

---

### Task 1: Allocation d'un item unitaire = quantité 1

**Files:**
- Modify: `backend/app/routers/prestations.py` (`add_allocation`)
- Test: `backend/tests/test_allocation_unitaire.py`

**Interfaces:**
- Consumes: `_ids_quantitatifs(db, ids) -> set[int]` (existant, `prestations.py`).
- Produces: règle « 422 si `quantite > 1` sur item unitaire », sur création **et** mise à jour d'une allocation existante.

- [ ] **Step 1: Write the failing tests**

```python
async def test_unitaire_refuse_quantite_superieure_a_1(db_session, staff):
    eq = await make_equipment(db_session, "Lyre")
    p = await _presta(db_session)
    with pytest.raises(HTTPException) as exc:
        await add_allocation(p.id, AllocationCreate(equipment_id=eq.id, quantite=2), db_session, staff)
    assert exc.value.status_code == 422

async def test_vrac_accepte_quantite(db_session, staff):
    caisse = await make_equipment(db_session, "XLR")
    db_session.add(EquipmentVrac(equipment_id=caisse.id, quantite_theorique=20))
    await db_session.flush()
    p = await _presta(db_session)
    res = await add_allocation(p.id, AllocationCreate(equipment_id=caisse.id, quantite=8), db_session, staff)
    assert res.quantite == 8
```

(`staff` / `_presta` : mêmes helpers que `tests/test_modeles.py`, recopiés localement.)

- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_allocation_unitaire.py -v` — Expected: first test FAIL (no exception).
- [ ] **Step 3: Implement** dans `add_allocation`, avant toute écriture : si `data.quantite > 1` et l'équipement n'est pas dans `_ids_quantitatifs` → `HTTPException(422, "Un équipement unitaire s'alloue à l'unité : crée plusieurs exemplaires.")`.
- [ ] **Step 4: Run** `../.venv/bin/pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(backend): allocation unitaire limitée à une quantité de 1`

---

### Task 2: Numérotation des séries

**Files:**
- Create: `backend/app/services/serie.py`
- Modify: `backend/app/routers/equipment.py` (route d'aperçu)
- Test: `backend/tests/test_creation_serie.py`

**Interfaces:**
- Produces:
  - `def prochain_numero(noms: Iterable[str], base: str) -> int` — pur : 1 + max des `n` pour les noms exactement `f"{base} {n}"` (`n` entier ≥ 0, chiffres seulement), 1 si aucun.
  - `async def noms_serie(db: DbSession, base: str, nombre: int) -> list[str]` — `base = base.strip()`, prend `pg_advisory_xact_lock(4202, hashtext(:base))`, lit les noms `Equipment.nom.startswith(base + " ")` (archivés compris), renvoie `[f"{base} {k}" for k in range(n0, n0 + nombre)]`.
  - Route `GET /equipments/noms-serie?base=<str>&nombre=<int ≥1>` → `list[str]` (CurrentUser), **déclarée avant** `GET /equipments/{equipment_id}`.

- [ ] **Step 1: Write the failing tests**

```python
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
    # espionne db.execute : un appel contient "pg_advisory_xact_lock"
```

- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_creation_serie.py -v` — Expected: FAIL (import error).
- [ ] **Step 3: Implement** `services/serie.py` and the preview route.
- [ ] **Step 4: Run** `../.venv/bin/pytest tests/test_creation_serie.py -v` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): numérotation des créations en série`

---

### Task 3: Création en série depuis le Parc (multipart, photo copiée)

**Files:**
- Modify: `backend/app/schemas/equipment.py`, `backend/app/routers/equipment.py`
- Test: `backend/tests/test_creation_serie.py`

**Interfaces:**
- Consumes: `noms_serie` (Task 2).
- Produces:
  - `EquipmentCreate.nombre: int = Field(default=1, ge=1)`.
  - `class SerieCreee(BaseModel): ids: list[int]; noms: list[str]; modele_id: int | None`.
  - `async def lire_photo(file: UploadFile | None) -> tuple[bytes, str] | None` — validation actuelle de `upload_equipment_photo` (types `_ALLOWED_TYPES`, `_MAX_BYTES`, 415/413) extraite ; `upload_equipment_photo` la réutilise.
  - `def ecrire_photo(data: bytes, ext: str) -> str` — écrit `uuid.hex + ext` dans `settings.photos_dir`, renvoie le nom.
  - `async def creer_equipements(db: DbSession, payload: EquipmentCreate, user: Membre, photo: tuple[bytes, str] | None) -> list[Equipment]` — **ne commit pas**. Corps actuel de `create_equipment` déplacé ici et bouclé `payload.nombre` fois ; validations faites une fois avant la boucle (fournisseur résolu une fois) ; N > 1 refusé (422) si `type != "standard"` ou `est_contenant` ou `barcode_uid` fourni ; noms = `[payload.nom]` si N = 1, sinon `noms_serie(db, payload.nom, N)` ; une copie photo par fiche (`ecrire_photo`) ; en cas d'exception, les fichiers déjà écrits sont supprimés puis l'exception relancée.
  - `create_equipment` (JSON, existant) devient : `creer_equipements(..., photo=None)` + commit + `_build_detail` du premier (comportement inchangé pour N = 1).
  - Route `POST /equipments/serie` (RequireStaff), multipart : `donnees: str = Form(...)` (JSON de `EquipmentCreate`, validé par `EquipmentCreate.model_validate_json`, 422 sinon), `photo: UploadFile | None = File(None)` → `SerieCreee`, status 201. Photo lue (`lire_photo`) **avant** toute écriture en base.

- [ ] **Step 1: Write the failing tests** (`creer_equipements` appelé en direct, comme les autres tests)

```python
async def test_serie_cree_n_fiches_numerotees(db_session, staff):
    m = await _modele(db_session)
    base = f"MH {uuid.uuid4().hex[:6]}"
    eqs = await creer_equipements(db_session, EquipmentCreate(nom=base, modele_id=m.id, nombre=3), staff, None)
    assert [e.nom for e in eqs] == [f"{base} 1", f"{base} 2", f"{base} 3"]
    assert len({e.barcode_uid for e in eqs}) == 3

async def test_serie_n1_garde_le_nom(db_session, staff): ...   # nom == "Console principale"

async def test_serie_refusee_hors_standard(db_session, staff):
    # nombre=2 avec type="vrac", est_contenant=True, ou barcode_uid fourni → 422 chacun

async def test_serie_photo_copiee_par_fiche(db_session, staff):
    eqs = await creer_equipements(..., nombre=2, photo=(b"\xff\xd8jpeg", ".jpg"))
    assert eqs[0].photo_chemin != eqs[1].photo_chemin
    assert all((Path(settings.photos_dir) / e.photo_chemin).exists() for e in eqs)

async def test_serie_photo_invalide_ne_cree_rien(client, ...):
    # via la route : photo text/plain → 415, aucune fiche au nom de base, aucun nouveau fichier dans photos_dir
```

Pour le dernier test, passer par `client` (route HTTP) avec un en-tête d'auth : si le projet n'a pas de fixture d'auth HTTP, appeler `lire_photo` sur un `UploadFile` text/plain et vérifier 415 + absence de fiche (la photo est lue avant toute écriture).

- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_creation_serie.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** schemas, helpers, `creer_equipements`, route.
- [ ] **Step 4: Run** `../.venv/bin/pytest -q && ../.venv/bin/ruff check .` — Expected: all pass (dont `test_modeles.py`, inchangé).
- [ ] **Step 5: Commit** `feat(backend): création en série d'équipements avec photo`

---

### Task 4: Créer et allouer depuis une prestation (une transaction)

**Files:**
- Modify: `backend/app/schemas/prestation.py`, `backend/app/routers/prestations.py`
- Test: `backend/tests/test_creation_serie.py`

**Interfaces:**
- Consumes: `creer_equipements`, `lire_photo`, `SerieCreee` (Task 3) ; `_ids_quantitatifs`, `recalculer_statut`.
- Produces:
  - `class EquipmentCreatePresta(EquipmentCreate): quantite_allouee: int = Field(default=1, ge=1)` (dans `schemas/prestation.py`).
  - Route `POST /prestations/{presta_id}/equipements` (RequireStaff), multipart `donnees` (JSON `EquipmentCreatePresta`) + `photo` → `SerieCreee`, 201. Crée via `creer_equipements`, puis une `AllocationPresta(quantite=…, statut=PLANIFIE)` par fiche : `quantite_allouee` pour vrac/consommable, 1 sinon (`quantite_allouee > 1` sur unitaire → 422). `recalculer_statut`, **un seul** commit.

- [ ] **Step 1: Write the failing tests**

```python
async def test_presta_cree_et_alloue_chaque_exemplaire(db_session, staff):
    # nombre=3 → 3 allocations quantite=1 sur la presta, ids == SerieCreee.ids

async def test_presta_vrac_quantite_allouee(db_session, staff):
    # type="vrac", quantite_allouee=12 → 1 allocation quantite=12

async def test_presta_unitaire_quantite_allouee_refusee(db_session, staff):
    # type standard, quantite_allouee=2 → 422 et aucune fiche créée
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the route (factor `donnees` parsing shared with Task 3 as `def lire_donnees(raw: str, schema: type[T]) -> T`).
- [ ] **Step 4: Run** `../.venv/bin/pytest -q` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): créer et allouer N exemplaires depuis une prestation`

---

### Task 5: Archivage en lot des locations rendues

**Files:**
- Modify: `backend/app/services/contenants.py` (reçoit `archiver_cascade`), `backend/app/routers/equipment.py` (l'importe), `backend/app/routers/prestations.py`, `backend/app/schemas/prestation.py`
- Create: `backend/app/services/locations_rendues.py`
- Test: `backend/tests/test_locations_rendues.py`

**Interfaces:**
- Consumes: `disponibilite.STATUTS_BLOQUES`, `contenants.descendant_ids`, `_location_map`.
- Produces:
  - `async def archiver_cascade(db, eq: Equipment, valeur: bool) -> int` — déplacé tel quel de `routers/equipment.py::_archiver_cascade`.
  - `@dataclass class TriLocations: archivables: list[Equipment]; gardes: list[tuple[Equipment, str]]`
  - `async def trier_locations_rendues(db, presta: Prestation) -> TriLocations` — sur les allocations de `presta` dont l'équipement est loué et non archivé. Raison de garde, premier test qui échoue dans cet ordre, libellés exacts :
    1. `decision_cloture` `perdu` → « perdue », `casse` → « cassée », `ouvert` → « en suspens »
    2. `quantite_sortie == 0` → « jamais sortie »
    3. `quantite_retournee < quantite_sortie` → « pas entièrement rendue »
    4. statut dans `STATUTS_BLOQUES` → « hors service »
    5. allocation non `Retourne` sur une autre prestation non `Terminee` → `« prévue sur « <nom> » »`
    6. flight (`est_contenant`) dont un descendant ne passerait pas 1–5 **ou** n'est pas une location de cette prestation → « contenu du flight non rendu »
    Les descendants d'un flight archivable ne sont pas listés à part (la cascade les archive).
  - Schémas : `class LocationRendue(BaseModel): equipment_id: int; nom: str; fournisseur_nom: str | None; raison: str | None` ; `class LocationsRendues(BaseModel): archivables: list[LocationRendue]; gardes: list[LocationRendue]`.
  - `GET /prestations/{id}/locations-rendues` → `LocationsRendues` (CurrentUser).
  - `POST /prestations/{id}/locations-rendues/archivage` (RequireStaff) → `LocationsRendues` où `archivables` = ceux archivés ; 409 « La prestation n'est pas clôturée. » si statut ≠ `Terminee`.

- [ ] **Step 1: Write the failing tests** (fixtures : location = `make_equipment` + `EquipmentLocation`, allocation posée directement avec `quantite_sortie` / `quantite_retournee` / `decision_cloture`, presta `statut=TERMINEE`)

```python
async def test_rendue_archivable(...):            # sortie 1, retournée 1 → archivables
async def test_jamais_sortie_gardee(...):         # sortie 0 → raison "jamais sortie"
async def test_decisions_gardees(...):            # perdu/casse/ouvert → "perdue"/"cassée"/"en suspens"
async def test_hors_service_gardee(...):          # statut En_Panne → "hors service"
async def test_prevue_ailleurs_gardee(...):       # Planifie sur presta non close « Gala » → 'prévue sur « Gala »'
async def test_flight_loue_garde_si_contenu_non_rendu(...):  # flight loué + item BPM dedans → flight gardé, raison "contenu du flight non rendu"
async def test_flight_loue_archive_avec_contenu(...):        # tout rendu → flight et contenu archive=True
async def test_archivage_refuse_si_presta_ouverte(...):      # 409
```

- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_locations_rendues.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** move of `archiver_cascade`, service, schemas, routes.
- [ ] **Step 4: Run** `../.venv/bin/pytest -q && ../.venv/bin/ruff check .` — Expected: PASS (dont `test_equipment_archive.py`).
- [ ] **Step 5: Commit** `feat(backend): archivage en lot des locations rendues d'une prestation`

---

### Task 6: Formulaire « Nombre d'exemplaires » (Parc + prestation)

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/features/equipment/EquipmentForm.tsx`, `frontend/src/features/equipment/EquipmentCreatePage.tsx`, `frontend/src/features/prestations/PrestationDetailPage.tsx`
- Create: `frontend/e2e/serie.spec.ts`

**Interfaces:**
- Consumes: `POST /equipments/serie`, `POST /prestations/{id}/equipements`, `GET /equipments/noms-serie` (Tasks 2–4).
- Produces:
  - `interface SerieCreee { ids: number[]; noms: string[]; modele_id: number | null }` (types.ts).
  - `EquipmentForm` props : `showQuantite` **supprimé**, remplacé par `prestaId?: number` ; `onCreated: (res: SerieCreee) => void | Promise<void>`. La requête part vers `/prestations/${prestaId}/equipements` si `prestaId`, sinon `/equipments/serie` ; corps `FormData` : `donnees` = JSON du body actuel + `nombre` (+ `quantite_allouee` si presta et vrac/conso), `photo` = image compressée (`compressImage`) si choisie. L'appel séparé `POST /equipments/{id}/photo` disparaît.
  - Champ « Nombre d'exemplaires » (input number, min 1) visible si `type === "standard"`. Si `nombre > 1` : label « Nom » → « Nom de base », bloc code-barres personnalisé masqué, aperçu sous le champ = réponse de `GET /equipments/noms-serie` (debounce 300 ms) : `créera ${noms[0]} … ${noms.at(-1)}` (ou `créera ${noms.join(", ")}` si ≤ 3).
  - Choisir un modèle pré-remplit `nom` avec `modele.nom` **seulement si `nom` est vide**.
  - « Quantité à allouer » visible seulement si `prestaId` et type vrac/consommable.
  - `EquipmentCreatePage` : `res.ids.length > 1` → `toast(\`${n} équipements créés\`)` + `navigate(\`/inventaire?modele=${res.modele_id}\`)` ; sinon fiche `/inventaire/${res.ids[0]}` comme aujourd'hui.
  - `PrestationDetailPage` : modale passe `prestaId={detail.id}`, `onCreated` = fermer + `onReload()` ; `allocateCreated` supprimé. `metaLine(a)` : si `a.quantite === 1`, affiche `STATUT_ALLOC_LABEL[a.statut]` (`{ Planifie: "Planifié", Sorti: "Sorti", Retourne: "Retourné" }`) au lieu de « Prévu … ». *(Choix : `quantite === 1` plutôt qu'un nouveau champ de type — un vrac alloué à 1 affiche aussi l'état, ce qui reste juste.)*

- [ ] **Step 1: Write the failing e2e** `frontend/e2e/serie.spec.ts`

```ts
test("Parc : création de 3 exemplaires d'un modèle", async ({ page, api }) => {
  const modele = await creerModele(api, "MH-100");
  const base = `MH ${randomUUID().slice(0, 6)}`;
  await page.goto("/inventaire/nouveau");
  await page.getByRole("searchbox", { name: "Modèle" }).fill(modele.nom);
  await page.getByRole("button", { name: new RegExp(modele.nom) }).click();
  await expect(page.getByPlaceholder("Lyre Beam 7R…")).toHaveValue(modele.nom); // pré-rempli
  await page.getByPlaceholder("Lyre Beam 7R…").fill(base);
  await page.getByLabel("Nombre d'exemplaires").fill("3");
  await expect(page.getByText(`créera ${base} 1, ${base} 2, ${base} 3`)).toBeVisible();
  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page).toHaveURL(new RegExp(`/inventaire\\?modele=${modele.id}$`));
  await expect(page.getByText("3 équipements créés")).toBeVisible();
  for (const k of [1, 2, 3]) await expect(page.getByText(`${base} ${k}`, { exact: true })).toBeVisible();
});

test("Prestation : créer et allouer 2 locations", async ({ page, api }) => {
  // presta via api ; modale « Ajouter du matériel (créer une fiche) » (location cochée par défaut),
  // nouveau fournisseur, base unique, nombre 2, « Créer et allouer »
  // → 2 lignes `${base} 1` / `${base} 2` avec badge « Location » et libellé « Planifié »
  // → api : 2 allocations quantite 1
});
```

- [ ] **Step 2: Run** `npm run e2e -- serie` — Expected: FAIL.
- [ ] **Step 3: Implement** the props/fields above.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm run test && npm run e2e` — Expected: all pass (dont `modeles.spec.ts`, qui crée encore une fiche N = 1).
- [ ] **Step 5: Commit** `feat(frontend): création de N exemplaires d'un modèle`

---

### Task 7: Bouton « Archiver les locations rendues »

**Files:**
- Create: `frontend/src/features/prestations/LocationsRendues.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/features/prestations/PrestationDetailPage.tsx` (InfoView, bloc « Prestation clôturée »)
- Modify: `frontend/e2e/serie.spec.ts`

**Interfaces:**
- Consumes: `GET /prestations/{id}/locations-rendues`, `POST …/locations-rendues/archivage` (Task 5).
- Produces:
  - Types `LocationRendue`, `LocationsRendues` (miroir des schémas Task 5).
  - `function LocationsRendues({ prestaId, onDone }: { prestaId: number; onDone: () => Promise<void> })` rendu dans `InfoView` si `detail.statut === "Terminee"` et `canManage`. Charge le GET ; rien si `archivables.length === 0`. Bouton « Archiver les locations rendues (N) » → `window.confirm` listant le compte par loueur (`Loueur X : 4\nLoueur Y : 2`) → POST → toast succès `${n} location(s) archivée(s)`, puis si `gardes.length` un toast info listant `« <nom> » gardé : <raison>` (3 max + « et N autres ») → `refreshEquipmentMirror()` → `onDone()`.

- [ ] **Step 1: Write the failing e2e** (ajout dans `serie.spec.ts`)

```ts
test("Prestation clôturée : archive les locations rendues seulement", async ({ page, api }) => {
  // 2 locations (creerEquipement externe + fournisseur_nom), presta, 2 allocations
  // sync/batch presta_check : A sortie+1 puis retour+1 ; B sortie+1
  // POST cloture { items: [{ allocation_id: allocB, decision: "perdu" }] }
  // page : bouton « Archiver les locations rendues (1) » ; page.once("dialog", d => d.accept())
  // → api : A archive=true, B archive=false
});
```

Payload sync : `{ items: [{ uuid_client, type: "presta_check", offline_created_at, payload: { presta_id, equipment_id, sens: "sortie" | "retour", delta: 1 } }] }` sur `POST sync/batch`.

- [ ] **Step 2: Run** `npm run e2e -- serie` — Expected: new test FAIL.
- [ ] **Step 3: Implement** the component and wiring.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm run e2e` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(frontend): archivage en lot des locations rendues`
