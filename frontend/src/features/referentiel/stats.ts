import { ancetres, descendantsIds } from "@/lib/categories";
import type { Categorie, ChampSpec, Modele } from "@/lib/types";

export interface StatsCategorie {
  /** Sous-catégories directes. */
  enfants: number;
  /** Champs définis sur la catégorie elle-même. */
  champs: number;
  /** Champs applicables : les siens et ceux de tous ses ancêtres. */
  champsTotal: number;
  /** Modèles de la catégorie et de toutes ses descendantes. */
  modeles: number;
}

/** Compteurs de chaque catégorie, calculés sur tout l'arbre. */
export function statsCategories(
  categories: Categorie[],
  champs: ChampSpec[],
  modeles: Modele[],
): Map<number, StatsCategorie> {
  const champsPar = new Map<number, number>();
  for (const c of champs) champsPar.set(c.categorie_id, (champsPar.get(c.categorie_id) ?? 0) + 1);
  const modelesPar = new Map<number, number>();
  for (const m of modeles) {
    if (m.categorie_id != null) {
      modelesPar.set(m.categorie_id, (modelesPar.get(m.categorie_id) ?? 0) + 1);
    }
  }
  const stats = new Map<number, StatsCategorie>();
  for (const cat of categories) {
    let nbModeles = 0;
    for (const id of descendantsIds(categories, cat.id)) nbModeles += modelesPar.get(id) ?? 0;
    stats.set(cat.id, {
      enfants: categories.filter((c) => c.parent_id === cat.id).length,
      champs: champsPar.get(cat.id) ?? 0,
      champsTotal: ancetres(categories, cat.id).reduce(
        (n, a) => n + (champsPar.get(a.id) ?? 0),
        0,
      ),
      modeles: nbModeles,
    });
  }
  return stats;
}
