# Spécifications techniques des équipements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and show equipment specs (sous-catégorie, poids, dimensions, prix inté/exté, champs définis dans l'app, connectiques entrées/sorties) on Modele — or on Equipment for model-less items — and compute presta totals (poids, prix, connectiques), frozen at closing.

**Architecture:** New relational tables (`sous_categories`, `champs_specification`, `valeurs_specification`, `connecteurs`, `connectiques`) + fixed spec columns on `modeles` and `equipments`. Two new routers: `referentiel.py` (catalog CRUD: catégories, sous-catégories, champs, connecteurs) and `specs.py` (read/write the specs of one modele/equipment). A service `totaux_presta.py` computes totals for `PrestationDetail` and freezes unit price/weight on allocations at `cloture`. Frontend: a Référentiel page, a shared SpecsEditor/SpecsSheet, a totals card on the presta page. Everything is online REST — no new `SyncItemType`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic (hand-written), PostgreSQL, pytest; React 18 + TypeScript, Tailwind, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-specs-equipement-design.md`

## Global Constraints

- French domain language in tables, columns, routes, schemas, UI copy, comments.
- `MCD.dbml` updated in the same commit as the migration.
- Hand-written Alembic migration `0014_specifications.py`, `down_revision = "0013_modeles"`.
- RBAC: every write route of this feature uses `RequireStaff` (deletes included; Admin passes implicitly). Reads use `CurrentUser`. `delete_modele` stays `RequireAdmin`.
- Units: `poids` kg, `longueur`/`largeur`/`hauteur` cm, `prix_interne`/`prix_externe` € flat per presta.
- Price rule: presta `Interne` → `prix_interne`, `Externe` → `prix_externe`.
- Totals never count a missing value as 0 silently: they report `nb_sans_poids` / `nb_sans_prix` (lines).
- Specs of a model-backed unit = its Modele's specs. Equipment-level specs exist only while `modele_id IS NULL`.
- Numeric columns use `Numeric(..., asdecimal=False)` so Python/JSON see `float` (pydantic would serialize `Decimal` as a string).
- Backend: `../.venv/bin/pytest`, `../.venv/bin/ruff check .` (line-length 100). Frontend: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run e2e`.

## Review Focus

1. **French decimal comma** — a Staff member types `1,5` for poids or a `nombre` field → stored as 1.5, not rejected. (Task 3 test `test_nombre_virgule_francaise`; Task 6 `parseNombre` test.)
2. **Attaching a Modele to a model-less item** that already has its own specs → its own specs are cleared (no ghost duplicates), effective specs become the Modele's. (Task 3 test `test_rattacher_modele_efface_specs_propres`.)
3. **Removing a `choix` option still used by values** → refused 409, so no value points to a vanished option. (Task 2 test `test_retrait_option_utilisee_refuse`.)
4. **Changing a Modele's catégorie** → its sous-catégorie is cleared, values of the old catégorie's champs are hidden from GET but still in the table. (Task 3 test `test_changement_categorie_masque_valeurs`.)
5. **Deleting an Equipment or a Modele that has specs** → spec rows go with it (FK `ON DELETE CASCADE`), no FK error. (Task 1 test `test_cascade_suppression`.)

---

### Task 1: Data model, migration, MCD

**Files:**
- Modify: `backend/app/models/enums.py`, `backend/app/models/db_models.py`, `backend/app/models/__init__.py` (exports)
- Create: `backend/alembic/versions/0014_specifications.py`
- Modify: `MCD.dbml`
- Test: `backend/tests/test_specs_modele_donnees.py`

