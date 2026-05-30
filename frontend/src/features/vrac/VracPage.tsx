import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { VracCaisse } from "@/lib/types";
import { Icon } from "@/shared/Icon";

function ecartStyle(ecart: number): string {
  if (ecart === 0) return "text-fg-muted";
  return ecart > 0 ? "text-success" : "text-danger";
}

/** Liste des caisses vrac avec quantité actuelle et statut de verrou. */
export function VracPage() {
  const [items, setItems] = useState<VracCaisse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<VracCaisse[]>("/vrac");
        if (active) setItems(data);
      } catch (err) {
        if (active)
          setError(
            err instanceof ApiError
              ? "Impossible de charger les caisses."
              : "Erreur réseau.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Inventaire vrac</h1>
        <p className="text-sm text-fg-muted">
          {items.length} caisse{items.length > 1 ? "s" : ""}
        </p>
      </header>

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.equipment_id}>
              <Link
                to={`/vrac/${c.equipment_id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-soft p-3 transition-colors hover:bg-bg-elev"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.nom}</p>
                  <p className="text-xs text-fg-muted">
                    {c.quantite_actuelle} / {c.quantite_theorique} théorique ·{" "}
                    <span className={ecartStyle(c.ecart)}>
                      {c.ecart > 0 ? `+${c.ecart}` : c.ecart} d'écart
                    </span>
                  </p>
                </div>
                {c.lock && (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      c.lock.is_mine
                        ? "bg-fg text-bg"
                        : "bg-bg-elev text-fg-muted"
                    }`}
                  >
                    <Icon name="lock" className="text-sm" />
                    {c.lock.is_mine ? "Moi" : c.lock.membre_nom ?? "Verrouillé"}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-12 text-center text-sm text-fg-muted">
              Aucune caisse vrac.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
