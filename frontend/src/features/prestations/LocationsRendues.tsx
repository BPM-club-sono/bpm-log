import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { refreshEquipmentMirror } from "@/lib/equipmentMirror";
import type { LocationsRendues as LocationsRenduesData } from "@/lib/types";
import { Button } from "@/shared/Button";
import { useToast } from "@/shared/Toast";

interface LocationsRenduesProps {
  prestaId: number;
  /** Appelé après l'archivage (recharger la prestation). */
  onDone: () => Promise<void>;
}

/** Prestation clôturée : archive d'un coup les locations rendues au loueur.
 *  Le serveur refait le tri à l'archivage : on affiche sa réponse, pas l'aperçu. */
export function LocationsRendues({ prestaId, onDone }: LocationsRenduesProps) {
  const { toast } = useToast();
  const [apercu, setApercu] = useState<LocationsRenduesData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    api<LocationsRenduesData>(`/prestations/${prestaId}/locations-rendues`)
      .then((r) => {
        if (!stale) setApercu(r);
      })
      .catch(() => {
        if (!stale) setApercu(null);
      });
    return () => {
      stale = true;
    };
  }, [prestaId]);

  if (!apercu || apercu.archivables.length === 0) return null;
  const n = apercu.archivables.length;

  async function archiver() {
    if (!apercu) return;
    const parLoueur = new Map<string, number>();
    for (const l of apercu.archivables) {
      const k = l.fournisseur_nom ?? "Sans loueur";
      parLoueur.set(k, (parLoueur.get(k) ?? 0) + 1);
    }
    const lignes = [...parLoueur].map(([k, c]) => `${k} : ${c}`).join("\n");
    if (!window.confirm(`Archiver les locations rendues ?\n\n${lignes}`)) return;
    setBusy(true);
    try {
      const r = await api<LocationsRenduesData>(
        `/prestations/${prestaId}/locations-rendues/archivage`,
        { method: "POST" },
      );
      const k = r.archivables.length;
      toast(`${k} location${k > 1 ? "s" : ""} archivée${k > 1 ? "s" : ""}`, "success");
      if (r.gardes.length) {
        const liste = r.gardes
          .slice(0, 3)
          .map((g) => `« ${g.nom} » gardé : ${g.raison ?? "non rendu"}`)
          .join("\n");
        const reste = r.gardes.length - 3;
        toast(reste > 0 ? `${liste}\net ${reste} autre${reste > 1 ? "s" : ""}` : liste, "info");
      }
      await refreshEquipmentMirror();
      await onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button className="h-9 w-full text-xs" onClick={archiver} loading={busy}>
      Archiver les locations rendues ({n})
    </Button>
  );
}
