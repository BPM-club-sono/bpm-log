import { useState } from "react";
import type { Allocation, TypePrestation } from "@/lib/types";
import { Icon } from "@/shared/Icon";

export type ChecklistSens = "sortie" | "retour";

interface ChecklistViewProps {
  sens: ChecklistSens;
  prestaType: TypePrestation;
  allocations: Allocation[];
  /** Applique un delta unitaire (+1 / -1) sur une ligne. */
  onDelta: (alloc: Allocation, delta: number) => void;
  /** Scan / saisie d'un code-barres : +1 sur la bonne ligne (ou ad-hoc en sortie). */
  onScan: (barcode: string) => void;
}

/** Valeur courante d'une ligne selon le sens (sortie ou retour). */
function current(alloc: Allocation, sens: ChecklistSens): number {
  return sens === "sortie" ? alloc.quantite_sortie : alloc.quantite_retournee;
}

/** Objectif d'une ligne : la quantité prévue en sortie, la quantité sortie en retour. */
function target(alloc: Allocation, sens: ChecklistSens): number {
  return sens === "sortie" ? alloc.quantite : alloc.quantite_sortie;
}

/** Libellé adapté : matériel loué = réception/rendu, matériel BPM = sortie/retour. */
function actionLabel(externe: boolean, sens: ChecklistSens): string {
  if (sens === "sortie") return externe ? "reçu" : "sorti";
  return externe ? "rendu" : "retourné";
}

type Filter = "tous" | "interne" | "location";

export function ChecklistView({
  sens,
  prestaType,
  allocations,
  onDelta,
  onScan,
}: ChecklistViewProps) {
  const [scanInput, setScanInput] = useState("");
  const [filter, setFilter] = useState<Filter>("tous");

  // Presta interne : on ne pointe que le matériel loué (le matériel BPM interne
  // reste listé dans l'onglet Détail, pas dans le flux de réception/rendu).
  const base =
    prestaType === "Interne"
      ? allocations.filter((a) => a.equipment_externe)
      : allocations;

  const hasBoth =
    base.some((a) => a.equipment_externe) && base.some((a) => !a.equipment_externe);

  const visible = base.filter((a) => {
    if (filter === "interne") return !a.equipment_externe;
    if (filter === "location") return a.equipment_externe;
    return true;
  });

  const incomplete = visible.filter(
    (a) => current(a, sens) < target(a, sens),
  ).length;

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = scanInput.trim();
          if (code) onScan(code);
          setScanInput("");
        }}
        className="relative"
      >
        <Icon
          name="qr_code_scanner"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
        <input
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          placeholder="Scanner ou saisir un code-barres (+1)"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 font-mono text-sm outline-none focus:border-fg"
        />
      </form>

      {hasBoth && (
        <div className="flex gap-1.5">
          {(
            [
              ["tous", "Tous"],
              ["interne", "Matériel BPM"],
              ["location", "Location"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "border-fg bg-fg text-bg"
                  : "border-line bg-bg-soft text-fg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ul className="divide-y divide-line">
        {visible.map((a) => {
          const val = current(a, sens);
          const tgt = target(a, sens);
          const done = tgt > 0 && val >= tgt;
          return (
            <li
              key={a.id}
              className="flex items-center gap-3 py-3"
            >
              <Icon
                name={done ? "check_circle" : "radio_button_unchecked"}
                className={`text-xl ${done ? "text-success" : "text-fg-muted"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">
                    {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
                  </span>
                  {a.equipment_externe && (
                    <span className="flex-none rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                      Location
                    </span>
                  )}
                </p>
                <p
                  className={`text-xs ${done ? "text-success" : "text-fg-muted"}`}
                >
                  {val}/{tgt} {actionLabel(!!a.equipment_externe, sens)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDelta(a, -1)}
                  disabled={val <= 0}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg disabled:opacity-30"
                >
                  <Icon name="remove" className="text-lg" />
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">
                  {val}
                </span>
                <button
                  type="button"
                  onClick={() => onDelta(a, +1)}
                  disabled={val >= tgt}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg disabled:opacity-30"
                >
                  <Icon name="add" className="text-lg" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">
          Aucun matériel à pointer ici.
        </p>
      ) : incomplete > 0 ? (
        <p className="text-center text-xs text-fg-muted">
          {incomplete} ligne{incomplete > 1 ? "s" : ""} incomplète
          {incomplete > 1 ? "s" : ""}
        </p>
      ) : (
        <p className="text-center text-xs text-success">Tout est pointé.</p>
      )}
    </div>
  );
}

