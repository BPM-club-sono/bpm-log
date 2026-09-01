/** Format des références matériel (le contenu des QR codes).
 *
 *  Miroir de `backend/app/services/barcode.py` — le serveur reste l'autorité,
 *  ces règles ne servent qu'à guider la saisie et à normaliser ce qu'on lui
 *  envoie.
 *
 *  Contrainte d'origine : les QR sont générés en correction d'erreur **H** pour
 *  résister à l'usure, et doivent rester en **version 1** pour ne pas grossir.
 *  Un QR v1 en H tient exactement **10 caractères** en mode alphanumérique, et
 *  ce mode n'accepte pas les minuscules — d'où `PPP-NNNNNN`, en majuscules.
 */

/** Trigramme du parc interne. */
export const PREFIXE_INTERNE = "BPM";
/** Repli pour du matériel loué chez un fournisseur sans trigramme. */
export const PREFIXE_EXTERNE = "EXT";

/** Longueur de la partie numérique. */
export const LONGUEUR_NUMERO = 6;

const RE_REFERENCE = /^[A-Z]{3}-[0-9]{6}$/;
const RE_TRIGRAMME = /^[A-Z]{3}$/;

/** Met une saisie en forme canonique : sans espaces superflus, en majuscules.
 *
 *  `toUpperCase` et non `toLocaleUpperCase` : en locale turque, ce dernier
 *  transforme `i` en `İ` et casserait la correspondance avec le serveur.
 */
export function normaliser(code: string): string {
  return code.trim().toUpperCase();
}

export function estConforme(code: string): boolean {
  return RE_REFERENCE.test(code);
}

export function estTrigrammeValide(code: string): boolean {
  return RE_TRIGRAMME.test(code);
}

/** Assemble une référence à partir d'un préfixe et d'une saisie numérique. */
export function construire(prefixe: string, numero: string): string {
  return `${prefixe}-${numero.padStart(LONGUEUR_NUMERO, "0")}`;
}

/** Sépare une référence en préfixe et numéro. `null` si elle n'est pas au format. */
export function decomposer(code: string): { prefixe: string; numero: string } | null {
  const normalise = normaliser(code);
  if (!estConforme(normalise)) return null;
  return { prefixe: normalise.slice(0, 3), numero: normalise.slice(4) };
}
