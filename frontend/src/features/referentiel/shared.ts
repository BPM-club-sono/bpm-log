import { useAuth } from "@/app/AuthContext";
import { ApiError } from "@/lib/api";
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
