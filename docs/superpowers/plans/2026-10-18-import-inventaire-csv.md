# Import de l'inventaire CSV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command that loads `assets/sheet-log/clean/*.csv` into BPM Log through the REST API, re-runnable on dev, run once on prod.

**Architecture:** A small package `backend/app/import_csv/` run as `python -m app.import_csv`, like `app.seed`. `mapping.py` is pure: CSV → `Plan`, applying every cleanup rule. `importeur.py` is async: it walks a `Plan` against an `httpx.AsyncClient`, get-or-create by name, and returns a `Rapport`. `__main__.py` is the CLI: arguments, token, dry-run, confirmation. Tests drive `importeur` against the real app via `ASGITransport` with the DB and auth dependencies overridden.

**Tech Stack:** Python 3.12, httpx (already a backend dependency), pytest-asyncio (`asyncio_mode = "auto"`), FastAPI app under test.

**Spec:** `docs/superpowers/specs/2026-10-18-import-inventaire-csv-design.md`

## Global Constraints

- Branch `feat/import-inventaire-csv`, created from `feat/specs-equipement`. The import needs the specs endpoints, which are not merged yet.
- Only existing endpoints; **no backend route or model change**; no SQL.
- Every write goes through the API as a Staff/Admin bearer (`Authorization: Bearer <id_token>`).
- Token only from env var `BPM_TOKEN`, never a CLI argument.
- Default is dry-run; writes need `--apply`, and an interactive `oui` unless `--yes`.
- Never deletes anything.
- French names, messages and report. Code style: ruff (line-length 100, E/F/I/UP/B), comments in French, matching `app/seed.py` and the routers.
- `assets/` is read-only input and is never committed (it stays untracked).
- Ruling (location): the spec suggested `backend/scripts/`. The plan uses `backend/app/import_csv/` so tests import it as `app.import_csv.*` and it runs as `python -m app.import_csv`, the same as `app.seed`. Cost if wrong: a file move.

## Review Focus

1. **Token expired or wrong role mid-run** (401/403): stop with a clear French message saying re-runs are safe, not a traceback. Pinned by `test_erreur_api_arrete_avec_message`.
2. **A dev re-run after units were created**: creates no units, tickets or référentiel rows, and leaves champ values entered in the app untouched. Pinned by `test_reimport_ne_cree_rien` and `test_reimport_garde_valeurs_saisies`.
3. **A modèle whose units were partly created** (crash mid-run): reported as incomplete, with no extra units. Pinned by `test_modele_incomplet_signale`.
4. **Unexpected cell content** (unknown État, non-numeric Poids, comma decimal "12,5"): a listed anomaly, never a silent drop or a crash. Pinned by `test_etat_inconnu_anomalie` and `test_nombre_virgule_et_invalide`.
5. **Dry-run must not write** even when everything is missing. Pinned by `test_dry_run_n_ecrit_rien`.

---

### Task 1: Pure mapping — CSV → Plan

**Files:**
- Create: `backend/app/import_csv/__init__.py` (docstring only)
- Create: `backend/app/import_csv/mapping.py`
- Test: `backend/tests/test_import_csv_mapping.py`

