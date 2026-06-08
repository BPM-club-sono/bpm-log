import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { ContenuChild, Emplacement, EquipmentListItem } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";

/**
 * Explorateur arborescent du rangement : emplacements imbriqués → contenants →
 * items. Les emplacements et les items racine sont chargés au montage ; le
 * contenu d'un contenant est chargé à la volée lors du dépliage.
 */
export function ExplorerPage() {
  const [emplacements, setEmplacements] = useState<Emplacement[]>([]);
  const [racine, setRacine] = useState<EquipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-danger">{error}</p>;
  }

  const roots = emplacements.filter((e) => e.parent_id == null);
  // Items racine sans emplacement (ni contenant) : regroupés à part.
  const orphelins = racine.filter((e) => e.emplacement_id == null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Rangement</h1>
        <Link to="/inventaire" className="text-sm text-fg-muted underline">
          Vue liste
        </Link>
      </div>

      <div className="space-y-1">
        {roots.map((emp) => (
          <EmplacementNode
            key={emp.id}
            emp={emp}
            allEmplacements={emplacements}
            racine={racine}
            depth={0}
          />
        ))}
        {orphelins.length > 0 && (
          <div className="pt-2">
            <p className="px-1 py-1 text-xs uppercase tracking-wide text-fg-muted">
              Sans emplacement
            </p>
            {orphelins.map((eq) => (
              <EqNode key={eq.id} eq={eq} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmplacementNode({
  emp,
  allEmplacements,
  racine,
  depth,
}: {
  emp: Emplacement;
  allEmplacements: Emplacement[];
  racine: EquipmentListItem[];
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = allEmplacements.filter((e) => e.parent_id === emp.id);
  const items = racine.filter((e) => e.emplacement_id === emp.id);
  const count = items.length + children.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-bg-soft"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <Icon
          name={open ? "expand_more" : "chevron_right"}
          className="flex-none text-base text-fg-muted"
        />
        <Icon name="warehouse" className="flex-none text-base text-fg-muted" />
        <span className="flex-1 truncate text-sm font-medium">{emp.nom}</span>
        <span className="flex-none text-xs text-fg-muted">{count}</span>
      </button>
      {open && (
        <div>
          {children.map((c) => (
            <EmplacementNode
              key={c.id}
              emp={c}
              allEmplacements={allEmplacements}
              racine={racine}
              depth={depth + 1}
            />
          ))}
          {items.map((eq) => (
            <EqNode key={eq.id} eq={eq} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface EqLike {
  id: number;
  nom: string;
  barcode_uid: string;
  statut_actuel: ContenuChild["statut_actuel"];
  est_contenant?: boolean;
}

function EqNode({ eq, depth }: { eq: EqLike; depth: number }) {
  const [open, setOpen] = useState(false);
  const [contenu, setContenu] = useState<ContenuChild[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!eq.est_contenant) return;
    const next = !open;
    setOpen(next);
    if (next && contenu === null) {
      setLoading(true);
      try {
        setContenu(await api<ContenuChild[]>(`/equipments/${eq.id}/contenu`));
      } catch {
        setContenu([]);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-bg-soft"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {eq.est_contenant ? (
          <button type="button" onClick={() => void toggle()} className="flex-none">
            <Icon
              name={open ? "expand_more" : "chevron_right"}
              className="text-base text-fg-muted"
            />
          </button>
        ) : (
          <span className="w-4 flex-none" />
        )}
        <Icon
          name={eq.est_contenant ? "inventory_2" : "label"}
          className="flex-none text-base text-fg-muted"
        />
        <Link to={`/inventaire/${eq.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{eq.nom}</p>
          <p className="truncate font-mono text-xs text-fg-muted">{eq.barcode_uid}</p>
        </Link>
        <StatusBadge statut={eq.statut_actuel} />
      </div>
      {open && (
        <div>
          {loading && (
            <p
              className="px-2 py-1 text-xs text-fg-muted"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Chargement…
            </p>
          )}
          {contenu?.map((c) => (
            <EqNode key={c.id} eq={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
