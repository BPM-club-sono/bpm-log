import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ModeleDispo } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { useToast } from "@/shared/Toast";

const DEBOUNCE_MS = 300;

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

const rowKey = (r: ModeleDispo) => `${r.modele_id}:${r.fournisseur_id ?? "bpm"}`;

interface ModeleSearchProps {
  prestaId: number;
  value: string;
  onChange: (value: string) => void;
  /** Change quand les allocations bougent ailleurs : les compteurs sont relus. */
  version: string;
  /** Appelé après chaque « + » / « − » (recharger les allocations). */
  onChanged: () => Promise<void>;
  onToggleMode: () => void;
}

/** Ajout par modèle : « MH-100 · 4/6 dispo · [−] 2 [+] ». Le serveur choisit
 *  l'unité, refuse les HS et celles déjà prises sur une prestation qui chevauche.
 *  Champ vide : les modèles déjà présents dans la prestation.
 *
 *  En ligne seulement (les compteurs sont l'état du serveur à l'instant T). */
export function ModeleSearch({
  prestaId,
  value,
  onChange,
  version,
  onChanged,
  onToggleMode,
}: ModeleSearchProps) {
  const { toast } = useToast();
  const online = useOnline();
  const [rows, setRows] = useState<ModeleDispo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const q = value.trim();

  useEffect(() => {
    if (!online) {
      setRows([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(
      async () => {
        try {
          const r = await api<ModeleDispo[]>(
            `/prestations/${prestaId}/modeles${q ? `?q=${encodeURIComponent(q)}` : ""}`,
          );
          if (!stale) setRows(r);
        } catch {
          if (!stale) setRows([]);
        }
      },
      q ? DEBOUNCE_MS : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [prestaId, q, online, version]);

  async function step(row: ModeleDispo, sens: "ajout" | "retrait") {
    setBusy(rowKey(row));
    try {
      const updated = await api<ModeleDispo>(
        `/prestations/${prestaId}/modeles/${row.modele_id}/${sens}`,
        { method: "POST", body: { fournisseur_id: row.fournisseur_id } },
      );
      setRows((prev) => prev.map((r) => (rowKey(r) === rowKey(row) ? updated : r)));
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <SearchInput
        value={value}
        onChange={onChange}
        placeholder="Modèle… (MH-100)"
        disabled={!online}
        icon="category"
        onIconClick={onToggleMode}
        iconLabel="Passer à la recherche par nom"
      />
      {!online && (
        <p className="text-xs text-fg-muted">Ajout par modèle disponible en ligne.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-soft">
          {rows.map((r) => {
            const key = rowKey(r);
            const pending = busy === key;
            return (
              <li
                key={key}
                data-testid={`modele-${r.nom}${r.fournisseur_nom ? ` · ${r.fournisseur_nom}` : ""}`}
                className="flex items-center gap-2 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {r.nom}
                    {r.fournisseur_nom && (
                      <span className="flex-none rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        {r.fournisseur_nom}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {r.marque ? `${r.marque} · ` : ""}
                    {r.dispo}/{r.total} dispo
                  </p>
                </div>
                {r.alloues > 0 && (
                  <button
                    type="button"
                    onClick={() => void step(r, "retrait")}
                    disabled={pending || !r.retirable}
                    aria-label={`Retirer un ${r.nom}`}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line disabled:opacity-40"
                  >
                    <Icon name="remove" className="text-lg" />
                  </button>
                )}
                {r.alloues > 0 && (
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">
                    {r.alloues}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void step(r, "ajout")}
                  disabled={pending || r.dispo === 0}
                  aria-label={`Ajouter un ${r.nom}`}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-bg-elev disabled:opacity-40"
                >
                  <Icon name="add" className="text-lg" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {online && q && rows.length === 0 && (
        <p className="text-xs text-fg-muted">
          Aucun modèle « {q} ». Les objets sans modèle se trouvent par nom (touche
          l'icône à gauche).
        </p>
      )}
    </div>
  );
}
