import { useState } from "react";
import type { Allocation, TypePrestation } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import {
  buildAllocTree,
  current,
  fournisseurChips,
  target,
  type ChecklistSens,
} from "./prestationTree";

export type { ChecklistSens };

interface ChecklistViewProps {
  sens: ChecklistSens;
  prestaType: TypePrestation;
  allocations: Allocation[];
  /** Applique un delta unitaire (+1 / -1) sur une ligne. */
  onDelta: (alloc: Allocation, delta: number) => void;
  /** Scan / saisie d'un code-barres : +1 sur la bonne ligne (ou ad-hoc en sortie). */
  onScan: (barcode: string) => void;
}

/** Libellé adapté : matériel loué = réception/rendu, matériel BPM = sortie/retour. */
function actionLabel(externe: boolean, sens: ChecklistSens): string {
  if (sens === "sortie") return externe ? "reçu" : "sorti";
  return externe ? "rendu" : "retourné";
}

/** Verbe d'action pour le bouton « pointer tout le flight ». */
function flightVerb(externe: boolean, sens: ChecklistSens): string {
  if (sens === "sortie") return externe ? "Recevoir" : "Sortir";
  return externe ? "Rendre" : "Retourner";
}

// "tous" | "interne" (matériel BPM) | String(fournisseur_id) (un loueur précis).
type Filter = string;

export function ChecklistView({
  sens,
  prestaType,
  allocations,
  onDelta,
  onScan,
}: ChecklistViewProps) {
  const [scanInput, setScanInput] = useState("");
  const [filter, setFilter] = useState<Filter>("tous");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Presta interne : on ne pointe que le matériel loué (le matériel BPM interne
  // reste listé dans l'onglet Détail, pas dans le flux de réception/rendu).
  const base =
    prestaType === "Interne"
      ? allocations.filter((a) => a.equipment_externe)
      : allocations;

  // Chips de filtre : Tous, Matériel BPM (si présent), puis un chip par loueur.
  const hasInterne = base.some((a) => !a.equipment_externe);
  const chips = fournisseurChips(base);
  const filterGroups: [Filter, string][] = [["tous", "Tous"]];
  if (hasInterne) filterGroups.push(["interne", "Matériel BPM"]);
  for (const c of chips) filterGroups.push([String(c.id), c.nom]);

  const visible = base.filter((a) => {
    if (filter === "tous") return true;
    if (filter === "interne") return !a.equipment_externe;
    return a.equipment_externe && String(a.fournisseur_id) === filter;
  });

  // Arbre des contenants : un flight est affiché en une seule ligne ; ses
  // articles ne sont visibles qu'en dépliant la ligne (gestion des manquants).
  const { topLevel, descendantsOf } = buildAllocTree(visible);

  // Comptage par « unité » : un flight = 1 unité (incomplète si une ligne de son
  // sous-arbre est sous l'objectif), un article seul = 1 unité.
  const incomplete = topLevel.filter((a) => {
    const lines = [a, ...descendantsOf(a)];
    return lines.some((l) => current(l, sens) < target(l, sens));
  }).length;

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Pointe (full=false) ou dé-pointe (full=true) toutes les lignes d'un flight. */
  function toggleFlight(lines: Allocation[], full: boolean) {
    for (const l of lines) {
      if (full) {
        const cur = current(l, sens);
        if (cur > 0) onDelta(l, -cur);
      } else {
        const remaining = target(l, sens) - current(l, sens);
        if (remaining > 0) onDelta(l, remaining);
      }
    }
  }

  function renderRow(a: Allocation, nested: boolean) {
    const val = current(a, sens);
    const tgt = target(a, sens);
    const done = tgt > 0 && val >= tgt;
    return (
      <li
        key={a.id}
        className={`flex items-center gap-3 py-3 ${nested ? "pl-6" : ""}`}
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
          <p className={`text-xs ${done ? "text-success" : "text-fg-muted"}`}>
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
  }

  function renderFlightRow(flight: Allocation, descendants: Allocation[]) {
    const lines = [flight, ...descendants]; // toggleFlight point/dé-point tout
    const articles = descendants; // les vrais articles, sans le flight
    const articlesTotal = articles.length;
    const articlesDone = articles.filter(
      (l) => current(l, sens) >= target(l, sens),
    ).length;
    const allArticlesDone = articlesDone === articlesTotal;
    const flightDone = current(flight, sens) >= target(flight, sens);
    const isOpen = expanded.has(flight.id);
    const isFull = allArticlesDone && flightDone; // complet = articles + flight

    // 4 états : vide / partiel (carré orange) / articles OK mais flight pas
    // sorti (rond orange) / complet (vert).
    const stateIcon =
      articlesDone === 0 && !flightDone
        ? { name: "radio_button_unchecked", filled: false, cls: "text-fg-muted" }
        : !allArticlesDone
          ? { name: "indeterminate_check_box", filled: false, cls: "text-warning" }
          : !flightDone
            ? { name: "circle", filled: true, cls: "text-warning" }
            : { name: "check_circle", filled: false, cls: "text-success" };

    return (
      <li key={`flight-${flight.id}`} className="py-1">
        <div className="flex items-center gap-3 py-2">
          <Icon
            name={stateIcon.name}
            filled={stateIcon.filled}
            className={`flex-none text-xl ${stateIcon.cls}`}
          />
          <button
            type="button"
            onClick={() => toggleExpanded(flight.id)}
            className="flex flex-none items-center justify-center rounded-lg text-fg-muted hover:text-fg"
            aria-label={isOpen ? "Replier le flight" : "Déplier le flight"}
          >
            <Icon name="inventory_2" filled={!isOpen} className="text-xl" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              <span className="truncate">
                {flight.equipment_nom ?? flight.equipment_barcode ?? `#${flight.equipment_id}`}
              </span>
              {flight.equipment_externe && (
                <span className="flex-none rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                  Location
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              {articlesTotal} article{articlesTotal > 1 ? "s" : ""}
              {articlesDone > 0 && !allArticlesDone && (
                <span className="ml-1.5 font-semibold text-warning">
                  {articlesDone}/{articlesTotal}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleFlight(lines, isFull)}
            className={`flex-none rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              isFull
                ? "border-line text-fg-muted hover:text-fg"
                : "border-fg bg-fg text-bg"
            }`}
          >
            {isFull ? "Annuler" : flightVerb(!!flight.equipment_externe, sens)}
          </button>
        </div>
        {isOpen && (
          <ul className="divide-y divide-line border-t border-line">
            {descendants.map((c) => renderRow(c, true))}
          </ul>
        )}
      </li>
    );
  }

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

      {filterGroups.length > 2 && (
        <div className="flex flex-wrap gap-1.5">
          {filterGroups.map(([f, label]) => (
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
        {topLevel.map((a) => {
          const descendants = descendantsOf(a);
          if (descendants.length === 0) return renderRow(a, false);
          return renderFlightRow(a, descendants);
        })}
      </ul>

      {topLevel.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">
          Aucun matériel à pointer ici.
        </p>
      ) : incomplete > 0 ? (
        <p className="text-center text-xs text-fg-muted">
          {incomplete} élément{incomplete > 1 ? "s" : ""} incomplet
          {incomplete > 1 ? "s" : ""}
        </p>
      ) : (
        <p className="text-center text-xs text-success">Tout est pointé.</p>
      )}
    </div>
  );
}
