import { useAuth } from "@/app/AuthContext";
import { ApiError } from "@/lib/api";
import type { ChampSpec, TypeChampSpec } from "@/lib/types";
import { useToast } from "@/shared/Toast";

export const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

/** Staff et Admin modifient le référentiel ; Tech le consulte seulement. */
export function useCanManage() {
  const { user } = useAuth();
  return user?.role === "Admin" || user?.role === "Staff";
}

/** Affiche en toast le message français de l'API (409/422…) ou un défaut. */
export function useFail() {
  const { toast } = useToast();
  return (err: unknown, fallback: string) =>
    toast(err instanceof ApiError ? err.message : fallback, "error");
}

export const TYPES: Record<TypeChampSpec, string> = {
  nombre: "Nombre",
  texte: "Texte",
  choix: "Choix",
  oui_non: "Oui / non",
};

/** Description courte d'un champ : type, unité, options. */
export function resumeChamp(c: ChampSpec): string {
  return (
    TYPES[c.type] +
    (c.unite ? ` (${c.unite})` : "") +
    (c.type === "choix" && c.options.length > 0 ? ` : ${c.options.join(", ")}` : "")
  );
}

export const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