**Interfaces:**
- Produces enums: `TypeChampSpec(StrEnum)`: `NOMBRE="nombre"`, `TEXTE="texte"`, `CHOIX="choix"`, `OUI_NON="oui_non"` (PG `type_champ_spec`); `SensConnectique(StrEnum)`: `ENTREE="entree"`, `SORTIE="sortie"` (PG `sens_connectique`).
- Produces models:
  - `SousCategorie` (`sous_categories`): `id`, `nom String(120)`, `categorie_id FK categories NOT NULL`; `UniqueConstraint(categorie_id, nom)`.
  - `ChampSpecification` (`champs_specification`): `id`, `nom String(120)`, `type TypeChampSpec`, `unite String(20) NULL`, `options JSONB NOT NULL default []` (list[str]), `categorie_id FK NOT NULL`, `sous_categorie_id FK NULL`, `ordre Integer default 0`.
  - `ValeurSpecification` (`valeurs_specification`): `id`, `champ_id FK ondelete CASCADE`, `modele_id FK modeles ondelete CASCADE NULL`, `equipment_id FK equipments ondelete CASCADE NULL`, `valeur Text NOT NULL`; `CheckConstraint("(modele_id IS NULL) <> (equipment_id IS NULL)", name="ck_valeurs_specification_cible")`; `UniqueConstraint(champ_id, modele_id)`, `UniqueConstraint(champ_id, equipment_id)`.
  - `Connecteur` (`connecteurs`): `id`, `nom String(80) unique`.
  - `Connectique` (`connectiques`): `id`, `connecteur_id FK ondelete CASCADE`, `sens SensConnectique`, `quantite Integer` + `CheckConstraint("quantite >= 1")`, `modele_id`/`equipment_id` same XOR + cascade as above (`ck_connectiques_cible`); `UniqueConstraint(connecteur_id, sens, modele_id)`, `UniqueConstraint(connecteur_id, sens, equipment_id)`.
  - Columns added to **both** `Modele` and `Equipment`: `sous_categorie_id FK sous_categories NULL`, `poids Numeric(8,2)`, `longueur`/`largeur`/`hauteur Numeric(8,1)`, `prix_interne`/`prix_externe Numeric(10,2)` — all nullable, `asdecimal=False`.
  - `Equipment.remarque Text NULL`.
  - `AllocationPresta.prix_unitaire_fige Numeric(10,2) NULL`, `AllocationPresta.poids_unitaire_fige Numeric(8,2) NULL`.
- Comments on the new columns follow the file's style (why, in French): Equipment spec columns "utilisées seulement sans modèle"; `*_fige` "figé à la clôture, NULL tant que la presta est ouverte".

- [ ] **Step 1: Write failing tests** in `test_specs_modele_donnees.py` (use `db_session`, `make_equipment`):
  - `test_valeur_cible_exclusive`: a `ValeurSpecification` with both `modele_id` and `equipment_id` set → `flush()` raises `IntegrityError`; with neither → `IntegrityError`.
  - `test_connectique_quantite_positive`: `quantite=0` → `IntegrityError`.
  - `test_cascade_suppression`: Modele with one valeur + one connectique, Equipment (no modele) with one valeur + one connectique; `await session.delete(...)` both + flush → no error, `select(func.count())` on both tables for those ids == 0.
- [ ] **Step 2: Run** `cd backend && ../.venv/bin/pytest tests/test_specs_modele_donnees.py -v` → FAIL (ImportError on the new models).
- [ ] **Step 3: Implement** enums, models, exports, migration `0014_specifications.py` (create the two PG enums, five tables, add the columns; `downgrade` drops all in reverse, then the enums), and update `MCD.dbml` (new `Enum` blocks, five `Table`s, new columns on `modeles`/`equipments`/`allocations_presta`, `Ref`s with cascade notes).
- [ ] **Step 4: Run** `../.venv/bin/python -m alembic upgrade head && ../.venv/bin/python -m alembic downgrade -1 && ../.venv/bin/python -m alembic upgrade head`, then the test file → PASS; `../.venv/bin/ruff check .` clean.
- [ ] **Step 5: Commit** `feat(backend): modèle de données des spécifications techniques`

---

### Task 2: Référentiel API (catégories, sous-catégories, champs, connecteurs)

**Files:**
- Create: `backend/app/schemas/specs.py`, `backend/app/routers/referentiel.py`
- Modify: `backend/app/main.py` (include router, prefix `/api`)
- Test: `backend/tests/test_referentiel.py`

