# Spécifications techniques des équipements — design

## Context / why

The legacy Google Sheet (`assets/sheet-log/clean/*.csv`) carries per-item specs — Type, Entrées, Sorties, Longueur, Poids, Prix inté, Prix exté, Remarque — that BPM Log cannot store today. `Modele` only has `nom`, `marque`, `categorie_id`. Before importing the sheet (separate later step), the data model must hold these specs.

Specs are used for three things (user's answer):
1. **Reference sheet** — a tech sees what they hold (unit detail, model page).
2. **Preparing a presta** — total weight for the truck, connectors/cables needed.
3. **Pricing** — price total of a presta.

**Not** used for search/filter in the Parc → spec values do not need to be indexed/queryable columns.

## Goals

- Two-level taxonomy: **Catégorie** (= CSV sheet: Lights, Son, Structure, Câbles, Écrans et Mapping, Autre) → **Sous-catégorie** (= CSV "Type" column: Beam, Bar, Par / Sub, Tête, Ampli…), scoped to its Catégorie, chosen on the Modele.
- **General specs, fixed fields on every Modele**: `poids` (kg), `longueur` / `largeur` / `hauteur` (cm), `prix_interne` / `prix_externe` (€, **per presta**, flat whatever the duration).
- **Specific specs, defined in the app** ("champs de spécification"): attached to a Catégorie, optionally narrowed to one Sous-catégorie. E.g. Son → actif/passif, puissance (W); Lights → nb canaux DMX; Beam → angle.
- **Connectors (Entrées / Sorties)**: in-app catalog of connector types (PowerCon, LineCon, XLR Male, XLR Femelle, DMX 3p Male, DMX 5p Femelle, Speakon, C13, Jack, Ethercon…). A Modele lists `n × connecteur` per direction (entrée / sortie).
- **Specs live on the Modele** — all units of a model are identical (user: "never differ"). Units inherit, no per-unit override.
- **Model-less items** (vrac, consommable, flight, location — they have no Modele today) carry the **same spec structure directly on the Equipment**.
- **Presta totals** on the presta detail page: total weight, connectors summed per type and direction, price total — plus per-line price.
- **Unit detail page** shows the specs (from its Modele, or its own if model-less).

## Non-goals

- Search / filter by spec in the Parc.
- CSV import (separate step after this one).
- Exportable / PDF devis — a total on the presta page is enough.
- Per-unit spec override for model-backed units.
- Hiding prices: **visible to every logged-in member**, Tech included.

## Anti-goals (would be a failure even if it works)

- Spec values duplicated on every unit of a model (exactly the CSV problem we are cleaning up).
- Totals that silently treat a missing value as 0 and look complete.
- Specs flowing through the offline sync queue as absolute writes — specs are reference data edited online via REST, like Modele today (no new `SyncItemType`).

## Decisions (user's)

| Topic | Decision |
|---|---|
| Spec level | On Modele; model-less items carry their own on Equipment |
| Taxonomy | Catégorie = sheet; new Sous-catégorie per Catégorie = CSV "Type" |
| Specific fields | Defined in the app, not in code |
| Field scope | Catégorie, or narrowed to a Sous-catégorie |
| General fields | Fixed: poids, L×l×h, prix inté/exté |
| Connectors | Catalog + count, per direction |
| Prices | Flat rental price per presta |
| Rights | **Staff does everything**, deletes included: catégories/sous-catégories, fields, connectors, values (Admin passes implicitly). Tech reads. Deletes still refused when in use (see call 8). `delete_modele` stays Admin-only (unchanged) |
| Price visibility | All members |
| Quote | Total + per-line price on presta page |
| History | **Totals frozen at closing**: when a presta becomes `Terminee`, each allocation snapshots its unit price and unit weight; closed prestas show the frozen values, open ones are live |
| Flight weight | `poids` of a flight = empty case. Contents count only through their own allocations; no warning for unallocated contents |
| Remarque | New free-text `remarque` column on **Equipment** (per unit), Staff-editable, shown on unit detail |

## My calls (check these)

1. **Price rule**: presta `type = Interne` → `prix_interne`, `Externe` → `prix_externe`. (User confirmed playback.)
2. **Vrac / consommable totals**: spec values are **per piece**; presta total = value × `quantite` allocated.
3. **Flights**: contents are already separate allocations (`prestations.py` allocates standard descendants), so totals = plain sum over allocations. No tree walk (user: allocations only, no warning for vrac left inside a flight).
4. **Missing values**: totals show what's known + a flag ("poids partiel : 3 items sans poids"), never a silent 0. Same for price.
5. **Connector totals**: plain sum per (connecteur, sens) over allocations × quantite — e.g. "Entrées : 17× PowerCon, 17× DMX 3p Male". No cable-matching logic.
6. **Field types**: `nombre` (+ optional unité, e.g. W, °), `texte`, `choix` (single choice from an option list), `oui_non`. No "required" flag.
7. **Storage**:
   - `sous_categories` (id, nom, categorie_id; unique (categorie_id, nom)).
   - `Modele.sous_categorie_id` (nullable; must belong to the model's categorie — validated; cleared if categorie changes). `Equipment.sous_categorie_id` for model-less items; for model-backed items it follows the Modele, same rule as `categorie_id` today.
   - Fixed columns on **both** `modeles` and `equipments`: `poids` Numeric(8,2), `longueur`/`largeur`/`hauteur` Numeric(8,1), `prix_interne`/`prix_externe` Numeric(10,2). On `equipments` they are used only when `modele_id` is NULL (API rejects writing them on a model-backed unit).
   - `champs_specification` (id, nom, type, unite, options JSONB for `choix`, categorie_id NOT NULL, sous_categorie_id NULL, ordre).
   - `valeurs_specification` (id, champ_id FK cascade, modele_id XOR equipment_id — CHECK constraint, valeur Text; unique (champ_id, modele_id) / (champ_id, equipment_id)).
   - `connecteurs` (id, nom unique).
   - `connectiques` (id, connecteur_id, sens enum `entree`/`sortie`, quantite ≥ 1, modele_id XOR equipment_id).
   - `allocations_presta`: `prix_unitaire_fige` Numeric(10,2) NULL, `poids_unitaire_fige` Numeric(8,2) NULL — filled at transition to `Terminee` (price chosen per presta type at that moment), cleared on réouverture (back to live), re-filled on next closing. Connectors are not frozen (live).
   - `equipments.remarque` Text NULL.
   - New PG enums mirrored in `enums.py`: `type_champ_spec`, `sens_connectique`.
   - Relational tables (not JSONB) to match the existing style and keep `MCD.dbml` reviewable.
8. **Field lifecycle**: changing a field's `type` is refused when values exist; deleting a field or connector deletes its values/lines after a confirm dialog showing how many models are affected. Deleting a sous-catégorie in use is refused (like `delete_modele` refuses when units exist). Field scope change (catégorie/sous-cat) keeps values; values no longer applicable are hidden, not deleted.
9. **Specs displayed for a model** = fields of its catégorie (no sous-cat) + fields of its sous-catégorie, ordered by `ordre`.
10. **Catégories** are read-only today (only `GET /categories`). Staff gets CRUD on catégories too (needed to manage sous-cats/fields under them).

## UI (left to builder, within these lines)

- **Référentiel page** (Staff+, new lazy route, e.g. `/referentiel`): tabs Catégories (with nested sous-catégories and their spec fields) and Connecteurs.
- **Modele edit** (`features/modeles/ModelesPage.tsx`): sous-catégorie picker, general specs block, dynamic specific fields, connectique editor (entrées / sorties rows: connecteur + quantité).
- **Equipment create/edit** (`features/equipment/EquipmentForm.tsx`): same blocks shown only when the item has no Modele.
- **Equipment detail** (`features/equipment/EquipmentDetailPage.tsx`): read-only spec sheet.
- **Presta detail** (`features/prestations/PrestationDetailPage.tsx`): totals card (poids, prix with inté/exté per presta type, connectiques) + per-line price; partial-data flags.
- Offline: read-only specs come through the existing NetworkFirst `/api/*` cache; editing specs requires connectivity (same as Modele editing today).

## Constraints

- French domain language everywhere (tables, routes, UI).
- Update `MCD.dbml` in the same change as the migration.
- Hand-written Alembic migration.
- Reuse patterns from `backend/app/routers/modeles.py` (`_get_or_404`, `_verifier_categorie`, 409 on duplicate name, RBAC via `RequireStaff`).
- Totals computed server-side (presta read endpoint or a dedicated `GET /prestations/{id}/totaux`) — builder's call.

## Verification

- Backend pytest: CRUD + RBAC (Tech read-only, Staff can delete), XOR constraints, sous-cat/catégorie consistency, field type-change refusal, totals (vrac × qty, Interne vs Externe price, partial flags, flight + contents), freeze at closing (change Modele price after close → total unchanged; réouverture → live again).
- `ruff check .`, `npm run lint`, `npm run typecheck`, `npm run test`.
- E2E (`frontend/e2e/`): Staff creates sous-cat + field + connector, fills a Modele's specs, creates units, allocates them to a presta, checks totals; detail page shows the spec sheet; offline: presta totals still readable from cache.
