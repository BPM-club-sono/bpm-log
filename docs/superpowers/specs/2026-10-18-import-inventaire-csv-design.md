# Import de l'inventaire CSV par l'API — design

## Intent / why

BPM's equipment inventory lives in a legacy Google Sheet, exported and cleaned into
`assets/sheet-log/clean/*.csv` (one row per physical unit, 519 rows, 6 sheets). BPM Log
now has everything needed to hold it (catégories, sous-catégories, champs de
spécification, connecteurs, modèles with specs, units, panne tickets). The goal is a
script that loads the whole sheet into BPM Log **through the backend's REST API** —
not SQL — so every business rule (references/QR codes, series numbering, specs
validation, ticket → statut) is applied exactly as if a Staff member had typed it in.

Workflow (user's): run it **repeatedly against dev** until the result looks right, then
run it **once against prod**, which starts from an **empty inventory**.

## Goals

- One command imports the full référentiel + parc from `assets/sheet-log/clean/`.
- Re-runnable on dev without creating duplicates.
- Applies the cleanup decided below (catégorie reorganisation, renames, typo fixes).
- Creates the empty champs de spécification listed below, so they can be filled in the app.
- Opens panne tickets for broken units.
- Ends with a readable report: what was created, what was skipped, what was odd.

## Non-goals

- Filling champ values (the sheet has none) or prices (the sheet has none).
- Vrac / consommable: **every row is one tracked unit** (user: "nothing in the sheet is vrac").
- Emplacements, flights/contenants, photos, marques.
- Modifying `assets/` (read-only input) or touching the DB directly.
- A UI for the import.

## Anti-goals

- Writing to the DB with SQL, bypassing the API's rules.
- A second dev run doubling the parc.
- Silently dropping a row: any row the script cannot import is listed in the report.
- Running against prod by accident (see Safety).

## Constraints

- Uses only existing endpoints (no new backend route), authenticated like the app:
  bearer = authentik `id_token`. Dev and prod both use authentik.
- Writes need **Staff** (Admin passes). Run it with an Admin/Staff account.
- French domain language for names, messages and the report.
- Endpoints used: `GET/POST /api/categories`, `GET/POST /api/sous-categories`,
  `GET/POST /api/champs-specification`, `GET/POST /api/connecteurs`,
  `GET/POST /api/modeles`, `PATCH /api/modeles/{id}` (catégorie),
  `PUT /api/modeles/{id}/specs`, `POST /api/equipments` (or `/equipments/serie`),
  `GET /api/equipments` (to detect existing units), `POST /api/tickets`,
  `PATCH /api/tickets/{id}`.

## Data mapping (user's decisions)

### Per row

| CSV | BPM Log |
|---|---|
| sheet + Type (after reorganisation below) | Catégorie + Sous-catégorie of the modèle |
| Nom (after renames) | Modèle `nom` (one modèle per distinct Nom) |
| Longueur (cm), Poids (kg) | Modèle specs `longueur`, `poids` |
| Prix inté / exté | Modèle specs (all empty in the sheet today; import if present) |
| Entrées / Sorties | Connectiques of the modèle: one line per listed connecteur, `quantite = 1`, sens `entree` / `sortie` |
| one row | one standard unit of that modèle, auto reference/QR, series-style name `"<Nom> <n>"` |
| Remarque | unit `remarque` |
| État | see État below |

### État

| État | Unit | Ticket |
|---|---|---|
| Bon | Fonctionnel | — |
| Cassé, À réparer | En panne | **open a panne ticket** |
| En réparation (2× MH-110) | En réparation | open a ticket, avancement `En_cours` — *my call* |
| blank (a few Son rows) | Fonctionnel — *my call*, listed in the report | — |

Ticket description (user's): the remarque if any, then an auto note, e.g.
`Une poignée est cassée\n\nImporté depuis l'inventaire CSV (État : À réparer).`

### Connecteurs

Created from the names found in Entrées/Sorties: PowerCon, LineCon, DMX 3p Male,
DMX 3p Femelle, DMX 5p Male, DMX 5p Femelle, XLR Male, XLR Femelle, Speakon, C13,
Jack, PC16 Male, plus **LinkCon** (for the Linkcon écran cable below).

### Catégories and sous-catégories (user-approved cleanup)

Sous-catégorie = CSV "Type" unless remapped here. Every CSV Type ends up as a
sous-catégorie somewhere.

| Catégorie | Sous-catégorie | Source rows |
|---|---|---|
| Lights | Bar, Beam, Wash, Spot, Par, Strobe, Blade, FX, Kiffeur, Light autiste | Lights sheet as-is; `Stobe` → Strobe |
| Lights | Régie | Lights types `Régie`, `Pad`, `GrandMA`, `GrandMa` |
| Lights | Interface DMX | Lights type `Adaptateur` (Entec) |
| Son | Sub, Tête, Monitor, Ampli, Rack, Console, Mixer, Platine, Controleur, Carte son, Pied | Son sheet as-is |
| Son | Micro | Son type `Mirco` |
| Son | Stagebox | Son type `Cablage` |
| Câbles | Linkcon écran | Écrans et Mapping `Cable` / `Linkcon` — modèle connectiques **2× LinkCon, entrée** (user: special cable with two LinkCon inputs) |
| Câbles | Ethernet | Écrans et Mapping `Cable` / `Ethercon` (modèle keeps name "Ethercon") |
| Câbles | Powercon | Écrans et Mapping `Cable` / `Powercon` |
| Câbles | Passe cables | Câbles sheet as-is |
| Câbles | Distribution élec | Câbles type `Boitier élec` |
| Accroche *(new)* | Crochet | Lights `Crochet` rows named Crochet EURO, Crochet pixelblade, Crochet 2R + Écrans `Crochet` |
| Accroche | Omega | Lights `Crochet` rows named Omega pixelblade, omega H Beam 2R |
| Accroche | Manille, Elingue, Bumper | Écrans et Mapping |
| Structure | Prolyte, Praticable, Pied praticable, Embase, Semelle | Structure sheet as-is (Prolyte kept, user) |
| Écrans et Mapping | Écran, Projecteur, Lycra, Controleur, Stockage | as-is |
| Écrans et Mapping | Processeur vidéo | type `Amplificateur` (VX1000) |
| Autre | Échelle, Switch | as-is |

### Modèle renames (user-approved)

| CSV Nom | Modèle |
|---|---|
| Bumber 1m / Bumber 0.5m | Bumper 1m / Bumper 0.5m |
| Pioreer XDJ-XZ | Pioneer XDJ-XZ |
| Pieneer DJM 500 | Pioneer DJM 500 |
| Strouke M | Strike M |

All other CSV names are kept verbatim (user: "keep the names from the CSV").

### Champs de spécification (created empty)

"all" = scoped to the catégorie; otherwise one champ per listed sous-catégorie
(the API scopes a champ to at most one sous-catégorie).

| Catégorie | Champ | Type | Scope |
|---|---|---|---|
| Lights | Puissance | nombre, W | all |
| Lights | Source | choix: LED / Lampe / Laser | all |
| Lights | Canaux DMX | nombre | all |
| Lights | Angle | nombre, ° | Beam, Wash, Spot, Par |
| Lights | Zoom | oui_non | Beam, Wash, Spot |
| Lights | Pixels | nombre | Bar, Blade |
| Son | Puissance | nombre, W | all |
| Son | Amplifié | oui_non | Sub, Tête, Monitor |
| Son | Taille HP | nombre, pouces | Sub, Tête, Monitor |
| Son | Impédance | nombre, Ω | Sub, Tête |
| Son | Canaux | nombre | Ampli, Console, Mixer |
| Son | Hauteur rack | nombre, U | Rack |
| Structure | Section | choix: H30V / H30D | Prolyte |
| Câbles | Ampérage | nombre, A | Distribution élec |
| Câbles | Nb prises | nombre | Distribution élec |
| Accroche | Charge max | nombre, kg | all |
| Écrans et Mapping | Pitch | nombre, mm | Écran |
| Écrans et Mapping | Résolution | texte | Écran, Projecteur |
| Écrans et Mapping | Luminosité | nombre, lumens | Projecteur |
| Écrans et Mapping | Capacité | nombre, Go | Stockage |
| Autre | Ports | nombre | Switch |

## Re-runs / idempotency (my calls)

- Référentiel (catégories, sous-catégories, champs, connecteurs, modèles): **get-or-create
  by name** — read the existing list first, create only what is missing. The modèle's
  catégorie/sous-catégorie and specs are (re)applied with `PUT …/specs` each run, so a
  mapping fix in the script takes effect on the next dev run.
- Units: a modèle that **already has units is skipped entirely** for unit creation and
  reported ("déjà importé : N unités"). A partially imported modèle (crash mid-way) is
  reported as a mismatch for the user to fix by hand — no guessing.
- Champs: identified by (catégorie, sous-catégorie, nom).
- Clean-slate dev runs are done by resetting the dev DB, not by the script (the script never deletes).

## Inconsistencies in the data (my calls)

- Modèle specs come from its rows; if rows of one modèle disagree, take the most
  complete row and list the disagreement in the report. Known case: one MH-100 row
  has no connectors → the modèle gets the connectors of the other five.
- Names are whitespace-trimmed (already done by the cleaner).

## Safety (my calls)

- `--dry-run` (default when no `--apply`): parses, applies the mapping, and prints the
  plan (counts per catégorie / sous-catégorie / modèle, tickets to open, anomalies)
  without any write. Read calls are allowed so it can show what already exists.
- Target URL is a required argument (`--api https://…/api`); token from env var
  `BPM_TOKEN` (never a CLI arg, so it doesn't land in shell history).
- Before writing, the script prints the target URL and the counts and asks for `oui`
  unless `--yes`.
- Stops on the first unexpected API error (non-2xx other than a handled 409), printing
  the request and response, so a dev run surfaces problems immediately.

## Getting the token (for the README of the script)

Log into the app as Staff/Admin, open devtools → Application → Local Storage → key
`oidc.user:<issuer>:<client_id>` → copy `id_token`, then
`export BPM_TOKEN=…`. The id_token's lifetime is set by authentik; if it expires
mid-run (401), re-export and re-run — re-runs are safe.

## Left to the builder

- Language/location: Python, in `backend/scripts/` (backend deps already include
  `httpx`), run with the repo venv. The mapping tables above live as plain data at
  the top of the script or in a sibling module.
- Unit creation per row (`POST /equipments` with a computed name) vs. grouped
  `/equipments/serie` calls — either, as long as names are series-style and each unit
  gets its own statut/remarque.
- Report format (stdout text is enough).
- Tests: unit tests for the pure mapping (row → catégorie/sous-cat/modèle/statut,
  connector parsing, renames, MH-100 merge); one integration test that runs the
  import against the test API/DB (pytest `client` fixture or the e2e stack) on a
  small fixture CSV and checks a re-run creates nothing.
