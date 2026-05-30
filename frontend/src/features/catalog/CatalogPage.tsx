import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Categorie, Emplacement, Equipment } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";

export function CatalogPage() {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [emplacements, setEmplacements] = useState<Emplacement[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [eq, cat, emp] = await Promise.all([
          api<Equipment[]>("/equipments"),
          api<Categorie[]>("/categories"),
          api<Emplacement[]>("/emplacements"),
        ]);
        if (!active) return;
        setEquipments(eq);
        setCategories(cat);
        setEmplacements(emp);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? "Impossible de charger le parc matériel."
            : "Erreur réseau. Réessaie.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const categorieById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.nom])),
    [categories],
  );
  const emplacementById = useMemo(
    () => new Map(emplacements.map((e) => [e.id, e.nom])),
    [emplacements],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return equipments;
    return equipments.filter(
      (e) =>
        e.nom.toLowerCase().includes(q) ||
        e.barcode_uid.toLowerCase().includes(q),
    );
  }, [equipments, query]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Parc matériel</h1>
        <p className="text-sm text-fg-muted">
          {equipments.length} équipement{equipments.length > 1 ? "s" : ""}
        </p>
      </header>

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un nom ou un code-barres…"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
        />
      </div>

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}

      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="inventory_2" className="text-4xl" />
          <p className="text-sm">Aucun équipement trouvé.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-line bg-bg-soft p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.nom}</p>
                  <p className="font-mono text-xs text-fg-muted">{e.barcode_uid}</p>
                </div>
                <StatusBadge statut={e.statut_actuel} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                {e.categorie_id != null && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="category" className="text-sm" />
                    {categorieById.get(e.categorie_id) ?? "—"}
                  </span>
                )}
                {e.emplacement_id != null && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="location_on" className="text-sm" />
                    {emplacementById.get(e.emplacement_id) ?? "—"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