**Interfaces:**
- Produces (used by Tasks 2–3):
```python
@dataclass(frozen=True)
class UnitePrevue:
    statut: str                  # "Fonctionnel" | "En_Panne" | "En_Reparation"
    remarque: str | None
    ticket: str | None           # description_panne, None = pas de ticket
    avancement: str | None       # "En_cours" pour En réparation, sinon None
    source: str                  # "Lights.csv:12", pour le rapport

@dataclass
class ModelePrevu:
    nom: str
    categorie: str
    sous_categorie: str
    specs: dict[str, float | None]   # clés poids, longueur, largeur, hauteur, prix_interne, prix_externe
    connectiques: list[tuple[str, str, int]]   # (connecteur, "entree"|"sortie", quantite)
    unites: list[UnitePrevue]

@dataclass(frozen=True)
class ChampPrevu:
    categorie: str
    sous_categorie: str | None
    nom: str
    type: str                    # "nombre" | "texte" | "choix" | "oui_non"
    unite: str | None
    options: tuple[str, ...]
    ordre: int

@dataclass
class Plan:
    sous_categories: dict[str, list[str]]   # catégorie → sous-catégories (ordre d'apparition)
    connecteurs: list[str]
    champs: list[ChampPrevu]
    modeles: list[ModelePrevu]
    anomalies: list[str]

def lire_dossier(dossier: Path) -> Plan
```
- Constants at the top of `mapping.py`, copied verbatim from the spec's tables:
  - `REMAP_TYPE: dict[tuple[str, str], tuple[str, str]]`: (sheet, Type) → (catégorie, sous-catégorie).
  - `REMAP_NOM: dict[tuple[str, str, str], tuple[str, str]]`: (sheet, Type, Nom) → (catégorie, sous-catégorie), checked first. Needed for the Lights `Crochet` split into Crochet and Omega, and for the three `Cable` modèles.
  - `RENOMMAGES: dict[str, str]`: Bumber 1m, Bumber 0.5m, Pioreer XDJ-XZ, Pieneer DJM 500, Strouke M.
  - `CONNECTIQUES_FORCEES: dict[str, list[tuple[str, str, int]]] = {"Linkcon": [("LinkCon", "entree", 2)]}`, keyed on the final modèle name.
  - `CHAMPS: list[ChampPrevu]`: the spec's 21 lines, expanded to one entry per listed sous-catégorie. `ordre` is the index.
  - `ETATS: dict[str, tuple[str, bool, str | None]]`: État → (statut, ticket?, avancement).
- Catégorie of a sheet = file name minus `"Inventaire BPM - "` and `".csv"`. An unmapped (sheet, Type) keeps (sheet, Type).

- [ ] **Step 1: Write the failing tests** (`tmp_path` CSV fixtures written with `csv.writer`, real sheet headers)

```python
def test_remap_types_et_noms(tmp_path):
    # Lights: Stobe→Strobe, GrandMa→Régie, Adaptateur→Interface DMX,
    # Crochet "Omega pixelblade"→("Accroche","Omega"), Crochet "Crochet EURO"→("Accroche","Crochet")
    # Écrans: Cable/Linkcon→("Câbles","Linkcon écran"), Cable/Ethercon→("Câbles","Ethernet"),
    #         Amplificateur→("Écrans et Mapping","Processeur vidéo"), Bumper→("Accroche","Bumper")
    # Son: Mirco→("Son","Micro"), Cablage→("Son","Stagebox"); Câbles: Boitier élec→("Câbles","Distribution élec")
    plan = lire_dossier(tmp_path)
    assert {(m.nom, m.categorie, m.sous_categorie) for m in plan.modeles} >= {...}  # every case above

def test_renommages(tmp_path):        # "Bumber 1m"→"Bumper 1m", "Strouke M"→"Strike M", "Pieneer DJM 500"→"Pioneer DJM 500"
def test_un_modele_par_nom_une_unite_par_ligne(tmp_path):   # 3 rows of the same Nom → 1 ModelePrevu, len(unites) == 3
def test_connectiques_parsees(tmp_path):
    # Entrées "PowerCon, DMX 3p Male", Sorties "LineCon" →
    assert m.connectiques == [("PowerCon","entree",1),("DMX 3p Male","entree",1),("LineCon","sortie",1)]
    assert plan.connecteurs includes "PowerCon", "DMX 3p Male", "LineCon" and always "LinkCon"
def test_linkcon_forcee(tmp_path):    # modèle "Linkcon" (no Entrées in CSV) → connectiques == [("LinkCon","entree",2)]
def test_specs_longueur_poids(tmp_path):   # Structure Longueur "200" → specs["longueur"] == 200.0; Son Poids "47" → specs["poids"] == 47.0; absent → None
def test_nombre_virgule_et_invalide(tmp_path):  # Poids "12,5" → 12.5; Poids "lourd" → None + one anomaly naming file:line
def test_modele_lignes_divergentes(tmp_path):
    # 2 rows MH-100 with "C13, DMX 3p Male", 1 row with empty Entrées → modèle keeps the C13/DMX connectiques, no anomaly
    # 2 rows with different non-empty Poids → most frequent kept, one anomaly naming the modèle
def test_etats(tmp_path):
    # Bon → ("Fonctionnel", ticket None); blank → "Fonctionnel" + anomaly "État vide";
    # "Cassé" + Remarque "ne s'allume pas" →
    assert u.ticket == "ne s'allume pas\n\nImporté depuis l'inventaire CSV (État : Cassé)."
    assert u.statut == "En_Panne" and u.remarque == "ne s'allume pas"
    # "À réparer" without remarque → ticket == "Importé depuis l'inventaire CSV (État : À réparer)."
    # "En réparation" → statut "En_Reparation", avancement "En_cours", ticket set
def test_etat_inconnu_anomalie(tmp_path):  # État "Perdu?" → row not in any modèle, one anomaly with file:line
def test_champs_des_categories_presentes(tmp_path):
    # only a Lights sheet → plan.champs only Lights entries; "Angle" appears 4× (Beam, Wash, Spot, Par);
    # every champ.sous_categorie is in plan.sous_categories["Lights"] (added if no row uses it)
def test_donnees_reelles_si_presentes():
    # skip unless ../assets/sheet-log/clean exists; 519 unités au total, aucune anomalie hors « État vide »,
    # every CSV row's catégorie in {"Lights","Son","Structure","Câbles","Accroche","Écrans et Mapping","Autre"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && ../.venv/bin/pytest tests/test_import_csv_mapping.py -q`
