import type { Emplacement, EquipmentListItem } from "@/lib/types";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

export type RangementMode = "emplacement" | "contenant";

interface RangementFieldProps {
  mode: RangementMode;
  onModeChange: (mode: RangementMode) => void;
  emplacementId: number | "";
  onEmplacementChange: (id: number | "") => void;
  contenantId: number | "";
  onContenantChange: (id: number | "") => void;
  emplacements: Emplacement[];
  /** Flights cibles, déjà filtrés (est_contenant, sans soi-même). */
  flights: EquipmentListItem[];
}

/**
 * Champ « Rangement » : un équipement est à un emplacement fixe OU dans un flight.
 * Toggle segmenté + un seul select affiché à la fois — partagé entre le formulaire
 * de création et le formulaire d'édition de la fiche.
 */
export function RangementField({
  mode,
  onModeChange,
  emplacementId,
  onEmplacementChange,
  contenantId,
  onContenantChange,
  emplacements,
  flights,
}: RangementFieldProps) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-fg-muted">Rangement</span>
      <div className="flex gap-1.5">
        {(["emplacement", "contenant"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "border-fg bg-fg text-bg" : "border-line bg-bg-elev text-fg"
            }`}
          >
            {m === "emplacement" ? "Emplacement" : "Dans un flight"}
          </button>
        ))}
      </div>
      {mode === "emplacement" ? (
        <select
          value={emplacementId}
          onChange={(e) =>
            onEmplacementChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`${inputCls} mt-4`}
        >
          <option value="">—</option>
          {emplacements.map((em) => (
            <option key={em.id} value={em.id}>
              {em.nom}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={contenantId}
          onChange={(e) =>
            onContenantChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`${inputCls} mt-4`}
        >
          <option value="">— choisir un flight —</option>
          {flights.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
