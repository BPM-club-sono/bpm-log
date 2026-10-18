/** Mode de la barre d'ajout de matériel d'une prestation, mémorisé sur l'appareil.
 *  « modele » (défaut) : par modèle avec stepper −/+ ; « nom » : unité par unité. */

export type ModeRecherche = "modele" | "nom";

const KEY = "bpm.presta_mode_recherche";

export function lireModeRecherche(): ModeRecherche {
  try {
    return localStorage.getItem(KEY) === "nom" ? "nom" : "modele";
  } catch {
    return "modele";
  }
}

export function ecrireModeRecherche(mode: ModeRecherche): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Stockage indisponible (navigation privée…) : le mode ne survit pas, tant pis.
  }
}
