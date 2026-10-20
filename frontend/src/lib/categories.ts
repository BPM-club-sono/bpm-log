import type { Categorie } from "./types";

/** Séparateur du chemin d'une catégorie, identique à celui de l'API. */
export const SEPARATEUR = " › ";

const parNom = (a: Categorie, b: Categorie) => a.nom.localeCompare(b.nom);

/** Enfants directs de `parentId` (null = racines), triés par nom. */
export function enfants(cats: Categorie[], parentId: number | null): Categorie[] {
  return cats.filter((c) => c.parent_id === parentId).sort(parNom);
}

/** La catégorie et ses ancêtres, de la racine à elle-même. */
export function ancetres(cats: Categorie[], id: number): Categorie[] {
  const parId = new Map(cats.map((c) => [c.id, c]));
  const lignee: Categorie[] = [];
  const vues = new Set<number>();
  for (let c = parId.get(id); c && !vues.has(c.id); c = parId.get(c.parent_id ?? NaN)) {
    vues.add(c.id);
    lignee.unshift(c);
  }
  return lignee;
}

/** La catégorie et toutes ses descendantes, à toute profondeur. */
export function descendantsIds(cats: Categorie[], id: number): Set<number> {
  const ids = new Set([id]);
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const c of cats) {
      if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        ajout = true;
      }
    }
  }
  return ids;
}

/** Chemin « Son › Ampli », recalculé localement si l'API ne l'a pas fourni. */
export function cheminDe(cats: Categorie[], id: number): string {
  const c = cats.find((x) => x.id === id);
  return c?.chemin ?? ancetres(cats, id).map((a) => a.nom).join(SEPARATEUR);
}

/** Toutes les catégories en ordre d'arbre (parent puis ses enfants), avec leur niveau. */
export function enArbre(cats: Categorie[]): { categorie: Categorie; niveau: number }[] {
  const lignes: { categorie: Categorie; niveau: number }[] = [];
  const ids = new Set(cats.map((c) => c.id));
  const visiter = (parentId: number | null, niveau: number) => {
    for (const c of enfants(cats, parentId)) {
      lignes.push({ categorie: c, niveau });
      visiter(c.id, niveau + 1);
    }
  };
  visiter(null, 0);
  // Parent absent de la liste (ne devrait pas arriver) : rangée comme racine.
  for (const c of cats.filter((x) => x.parent_id !== null && !ids.has(x.parent_id)).sort(parNom)) {
    lignes.push({ categorie: c, niveau: 0 });
    visiter(c.id, 1);
  }
  return lignes;
}
