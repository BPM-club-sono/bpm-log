import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { ContenuChild, Emplacement, EquipmentListItem } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";

/**
 * Explorateur du rangement en navigation par niveaux (drill-down).
 *
 * Plutôt qu'un arbre indenté qui pousse tout vers la droite (illisible sur
 * mobile dès 3-4 niveaux), on n'affiche qu'un seul niveau à la fois sur toute
 * la largeur : taper un emplacement ou un contenant descend dedans, le fil
 * d'Ariane en haut permet de remonter. Les emplacements et items racine sont
 * chargés au montage ; le contenu d'un contenant est chargé à la volée.
 */

type Frame =
  | { kind: "emplacement"; id: number; nom: string }
  | { kind: "contenant"; id: number; nom: string };

interface EqLike {
  id: number;
  nom: string;
  barcode_uid: string;
  statut_actuel: ContenuChild["statut_actuel"];
  est_contenant?: boolean;
  photo_url?: string | null;
}

/** Vignette carrée façon Parc : photo si dispo, sinon icône. */
function Tile({ photo, icon }: { photo?: string | null; icon: string }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
      />
    );
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
      <Icon name={icon} className="text-xl" />
    </div>
  );
}

export function ExplorerPage() {
  const [emplacements, setEmplacements] = useState<Emplacement[]>([]);
  const [racine, setRacine] = useState<EquipmentListItem[]>([]);
  const [contenuCache, setContenuCache] = useState<Record<number, ContenuChild[]>>(
    {},
  );
  const [path, setPath] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingContenu, setLoadingContenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [emp, eqs] = await Promise.all([
          api<Emplacement[]>("/emplacements"),
          api<EquipmentListItem[]>("/equipments?racine=true"),
        ]);
        setEmplacements(emp);
        setRacine(eqs);
        setError(null);
      } catch {
        setError("Impossible de charger l'arborescence.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = path[path.length - 1] ?? null;
  const currentKind = current?.kind;
  const currentId = current?.id;

  // Contenu d'un contenant : chargé à la volée la première fois qu'on y entre.
  useEffect(() => {
    if (currentKind !== "contenant" || currentId == null) return;
    if (contenuCache[currentId]) return;
    let cancelled = false;
    setLoadingContenu(true);
    void api<ContenuChild[]>(`/equipments/${currentId}/contenu`)
      .then((c) => {
        if (!cancelled) setContenuCache((m) => ({ ...m, [currentId]: c }));
      })
      .catch(() => {
        if (!cancelled) setContenuCache((m) => ({ ...m, [currentId]: [] }));
      })
      .finally(() => {
        if (!cancelled) setLoadingContenu(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentKind, currentId, contenuCache]);

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-danger">{error}</p>;
  }

  // Contenu du niveau courant.
  let childEmplacements: Emplacement[] = [];
  let items: EqLike[] = [];
  if (current == null) {
    childEmplacements = emplacements.filter((e) => e.parent_id == null);
    items = racine.filter((e) => e.emplacement_id == null && e.contenant_id == null);
  } else if (current.kind === "emplacement") {
    childEmplacements = emplacements.filter((e) => e.parent_id === current.id);
    items = racine.filter((e) => e.emplacement_id === current.id);
  } else {
    items = contenuCache[current.id] ?? [];
  }

  function empCount(empId: number): number {
    const subEmp = emplacements.filter((e) => e.parent_id === empId).length;
    const subItems = racine.filter((e) => e.emplacement_id === empId).length;
    return subEmp + subItems;
  }

  const empty =
    childEmplacements.length === 0 &&
    items.length === 0 &&
    !(currentKind === "contenant" && loadingContenu);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Rangement</h1>
        <Link to="/inventaire" className="text-sm text-fg-muted hover:text-fg">
          Vue liste
        </Link>
      </div>

      {/* Fil d'Ariane : remonter en tapant un segment. */}
      <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1 text-sm">
        <button
          type="button"
          onClick={() => setPath([])}
          className={`flex flex-none items-center gap-1 rounded-lg px-2 py-1 ${
            current == null ? "font-semibold text-fg" : "text-fg-muted hover:bg-bg-soft"
          }`}
        >
          <Icon name="home" className="text-base" />
          Rangement
        </button>
        {path.map((frame, i) => {
          const last = i === path.length - 1;
          return (
            <span key={`${frame.kind}-${frame.id}`} className="flex flex-none items-center">
              <Icon name="chevron_right" className="text-base text-fg-muted" />
              <button
                type="button"
                onClick={() => setPath((p) => p.slice(0, i + 1))}
                className={`rounded-lg px-2 py-1 ${
                  last ? "font-semibold text-fg" : "text-fg-muted hover:bg-bg-soft"
                }`}
              >
                {frame.nom}
              </button>
            </span>
          );
        })}
      </nav>

      {/* Contenant courant : accès direct à sa fiche. */}
      {current?.kind === "contenant" && (
        <Link
          to={`/inventaire/${current.id}`}
          className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        >
          <Icon name="open_in_new" className="text-base" />
          Ouvrir la fiche de {current.nom}
        </Link>
      )}

      <ul className="divide-y divide-line">
        {childEmplacements.map((emp) => (
          <li key={`emp-${emp.id}`}>
            <button
              type="button"
              onClick={() =>
                setPath((p) => [...p, { kind: "emplacement", id: emp.id, nom: emp.nom }])
              }
              className="flex w-full items-center gap-3.5 py-4 text-left transition-opacity hover:opacity-70"
            >
              <Tile icon="warehouse" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{emp.nom}</p>
                <p className="text-xs text-fg-muted">
                  {empCount(emp.id)} élément{empCount(emp.id) > 1 ? "s" : ""}
                </p>
              </div>
              <Icon name="chevron_right" className="flex-none text-xl text-fg-muted" />
            </button>
          </li>
        ))}

        {items.map((eq) => {
          const cached = contenuCache[eq.id];
          if (eq.est_contenant) {
            return (
              <li key={`eq-${eq.id}`}>
                <button
                  type="button"
                  onClick={() =>
                    setPath((p) => [...p, { kind: "contenant", id: eq.id, nom: eq.nom }])
                  }
                  className="flex w-full items-center gap-3.5 py-4 text-left transition-opacity hover:opacity-70"
                >
                  <Tile photo={eq.photo_url} icon="inventory_2" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium">{eq.nom}</p>
                      <StatusBadge statut={eq.statut_actuel} />
                    </div>
                    <p className="truncate font-mono text-xs text-fg-muted">
                      {eq.barcode_uid}
                    </p>
                    {cached != null && (
                      <p className="mt-1 text-xs text-fg-muted">
                        {cached.length} élément{cached.length > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                  <Icon name="chevron_right" className="flex-none text-xl text-fg-muted" />
                </button>
              </li>
            );
          }
          return (
            <li key={`eq-${eq.id}`}>
              <Link
                to={`/inventaire/${eq.id}`}
                className="flex gap-3.5 py-4 transition-opacity hover:opacity-70"
              >
                <Tile photo={eq.photo_url} icon="label" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{eq.nom}</p>
                    <StatusBadge statut={eq.statut_actuel} />
                  </div>
                  <p className="truncate font-mono text-xs text-fg-muted">
                    {eq.barcode_uid}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {currentKind === "contenant" && loadingContenu && (
        <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>
      )}

      {empty && (
        <p className="py-8 text-center text-sm text-fg-muted">
          {current?.kind === "contenant" ? "Ce contenant est vide." : "Rien rangé ici."}
        </p>
      )}
    </div>
  );
}