**Interfaces:**
- Consumes: Task 1 models/enums.
- Produces schemas (`schemas/specs.py`):
  - `CategorieCreate{nom: str(1..120), description: str|None}`, `CategorieUpdate` (all optional). Reuses existing `CategorieRead` from `schemas/equipment.py`.
  - `SousCategorieRead{id, nom, categorie_id, nb_utilisations: int}` (modeles + equipments using it), `SousCategorieCreate{nom, categorie_id}`, `SousCategorieUpdate{nom}`.
  - `ChampSpecRead{id, nom, type: TypeChampSpec, unite, options: list[str], categorie_id, sous_categorie_id, ordre, nb_valeurs: int}`, `ChampSpecCreate{nom, type, unite=None, options=[], categorie_id, sous_categorie_id=None, ordre=0}`, `ChampSpecUpdate` (all optional).
  - `ConnecteurRead{id, nom, nb_utilisations: int}` (distinct modeles+equipments), `ConnecteurCreate{nom}`, `ConnecteurUpdate{nom}`.
- Produces routes (all in `referentiel.py`, tag `referentiel`):
  - `POST /categories`, `PATCH /categories/{id}`, `DELETE /categories/{id}` (existing `GET /categories` in `equipment.py` stays).
  - `GET /sous-categories?categorie_id=`, `POST /sous-categories`, `PATCH /sous-categories/{id}`, `DELETE /sous-categories/{id}`.
  - `GET /champs-specification?categorie_id=`, `POST`, `PATCH /{id}`, `DELETE /{id}`.
  - `GET /connecteurs`, `POST`, `PATCH /{id}`, `DELETE /{id}`.
  - Handler names: `create_categorie`, `update_categorie`, `delete_categorie`, `list_sous_categories`, `create_sous_categorie`, `update_sous_categorie`, `delete_sous_categorie`, `list_champs`, `create_champ`, `update_champ`, `delete_champ`, `list_connecteurs`, `create_connecteur`, `update_connecteur`, `delete_connecteur`. Signature pattern as `modeles.py`: `(id?, payload, _user: RequireStaff, db: DbSession)`.
- Rules (reuse the `_get_or_404` / 409-on-duplicate pattern of `routers/modeles.py`):
  - Duplicate names → 409: catégorie (`nom` case-sensitive), sous-catégorie within its catégorie, connecteur.
  - `delete_categorie` → 409 if any modele, equipment, sous-catégorie or champ references it.
  - `delete_sous_categorie` → 409 if any modele/equipment uses it or any champ is narrowed to it.
  - `create_champ`/`update_champ`: `sous_categorie_id` must belong to `categorie_id` (422); `type == choix` needs ≥ 1 non-blank option (422); options trimmed, deduplicated.
  - `update_champ`: changing `type` when `nb_valeurs > 0` → 409; removing an option still used by a valeur → 409 naming the option. Changing `categorie_id`/`sous_categorie_id` is allowed and keeps the values (they are only hidden where no longer applicable).
  - `delete_champ` / `delete_connecteur`: always allowed, cascade deletes values/connectiques (the UI confirms with `nb_valeurs` / `nb_utilisations`).

- [ ] **Step 1: Write failing tests** (call handlers directly, like `test_modeles.py`; a `staff` fixture from `membre_id`):
  - `test_categorie_crud_et_doublon`: create "Lights X" → 201-equivalent read; second create same nom → `HTTPException` 409.
  - `test_suppression_categorie_utilisee_refusee`: catégorie with a Modele → `delete_categorie` 409; empty one → deleted.
  - `test_sous_categorie_doublon_par_categorie`: "Beam" twice under same catégorie → 409; "Beam" under another catégorie → OK.
  - `test_suppression_sous_categorie_utilisee_refusee`: used by a Modele → 409.
  - `test_champ_sous_categorie_hors_categorie`: sous-cat of catégorie A on champ of catégorie B → 422.
  - `test_champ_choix_sans_option`: `type=choix, options=[" "]` → 422.
  - `test_changement_type_avec_valeurs_refuse`: champ with one `ValeurSpecification` → `update_champ(type=texte)` 409; without values → OK.
  - `test_retrait_option_utilisee_refuse`: choix `["Actif","Passif"]`, a valeur "Actif" → PATCH `options=["Passif"]` 409; PATCH `options=["Actif","Passif","Autre"]` OK.
  - `test_suppression_champ_cascade`: champ with 2 values → deleted, 0 values left; `list_champs` showed `nb_valeurs == 2` before.
  - `test_ecritures_exigent_staff`: for every route in `app.routes` whose path starts with `/api/categories`, `/api/sous-categories`, `/api/champs-specification`, `/api/connecteurs` and method in {POST, PATCH, DELETE}: `typing.get_type_hints(route.endpoint, include_extras=True)["_user"] is RequireStaff`.
- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_referentiel.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** schemas, router, wiring in `main.py`.
- [ ] **Step 4: Run** tests → PASS; ruff clean.
- [ ] **Step 5: Commit** `feat(backend): référentiel des catégories, sous-catégories, champs et connecteurs`

---

### Task 3: Specs read/write of a Modele or an Equipment, + remarque

**Files:**
- Create: `backend/app/services/specs.py`, `backend/app/routers/specs.py`
- Modify: `backend/app/schemas/specs.py`, `backend/app/main.py`, `backend/app/routers/modeles.py` (`update_modele`), `backend/app/routers/equipment.py` (`_appliquer_modele`, create/update/detail for `remarque`), `backend/app/schemas/equipment.py` (`remarque` on `EquipmentCreate`, `EquipmentUpdate`, `EquipmentDetail`)
- Test: `backend/tests/test_specs.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 schemas file.
- Produces schemas:
  - `ConnectiqueIn{connecteur_id: int, sens: SensConnectique, quantite: int (ge=1)}`; `ConnectiqueRead{connecteur_id, connecteur_nom, sens, quantite}`.
  - `ValeurSpecRead{champ_id, nom, type, unite, options, valeur: str | None}`.
  - `SpecsRead{source: Literal["modele","equipement"], modele_id: int|None, categorie_id: int|None, sous_categorie_id, sous_categorie_nom, poids, longueur, largeur, hauteur, prix_interne, prix_externe (float|None), valeurs: list[ValeurSpecRead], connectiques: list[ConnectiqueRead]}`.
  - `SpecsWrite{sous_categorie_id: int|None = None, poids/longueur/largeur/hauteur/prix_interne/prix_externe: float|None (ge=0) = None, valeurs: dict[int, str|None] = {}, connectiques: list[ConnectiqueIn] = []}`.
- Produces service (`services/specs.py`):
  - `async def lire_specs(db, cible: Modele | Equipment) -> SpecsRead` — `valeurs` = every applicable champ (champs of the cible's catégorie with `sous_categorie_id IS NULL` + champs of its sous-catégorie), ordered by `(ordre, nom)`, `valeur=None` when unset. Values of non-applicable champs are not returned.
  - `async def ecrire_specs(db, cible: Modele | Equipment, data: SpecsWrite) -> None` — replaces fixed fields, `sous_categorie_id` and the whole connectique list; upserts/deletes only the `valeurs` keys given (`None` or blank → delete row).
  - `def normaliser_valeur(champ: ChampSpecification, brut: str) -> str` — `nombre`: accepts `"1,5"`/`"1.5"`, stores `"1.5"` (422 otherwise); `oui_non`: `"true"`/`"false"` only; `choix`: must be in `options`; `texte`: trimmed.
  - `async def effacer_specs_propres(db, eq: Equipment) -> None` — nulls the 7 spec columns of `eq` and deletes its valeurs/connectiques.
- Produces routes (`routers/specs.py`): `GET/PUT /modeles/{modele_id}/specs` → `lire_specs_modele`, `ecrire_specs_modele`; `GET/PUT /equipments/{equipment_id}/specs` → `lire_specs_equipment`, `ecrire_specs_equipment`. PUT returns `SpecsRead`.
  - `GET /equipments/{id}/specs` on a model-backed unit returns the **Modele's** specs (`source="modele"`).
  - `PUT /equipments/{id}/specs` on a model-backed unit → 409 "Les spécifications se modifient sur le modèle."
  - Validation in `ecrire_specs`: `sous_categorie_id` must belong to the cible's catégorie (422); a `valeurs` key that is not an applicable champ → 422; the same `(connecteur_id, sens)` twice → 422; unknown connecteur → 404.
- Hooks into existing code:
  - `update_modele`: when `categorie_id` changes, set `modele.sous_categorie_id = None` (values stay in the table).
  - `_appliquer_modele` (equipment.py:125): call `effacer_specs_propres(db, eq)` when a modele gets attached.
  - `remarque`: plain optional text on create/update (blank → `None`), returned on `EquipmentDetail`.

- [ ] **Step 1: Write failing tests** in `test_specs.py`:
  - `test_modele_specs_aller_retour`: PUT poids 12.5, longueur 200, prix_interne 30, prix_externe 60, sous-cat, one `nombre` value `"300"`, connectiques `[1× PowerCon entree, 1× LineCon sortie]` → GET returns the same, `source == "modele"`.
  - `test_unite_herite_du_modele`: unit of that Modele → `lire_specs_equipment` returns Modele's poids, `source == "modele"`; `ecrire_specs_equipment` → 409.
  - `test_item_sans_modele_specs_propres`: flight (`est_contenant=True`, no modele) PUT poids 8 → GET `source == "equipement"`, poids 8.
  - `test_nombre_virgule_francaise`: value `"1,5"` on a `nombre` champ → stored `"1.5"`; `"abc"` → 422.
  - `test_choix_et_oui_non_valides`: choix value not in options → 422; oui_non `"peut-être"` → 422.
  - `test_valeur_champ_non_applicable_refusee`: champ of another catégorie → 422.
  - `test_connectique_doublon_refuse`: same connecteur+sens twice → 422.
  - `test_changement_categorie_masque_valeurs`: Modele with value on catégorie-A champ, `update_modele(categorie_id=B)` → `sous_categorie_id is None`, GET specs no longer lists the champ, row still in `valeurs_specification`.
  - `test_rattacher_modele_efface_specs_propres`: model-less item with poids + one valeur + one connectique, `update_equipment(modele_id=m.id)` → its own columns are `None`, its rows deleted, GET returns Modele's specs.
  - `test_remarque_equipment`: create with `remarque="Lampe faible"` → detail shows it; update `remarque="  "` → `None`.
  - `test_ecriture_specs_exige_staff`: both `PUT .../specs` endpoints have `_user` annotated `RequireStaff` (same introspection as Task 2).
- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_specs.py -v` → FAIL.
- [ ] **Step 3: Implement** service, router, wiring, hooks, `remarque`.
- [ ] **Step 4: Run** `../.venv/bin/pytest` (full suite: `test_modeles.py` and equipment tests must stay green) → PASS; ruff clean.
- [ ] **Step 5: Commit** `feat(backend): spécifications d'un modèle ou d'un item, remarque par unité`

