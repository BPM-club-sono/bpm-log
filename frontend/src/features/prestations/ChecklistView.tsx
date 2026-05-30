import { useState } from "react";
import type { Allocation } from "@/lib/types";
import { Icon } from "@/shared/Icon";

export type ChecklistSens = "sortie" | "retour";

interface ChecklistViewProps {
  sens: ChecklistSens;
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

export function ChecklistView({
  sens,
  allocations,
  onDelta,
  onScan,
}: ChecklistViewProps) {
  const [scanInput, setScanInput] = useState("");

  const incomplete = allocations.filter(
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

      <ul className="space-y-2">
        {allocations.map((a) => {
          const val = current(a, sens);
          const tgt = target(a, sens);
          const done = tgt > 0 && val >= tgt;
          return (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-soft p-3"
            >
              <Icon
                name={done ? "check_circle" : "radio_button_unchecked"}
                className={`text-xl ${done ? "text-success" : "text-fg-muted"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
                </p>
                <p
                  className={`text-xs ${done ? "text-success" : "text-fg-muted"}`}
                >
                  {val}/{tgt} {sens === "sortie" ? "sorti" : "retourné"}
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

      {incomplete > 0 ? (
        <p className="text-center text-xs text-fg-muted">
          {incomplete} ligne{incomplete > 1 ? "s" : ""} incomplète
          {incomplete > 1 ? "s" : ""}
        </p>
      ) : (
        <p className="text-center text-xs text-success">
          Tout est {sens === "sortie" ? "sorti" : "retourné"}.
        </p>
      )}
    </div>
  );
}
