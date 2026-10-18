import type { Allocation } from "@/lib/types";

export type ChecklistSens = "sortie" | "retour";

/** Garde-fou de profondeur, calé sur le backend (`_DEPTH_GUARD`). */
const DEPTH_GUARD = 32;

/** Valeur courante d'une ligne selon le sens (sortie ou retour). */
export function current(alloc: Allocation, sens: ChecklistSens): number {
  return sens === "sortie" ? alloc.quantite_sortie : alloc.quantite_retournee;
}

/** Objectif d'une ligne : la quantité prévue en sortie, la quantité sortie en retour. */
export function target(alloc: Allocation, sens: ChecklistSens): number {
  return sens === "sortie" ? alloc.quantite : alloc.quantite_sortie;
}

export interface AllocTree {
  /**
   * Allocations à afficher en racine : sans contenant, ou dont le contenant
   * n'est pas dans la liste (filtré/absent → l'enfant remonte en racine pour
   * ne jamais disparaître).
   */
  topLevel: Allocation[];
  /** Descendants transitifs d'une allocation (tout le sous-arbre, hors elle-même). */
  descendantsOf: (alloc: Allocation) => Allocation[];
}

/**
 * Reconstruit l'arbre des allocations à partir de `equipment_contenant_id`.
 * Pur et indépendant de React — partagé par la checklist (rendu) et le scan
 * (pointer un flight entier).
 */
export function buildAllocTree(allocations: Allocation[]): AllocTree {
  // equipment_id → allocation, pour résoudre les contenants.
  const byEquip = new Map<number, Allocation>();
  for (const a of allocations) byEquip.set(a.equipment_id, a);

  // contenant equipment_id → allocations enfants directes.
  const childrenOf = new Map<number, Allocation[]>();
  for (const a of allocations) {
    const cid = a.equipment_contenant_id;
    if (cid == null) continue;
    if (!byEquip.has(cid)) continue; // contenant absent → a est racine
    const arr = childrenOf.get(cid) ?? [];
    arr.push(a);
    childrenOf.set(cid, arr);
  }

  const topLevel = allocations.filter((a) => {
    const cid = a.equipment_contenant_id;
    return cid == null || !byEquip.has(cid);
  });

  function descendantsOf(alloc: Allocation): Allocation[] {
    const out: Allocation[] = [];
    const seen = new Set<number>([alloc.equipment_id]);
    const walk = (equipId: number, depth: number) => {
      if (depth > DEPTH_GUARD) return;
      for (const child of childrenOf.get(equipId) ?? []) {
        if (seen.has(child.equipment_id)) continue; // cycle
        seen.add(child.equipment_id);
        out.push(child);
        walk(child.equipment_id, depth + 1);
      }
    };
    walk(alloc.equipment_id, 0);
    return out;
  }

  return { topLevel, descendantsOf };
}

export interface GroupeModele {
  modeleId: number;
  nom: string;
  marque: string | null;
  /** Toutes les unités du modèle, rangées dans un flight comprises. */
  unites: Allocation[];
}

/**
 * Regroupe par modèle les unités allouées dès qu'un modèle en compte au moins 2.
 * Chaque unité n'apparaît qu'une fois : sous son modèle, y compris si elle est
 * dans un flight (l'écran l'étiquette alors avec son flight). Les locations sont
 * mêlées aux unités BPM du même modèle. Groupes triés par nom de modèle, unités
 * par nom (« MH 2 » avant « MH 10 »).
 */
export function grouperParModele(allocations: Allocation[]): GroupeModele[] {
  const byModele = new Map<number, GroupeModele>();
  for (const a of allocations) {
    if (a.equipment_modele_id == null) continue;
    let g = byModele.get(a.equipment_modele_id);
    if (!g) {
      g = {
        modeleId: a.equipment_modele_id,
        nom: a.equipment_modele_nom ?? "Modèle",
        marque: a.equipment_modele_marque ?? null,
        unites: [],
      };
      byModele.set(a.equipment_modele_id, g);
    }
    g.unites.push(a);
  }
  const nomDe = (a: Allocation) => a.equipment_nom ?? a.equipment_barcode ?? "";
  return [...byModele.values()]
    .filter((g) => g.unites.length >= 2)
    .map((g) => ({
      ...g,
      unites: [...g.unites].sort((x, y) =>
        nomDe(x).localeCompare(nomDe(y), "fr", { numeric: true }),
      ),
    }))
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr", { numeric: true }));
}

export interface FournisseurChip {
  id: number;
  nom: string;
}

/**
 * Prestataires de location distincts présents dans les allocations, triés par
 * nom. Sert à construire une chip de filtre par loueur (sortie/retour/détail) :
 * on pointe le matériel un prestataire à la fois pour ne rien oublier.
 *
 * Le `fournisseur_nom` peut manquer sur un vieux snapshot offline → libellé de
 * repli « Location ».
 */
export function fournisseurChips(allocations: Allocation[]): FournisseurChip[] {
  const byId = new Map<number, string>();
  for (const a of allocations) {
    if (!a.equipment_externe) continue;
    if (a.fournisseur_id == null) continue;
    if (!byId.has(a.fournisseur_id)) {
      byId.set(a.fournisseur_id, a.fournisseur_nom ?? "Location");
    }
  }
  return [...byId.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}