---

### Task 4: Presta totals + freeze at closing

**Files:**
- Create: `backend/app/services/totaux_presta.py`
- Modify: `backend/app/schemas/prestation.py` (`AllocationRead`, `PrestationDetail`), `backend/app/routers/prestations.py` (`_detail_response`, `_allocation_read`, `cloturer_prestation`, `rouvrir_prestation`)
- Test: `backend/tests/test_presta_totaux.py`

**Interfaces:**
- Consumes: Task 1 columns, Task 3 effective-specs rule (Modele if `modele_id`, else Equipment).
- Produces schemas:
  - `TotalConnectique{connecteur_id, connecteur_nom, sens: SensConnectique, quantite: int}`.
  - `TotauxPresta{tarif: Literal["interne","externe"], fige: bool, poids_total: float, nb_sans_poids: int, prix_total: float, nb_sans_prix: int, connectiques: list[TotalConnectique]}`.
  - `AllocationRead` gains `prix_unitaire: float | None = None`, `poids_unitaire: float | None = None`; `PrestationDetail` gains `totaux: TotauxPresta`.
- Produces service:
  - `async def specs_unitaires(db, allocs: list[AllocationPresta], type_presta: TypePrestation) -> dict[int, tuple[float | None, float | None, list[tuple[int, str, SensConnectique, int]]]]` — keyed by allocation id: (unit price per presta type, unit weight, connectiques). Batch queries, no N+1.
  - `async def calculer_totaux(db, presta: Prestation, allocs: list[AllocationPresta]) -> tuple[TotauxPresta, dict[int, tuple[float | None, float | None]]]` — second value = per-allocation (prix_unitaire, poids_unitaire) for `AllocationRead`. When `presta.statut == TERMINEE`, uses `*_fige` columns and `fige=True`; connectiques always live.
  - `async def figer_allocations(db, presta: Prestation) -> None` / `async def defiger_allocations(db, presta_id: int) -> None`.