Expected: FAIL, `ModuleNotFoundError: app.import_csv`.

- [ ] **Step 3: Implement `lire_dossier(dossier: Path) -> Plan` and the constants in `app/import_csv/mapping.py`**

Read with `csv.DictReader(encoding="utf-8")`, process files sorted by name, strip cells. A missing column (for example no Poids in Câbles) means None. Numbers: replace `,` with `.`, then `float`. Merge a modèle's rows: per spec key, keep the most frequent non-None value; for connectiques, keep the most frequent non-empty list. Record an anomaly when two non-empty values differ.

- [ ] **Step 4: Run tests, then lint**

Run: `../.venv/bin/pytest tests/test_import_csv_mapping.py -q && ../.venv/bin/ruff check app/import_csv tests/test_import_csv_mapping.py`
Expected: all pass, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/import_csv backend/tests/test_import_csv_mapping.py
git commit -m "feat(import): lecture et nettoyage de l'inventaire CSV"
```

---

### Task 2: Importer through the API

**Files:**
- Create: `backend/app/import_csv/importeur.py`
- Test: `backend/tests/test_import_csv_api.py`

**Interfaces:**
- Consumes: `Plan`, `ModelePrevu`, `UnitePrevue`, `ChampPrevu`, `lire_dossier` (Task 1).
- Produces (used by Task 3):
```python
class ErreurApi(Exception):
    """Réponse non-2xx : méthode, chemin, statut, corps. Arrête l'import."""
    methode: str; chemin: str; statut: int; corps: str

@dataclass
class Rapport:
    crees: Counter[str]        # clés: categories, sous_categories, champs, connecteurs, modeles, unites, tickets
    existants: Counter[str]    # mêmes clés
    ignores: list[str]         # modèles dont les unités n'ont pas été créées, avec la raison
    anomalies: list[str]       # celles du Plan, recopiées
    def texte(self) -> str     # rapport lisible, en français

async def importer(http: httpx.AsyncClient, plan: Plan, *, appliquer: bool) -> Rapport
```
`http` has `base_url` ending in `/api`, and paths are relative (`"categories"`).

**API sequence, in order:**
1. Read state with `GET categories`, `sous-categories`, `champs-specification`, `connecteurs` and `modeles`. Items are indexed by `nom`, and champs by (categorie_id, sous_categorie_id, nom).
2. Create the missing items with `POST` in this order: catégories, then sous-catégories (`{nom, categorie_id}`), then connecteurs, then champs (`{nom, type, unite, options, categorie_id, sous_categorie_id, ordre}`).
3. For each modèle:
   - Create it with `POST modeles {nom, categorie_id}` if missing. If it exists with a different `categorie_id`, `PATCH modeles/{id} {categorie_id}`.
   - Then `PUT modeles/{id}/specs` with `{sous_categorie_id, **specs, valeurs: {}, connectiques: [{connecteur_id, sens, quantite}]}`. `valeurs` is always `{}`: the PUT leaves unlisted values alone, so values typed in the app survive a re-run.
4. Units:
   - If `nb_unites == len(unites)`, add an entry to `ignores`: `"<nom> : déjà importé (N unités)"`.
   - If `0 < nb_unites != len(unites)`, add `"<nom> : incomplet (N unités sur M prévues), à corriger à la main"` to `ignores` and create nothing.
   - Otherwise: `GET equipments/noms-serie?base=<nom>&nombre=<M>`, then for each unit `POST equipments {nom, type: "standard", modele_id, statut_actuel, remarque, nombre: 1}`.
5. Tickets: `POST tickets {equipment_id, description_panne}`. If `avancement` is set, `PATCH tickets/{id} {avancement}`.

With `appliquer=False`, only GETs are made. Every missing item counts in `crees` (would be created) and nothing is written. A modèle that does not exist yet counts its units and tickets as would-be-created.

- [ ] **Step 1: Write the failing tests**

Fixture `api`: an `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api")`. It sets `app.dependency_overrides[get_db]` to an async generator yielding `db_session` and `app.dependency_overrides[get_current_user]` to the Staff `Membre` of `membre_id`, and clears the overrides in teardown. Test CSVs use a `uuid` suffix in every Nom, because the dev DB may already hold a real import. Sheets are `Inventaire BPM - Lights.csv` with Type `Stobe` and `Inventaire BPM - Son.csv`.

