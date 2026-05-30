/** Panier d'étiquettes persistant (localStorage), type e-commerce.
 *  Contient les ids d'équipements à imprimer ; survit aux navigations et
 *  aux impressions ; vidé uniquement manuellement. */

const KEY = "bpm.label_cart";
type Listener = (ids: number[]) => void;

const listeners = new Set<Listener>();

function read(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number");
  } catch {
    return [];
  }
}

function write(ids: number[]): void {
  localStorage.setItem(KEY, JSON.stringify(ids));
  for (const l of listeners) l(ids);
}

export const labelCart = {
  getAll(): number[] {
    return read();
  },
  has(id: number): boolean {
    return read().includes(id);
  },
  count(): number {
    return read().length;
  },
  add(id: number): number[] {
    const ids = read();
    if (!ids.includes(id)) ids.push(id);
    write(ids);
    return ids;
  },
  remove(id: number): number[] {
    const ids = read().filter((x) => x !== id);
    write(ids);
    return ids;
  },
  toggle(id: number): number[] {
    return read().includes(id) ? labelCart.remove(id) : labelCart.add(id);
  },
  clear(): void {
    write([]);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