- Algorithm (the part the signatures do not fix): each line contributes `unit × alloc.quantite` (vrac/conso quantities included; standard units have `quantite = 1`); a line with unit `None` adds nothing and increments `nb_sans_*`. Connectiques summed per `(connecteur_id, sens)` × `alloc.quantite`, sorted `sens` then `connecteur_nom`. Flight contents are just their own allocations — no tree walk.
- Hooks: `cloturer_prestation` calls `figer_allocations` just before `presta.statut = TERMINEE`; `rouvrir_prestation` calls `defiger_allocations`.

- [ ] **Step 1: Write failing tests** (`test_presta_totaux.py`, helpers like `test_modeles.py`):
  - `test_totaux_presta_vide`: no allocation → `poids_total == 0`, `prix_total == 0`, `nb_sans_poids == 0`, `nb_sans_prix == 0`, `connectiques == []`.
  - `test_totaux_interne_externe`: Modele poids 10, prix_interne 20, prix_externe 50, connectique 1× PowerCon entree; 2 units allocated → Interne: `prix_total == 40`, `poids_total == 20`, connectiques `[(PowerCon, entree, 2)]`; PATCH presta type Externe → `prix_total == 100`, `tarif == "externe"`.
  - `test_totaux_vrac_quantite`: vrac item (no modele) poids 0.5, prix_interne 1, allocated `quantite=10` → contributes 5 kg, 10 €.
  - `test_totaux_partiels`: one unit with poids, one Modele without poids → `nb_sans_poids == 1`, `poids_total` = known part only.
  - `test_flight_et_contenu`: flight poids 8 + 2 units of poids 10 inside, allocated with `inclure_contenu=True` → `poids_total == 28`.
  - `test_prix_unitaire_par_ligne`: `get_prestation` → each `AllocationRead.prix_unitaire` matches the presta type.
  - `test_fige_a_la_cloture`: close the presta (`cloturer_prestation` with empty items), then change the Modele's `prix_interne` and `poids` → totals unchanged, `fige is True`; `rouvrir_prestation` → totals use the new values, `fige is False`, `*_fige` columns NULL.
- [ ] **Step 2: Run** `../.venv/bin/pytest tests/test_presta_totaux.py -v` → FAIL.
- [ ] **Step 3: Implement** service, schema fields, hooks.
- [ ] **Step 4: Run** full `../.venv/bin/pytest` (all `test_presta_*` stay green) → PASS; ruff clean.
- [ ] **Step 5: Commit** `feat(prestations): totaux poids, prix et connectiques, figés à la clôture`

---