```python
async def test_import_complet(api, tmp_path):
    # 2× f"Eurolite led {s}" (Bon; one "Cassé" + Remarque "ne s'allume pas"), Entrées "PowerCon, DMX 3p Male";
    # 1× f"Sub {s}" Son, Poids "47", État "En réparation"
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)
    # GET modeles?q=... → nb_unites 2 and 1
    # GET modeles/{id}/specs → sous_categorie nom "Strobe", 2 connectiques entree; Sub poids 47
    # GET equipments?modele_id= → names f"Eurolite led {s} 1"/"… 2", statuts {"Fonctionnel","En_Panne"}, remarque set on the broken one
    # GET tickets?statut=tous → one ticket with description "ne s'allume pas\n\nImporté depuis l'inventaire CSV (État : Cassé)."
    #   and one with avancement "En_cours" for the Sub; Sub unit statut "En_Reparation"
    # GET champs-specification → contains Lights "Puissance" and Son "Hauteur rack" scoped to "Rack"
    assert r.crees["unites"] == 3 and r.crees["tickets"] == 2

async def test_reimport_ne_cree_rien(api, tmp_path):
    # import twice → second Rapport: crees sums to 0, ignores lists both modèles "déjà importé"
async def test_reimport_garde_valeurs_saisies(api, tmp_path):
    # import, PUT a value for champ "Puissance" on the Lights modèle (with its current specs), re-import → value still there
async def test_modele_incomplet_signale(api, tmp_path):
    # import 2 rows, then the same Nom with 3 rows → no new unit, ignores contains "incomplet (2 unités sur 3 prévues)"
async def test_dry_run_n_ecrit_rien(api, tmp_path):
    # appliquer=False on fresh names → Rapport.crees["modeles"] == 2, ["unites"] == 3; GET modeles?q=s → []
async def test_erreur_api_arrete_avec_message(api, tmp_path):
    # override get_current_user to raise HTTPException(401) → importer raises ErreurApi(statut=401), message holds the chemin
```

- [ ] **Step 2: Run them to see them fail**

Run: `../.venv/bin/pytest tests/test_import_csv_api.py -q`
Expected: FAIL, `ImportError: importer`.

- [ ] **Step 3: Implement `importeur.py`**

Follow the sequence above. One private helper raises `ErreurApi` on any non-2xx response. `Rapport.texte()` lists, in order: created and existing counts, ignored modèles, anomalies.

- [ ] **Step 4: Run all import tests and ruff**

