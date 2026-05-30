import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { syncEngine } from "@/lib/syncEngine";
import type { Consommable } from "@/lib/types";
import { Icon } from "@/shared/Icon";

/** Réappro / consommation d'un stock par deltas unitaires (offline-first). */
export function ConsommablesPage() {
  const [items, setItems] = useState<Consommable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<Consommable[]>("/consommables"));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "Impossible de charger les consommables."
          : "Erreur réseau.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function applyDelta(item: Consommable, delta: number) {
    const next = Math.max(0, item.stock_actuel + delta);
    if (next === item.stock_actuel) return;
    setItems((prev) =>
      prev.map((c) =>
        c.equipment_id === item.equipment_id
          ? { ...c, stock_actuel: next, en_alerte: next <= c.seuil_alerte }
          : c,
      ),
    );
    await syncEngine.enqueue("conso_delta", {
      equipment_id: item.equipment_id,
      delta,
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.nom.toLowerCase().includes(q) ||
        c.barcode_uid.toLowerCase().includes(q),
    );
  }, [items, query]);

  const alertes = items.filter((c) => c.en_alerte).length;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Consommables</h1>
        <p className="text-sm text-fg-muted">
          {items.length} référence{items.length > 1 ? "s" : ""}
          {alertes > 0 && (
            <span className="text-danger"> · {alertes} sous le seuil</span>
          )}
        </p>
      </header>

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
        />
      </div>

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li
              key={c.equipment_id}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-soft p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.nom}</p>
                <p className="text-xs text-fg-muted">
                  <span
                    className={`font-semibold tabular-nums ${c.en_alerte ? "text-danger" : "text-fg"}`}
                  >
                    {c.stock_actuel}
                  </span>
                  {c.unite ? ` ${c.unite}` : ""} · seuil {c.seuil_alerte}
                  {c.en_alerte && (
                    <span className="ml-1 font-medium text-danger">⚠ à réappro</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyDelta(c, -1)}
                  disabled={c.stock_actuel <= 0}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg disabled:opacity-30"
                >
                  <Icon name="remove" className="text-lg" />
                </button>
                <span className="w-7 text-center text-sm font-semibold tabular-nums">
                  {c.stock_actuel}
                </span>
                <button
                  type="button"
                  onClick={() => void applyDelta(c, +1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg"
                >
                  <Icon name="add" className="text-lg" />
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-12 text-center text-sm text-fg-muted">
              Aucun consommable.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