### Task 5: Frontend — types + Référentiel page

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/AppRouter.tsx` (lazy route `/referentiel`), `frontend/src/features/catalog/CatalogPage.tsx` (link "Référentiel" next to the existing `/modeles` link, Staff+ only)
- Create: `frontend/src/features/referentiel/ReferentielPage.tsx`, `CategoriesTab.tsx`, `ConnecteursTab.tsx`

**Interfaces:**
- Consumes: Task 2 routes/schemas.
- Produces TS types in `types.ts` mirroring the backend schemas: `TypeChampSpec`, `SensConnectique`, `SousCategorie`, `ChampSpec`, `Connecteur`, `ConnectiqueIn`, `Connectique`, `ValeurSpec`, `Specs`, `SpecsWrite`, `TotalConnectique`, `TotauxPresta`; `Allocation` gains `prix_unitaire`, `poids_unitaire`; `PrestationDetail` gains `totaux`; `EquipmentDetail` gains `remarque`.
- UI: two tabs. **Catégories**: list of catégories, each expandable → its sous-catégories (add/rename/delete) and its champs (add/edit: nom, type, unité for `nombre`, options for `choix`, optional sous-catégorie, ordre; delete with `window.confirm` showing `nb_valeurs`). **Connecteurs**: list with add/rename/delete (confirm showing `nb_utilisations`). Follow `ModelesPage.tsx` patterns (`api()`, `useToast`, `inputCls`, `Button`, `Icon`, `ApiError` messages in toast). Tech sees the page read-only (no buttons).

- [ ] **Step 1: Implement** types, route, link, page and tabs.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint` → clean.
- [ ] **Step 3: Commit** `feat(frontend): page Référentiel (catégories, champs, connecteurs)`

(E2E coverage of this page is in Task 8.)

---

### Task 6: Frontend — SpecsEditor / SpecsSheet on Modele and Equipment pages, remarque

**Files:**
- Create: `frontend/src/features/specs/format.ts`, `format.test.ts`, `SpecsSheet.tsx`, `SpecsEditor.tsx`
- Modify: `frontend/src/features/modeles/ModelesPage.tsx`, `frontend/src/features/equipment/EquipmentDetailPage.tsx` (spec block, `remarque` in `Info` list and in `EditForm`), `frontend/src/features/equipment/EquipmentForm.tsx` (`remarque` textarea)

**Interfaces:**
- Consumes: Task 3 routes, Task 5 types.
- Produces (`format.ts`):
  - `parseNombre(s: string): number | null` — trims, accepts `,` or `.`, `""` → `null`, invalid → `NaN`.
  - `formatNombre(n: number | null, unite?: string): string` — French locale (`1,5 kg`), `null` → `"—"`.
  - `formatPrix(n: number | null): string` — `"30 €"` / `"12,50 €"`, `null` → `"—"`.
  - `formatConnectiques(list: { connecteur_nom: string; quantite: number }[]): string` — `"1× PowerCon, 2× DMX 3p Male"`.
- Produces components:
  - `SpecsSheet({ specs }: { specs: Specs })` — read-only: sous-catégorie, poids, dimensions `L × l × h cm`, prix inté/exté, applicable champs with value (oui_non → Oui/Non), Entrées / Sorties lines. Empty sections hidden; nothing at all → "Aucune spécification".
  - `SpecsEditor({ cible, id, onSaved, onCancel }: { cible: "modeles" | "equipments"; id: number; onSaved: (s: Specs) => void; onCancel: () => void })` — loads `GET /{cible}/{id}/specs` and `/sous-categories?categorie_id=` and `/connecteurs`, edits, `PUT` a `SpecsWrite`. Number inputs are `inputMode="decimal"` text parsed with `parseNombre`; inline error on `NaN`. Connectique editor: rows (connecteur select, sens select, quantité) with add/remove.
- Builder's call recorded here: specs of a model-less item are edited from its **detail page** (after creation), not inside `EquipmentForm` — creation is multipart and specs have their own `PUT`; `EquipmentForm` only gains `remarque`.
- Placement: ModelesPage — per row a "Spécifications" action (Staff+) opening `SpecsEditor`, and the row expands to `SpecsSheet` for everyone. EquipmentDetailPage — "Spécifications" block with `SpecsSheet` from `GET /equipments/{id}/specs`; when `source === "modele"` a hint "Héritées du modèle « X »" (link `/modeles`); when `source === "equipement"` and Staff+, an "Éditer" button opening `SpecsEditor`.