Run: `../.venv/bin/pytest tests/test_import_csv_mapping.py tests/test_import_csv_api.py -q && ../.venv/bin/ruff check app/import_csv tests`
Expected: all pass, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/import_csv/importeur.py backend/tests/test_import_csv_api.py
git commit -m "feat(import): import de l'inventaire par l'API, rejouable"
```

---

### Task 3: CLI, safety, README, real-data dry-run

**Files:**
- Create: `backend/app/import_csv/__main__.py`
- Modify: `backend/app/import_csv/__init__.py` (module docstring = usage README, including how to get the token)
- Modify: `CLAUDE.md` (one line under Backend commands: `../.venv/bin/python -m app.import_csv --api … [--apply]`)
- Test: `backend/tests/test_import_csv_cli.py`

**Interfaces:**
- Consumes: `lire_dossier` (Task 1), `importer`, `Rapport`, `ErreurApi` (Task 2).
- Produces: `async def principal(argv: list[str], *, entree=input, transport: httpx.AsyncBaseTransport | None = None) -> int`, which returns the exit code. `__main__` runs `sys.exit(asyncio.run(principal(sys.argv[1:])))`.

**Behaviour:**
- Arguments:
  - `--api URL` (required)
  - `--dossier PATH` (default `<repo>/assets/sheet-log/clean`, from `Path(__file__).resolve().parents[3]`)
  - `--apply`
  - `--yes`
- `BPM_TOKEN` missing: print `"BPM_TOKEN manquant : copie l'id_token depuis le navigateur (voir python -m app.import_csv --help)."` and exit 2.
- First call `GET auth/me`. If the role is not Staff or Admin, print `"Compte <email> : rôle <role>, il faut Staff ou Admin."` and exit 2. Otherwise print `"Cible : <api> — connecté en tant que <email> (<role>)"`.
- Dry-run (no `--apply`): run `importer(..., appliquer=False)`, print `Rapport.texte()` followed by `"Simulation : rien n'a été écrit. Relance avec --apply."`, and exit 0.
- `--apply`:
  - First run the dry-run report, then ask `"Écrire dans <api> ? Tape oui pour continuer : "` (skipped with `--yes`).
  - Any answer other than `oui` gives exit 1 with `"Annulé."`.
  - Then run `appliquer=True` and print the report.
- On `ErreurApi`: print `"Erreur API <statut> sur <methode> <chemin> : <corps>"`. For 401, add `"Token expiré ? Ré-exporte BPM_TOKEN et relance : l'import est rejouable."`. Exit 1.
- HTTP timeout 30 s.

- [ ] **Step 1: Write the failing tests** (they reuse the overridden app from Task 2 through the `transport` parameter, with `BPM_TOKEN` set through `monkeypatch`)

```python
async def test_sans_token(monkeypatch, capsys): # code 2, message "BPM_TOKEN manquant"
async def test_role_tech_refuse(...):          # Tech membre → code 2, "il faut Staff ou Admin"
async def test_simulation_par_defaut(...):     # no --apply → code 0, "Simulation : rien n'a été écrit", no modèle created
async def test_apply_annule_sans_oui(...):     # entree returns "non" → code 1, "Annulé.", nothing created
async def test_apply_oui(...):                 # entree returns "oui" → code 0, modèles exist
async def test_401_message_rejouable(...):     # auth override raises 401 → code 1, "l'import est rejouable"
```

- [ ] **Step 2: Run them to see them fail**

Run: `../.venv/bin/pytest tests/test_import_csv_cli.py -q`
Expected: FAIL, `ImportError: principal`.

- [ ] **Step 3: Implement `__main__.py`, the module docstring and the CLAUDE.md line**

The docstring holds:
- Usage (dev, then prod).
- Getting the token: devtools → Application → Local Storage → `oidc.user:<issuer>:<client_id>` → `id_token`, then `export BPM_TOKEN=…`.
- A note that re-runs are safe and nothing is ever deleted.

- [ ] **Step 4: Full verification**

Run: `../.venv/bin/pytest -q && ../.venv/bin/ruff check .`
Expected: all pass (previous 167 plus the new tests), ruff clean.

- [ ] **Step 5: Real-data dry-run against local dev**

With the dev API running (`../.venv/bin/uvicorn app.main:app`), a valid `BPM_TOKEN` and `--api http://localhost:8000/api`, run `../.venv/bin/python -m app.import_csv --api http://localhost:8000/api` without `--apply`.

Expected: about 130 modèles and 519 unités would be created, 7 catégories, tickets for every Cassé / À réparer / En réparation row. The only anomalies should be "État vide". If no token is available in the session, skip this step and say so in the report. Do not run `--apply` on any shared database; that is the user's call.

- [ ] **Step 6: Commit**

```bash
git add backend/app/import_csv backend/tests/test_import_csv_cli.py CLAUDE.md
git commit -m "feat(import): commande python -m app.import_csv (simulation par défaut)"
```