- [ ] **Step 1: Write failing vitest** `format.test.ts`: `parseNombre("1,5") === 1.5`, `parseNombre(" 2.25 ") === 2.25`, `parseNombre("") === null`, `Number.isNaN(parseNombre("abc"))`; `formatNombre(1.5, "kg") === "1,5 kg"`; `formatNombre(null) === "—"`; `formatPrix(12.5) === "12,50 €"`; `formatPrix(30) === "30 €"`; `formatConnectiques([{connecteur_nom:"PowerCon",quantite:1},{connecteur_nom:"DMX 3p Male",quantite:2}]) === "1× PowerCon, 2× DMX 3p Male"`.
- [ ] **Step 2: Run** `npm run test -- format` → FAIL.
- [ ] **Step 3: Implement** `format.ts`, components, page integrations.
- [ ] **Step 4: Run** `npm run test && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): fiche et édition des spécifications, remarque par unité`

---

### Task 7: Frontend — totals card on the presta page

**Files:**
- Create: `frontend/src/features/prestations/TotauxCard.tsx`, `frontend/src/features/prestations/totaux.ts`, `totaux.test.ts`
- Modify: `frontend/src/features/prestations/PrestationDetailPage.tsx` (render `TotauxCard` in `InfoView`; show `formatPrix(alloc.prix_unitaire)` on each allocation line)

**Interfaces:**
- Consumes: Task 4 `PrestationDetail.totaux`, Task 6 `format.ts`.
- Produces: `libelleManquants(nb: number, quoi: "poids" | "prix"): string | null` in `totaux.ts` — `0` → `null`; `1` → `"1 item sans poids"`; `3` → `"3 items sans poids"` (same for prix). `TotauxCard({ totaux }: { totaux: TotauxPresta })` shows: Poids total (+ "partiel" badge and `libelleManquants`), Prix total with "tarif interne/externe" label (+ partial badge), Entrées / Sorties via `formatConnectiques`, and "Figé à la clôture" when `fige`.

- [ ] **Step 1: Write failing vitest** `totaux.test.ts` with the three `libelleManquants` cases above for both `poids` and `prix`.
- [ ] **Step 2: Run** `npm run test -- totaux` → FAIL.
- [ ] **Step 3: Implement** helper, card, page integration.
- [ ] **Step 4: Run** `npm run test && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): totaux poids, prix et connectiques sur la prestation`

---

### Task 8: E2E + final verification

**Files:**
- Create: `frontend/e2e/specs.spec.ts`
- Modify: `frontend/e2e/fixtures.ts` only if a helper is needed (e.g. `creerConnecteur(api, nom)` with a unique suffix)

**Interfaces:**
- Consumes: everything above; `creerModele`, `creerEquipement`, the `api` fixture, `context.setOffline`.

- [ ] **Step 1: Write e2e tests** (unique names via `randomUUID().slice(0, 8)`):
  - `référentiel : sous-catégorie, champ et connecteur` — on `/referentiel`, create a catégorie, a sous-catégorie "Beam", a `nombre` champ "Puissance" unit "W", a connecteur; all visible after reload.
  - `spécifications d'un modèle et totaux de prestation` — via `api`: catégorie + champ + connecteur + Modele, 2 units, presta Interne. UI: on `/modeles` open the Modele's "Spécifications", fill poids `12,5`, prix inté `30`, Puissance `300`, one entrée PowerCon ×1, save. Open a unit's detail page → shows `12,5 kg` and "Héritées du modèle". Allocate both units via `api`, open `/prestations/{id}` → card shows `25 kg`, `60 €`, `2× PowerCon`.
  - `totaux lisibles hors ligne` — after loading the presta page once, `context.setOffline(true)`, reload → totals still visible; `setOffline(false)`.
  - `staff : unité sans modèle éditable` — `test.use({ membre: "x@e2e.example" })` (provisioned Staff): a flight (`est_contenant: true`) detail → "Éditer" spécifications, set poids `8`, save, shown.
- [ ] **Step 2: Run** `cd frontend && npm run e2e -- specs` → PASS (fix until green).
- [ ] **Step 3: Full verification**: `cd backend && ../.venv/bin/pytest && ../.venv/bin/ruff check .`; `cd frontend && npm run lint && npm run typecheck && npm run test && npm run build && npm run e2e` → all green; record the outputs for the final report.
- [ ] **Step 4: Commit** `test(e2e): spécifications et totaux de prestation`
