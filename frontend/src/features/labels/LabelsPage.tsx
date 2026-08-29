import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "@/lib/api";
import type { Equipment } from "@/lib/types";
import { labelCart } from "@/lib/labelCart";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

interface Label {
  equipment: Equipment;
  /** `null` si la référence ne tient pas dans un QR v1 (cf. genererQr). */
  dataUrl: string | null;
}

/** Génère l'étiquette d'un équipement, ou `null` si sa référence déborde.
 *
 *  Correction d'erreur **H** (~30 % de récupération) pour que l'étiquette
 *  survive à la poussière et aux frottements, et **version 1** imposée pour que
 *  le symbole ne grossisse pas. La lib lève si le contenu ne rentre pas : c'est
 *  le comportement voulu — une référence non conforme doit se voir, pas produire
 *  un QR plus dense en silence. On isole l'échec sur la seule étiquette fautive
 *  plutôt que de casser la planche entière. La zone de silence passe à 4
 *  modules, ce que demande la norme (1 seul auparavant).
 */
async function genererQr(reference: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(reference, {
      margin: 4,
      width: 240,
      errorCorrectionLevel: "H",
      version: 1,
    });
  } catch {
    return null;
  }
}

export function LabelsPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cartIds, setCartIds] = useState<number[]>(() => labelCart.getAll());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => labelCart.subscribe(() => setCartIds(labelCart.getAll())), []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const eq = await api<Equipment[]>("/equipments");
        if (!active) return;
        const generated = await Promise.all(
          eq.map(async (equipment) => ({
            equipment,
            dataUrl: await genererQr(equipment.barcode_uid),
          })),
        );
        if (!active) return;
        setLabels(generated);
        // Pré-sélection : les étiquettes ajoutées au panier.
        setSelected(new Set(labelCart.getAll()));
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? "Impossible de charger le parc matériel."
            : "Erreur réseau. Réessaie.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Tri : panier d'abord, puis recherche.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cartSet = new Set(cartIds);
    return labels
      .filter(
        ({ equipment }) =>
          !q ||
          equipment.nom.toLowerCase().includes(q) ||
          equipment.barcode_uid.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const ca = cartSet.has(a.equipment.id) ? 0 : 1;
        const cb = cartSet.has(b.equipment.id) ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return a.equipment.nom.localeCompare(b.equipment.nom);
      });
  }, [labels, query, cartIds]);

  const printable = useMemo(
    () => labels.filter((l) => selected.has(l.equipment.id)),
    [labels, selected],
  );

  if (loading) {
    return <p className="py-12 text-center text-sm text-fg-muted">Génération des QR…</p>;
  }
  if (error) {
    return <p className="py-12 text-center text-sm text-danger">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <header className="no-print flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Étiquettes</h1>
          <p className="text-sm text-fg-muted">{printable.length} sélectionné(s)</p>
        </div>
        <Button onClick={() => window.print()} disabled={printable.length === 0}>
          <Icon name="print" className="text-xl" />
          Imprimer
        </Button>
      </header>

      <div className="no-print relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un nom ou un code-barres…"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
        />
      </div>

      <div className="no-print flex items-center justify-between text-sm">
        <button
          onClick={() => setSelected(new Set(visible.map((l) => l.equipment.id)))}
          className="font-medium text-fg-muted hover:text-fg"
        >
          Tout sélectionner
        </button>
        {cartIds.length > 0 && (
          <button
            onClick={() => labelCart.clear()}
            className="inline-flex items-center gap-1 font-medium text-danger"
          >
            <Icon name="delete_sweep" className="text-base" />
            Vider le panier ({cartIds.length})
          </button>
        )}
      </div>

      {/* Grille d'étiquettes (24 / page A4 en impression). */}
      <div className="label-sheet grid grid-cols-3 gap-2">
        {visible.map(({ equipment, dataUrl }) => {
          const isOn = selected.has(equipment.id);
          const inCart = cartIds.includes(equipment.id);
          return (
            <button
              key={equipment.id}
              type="button"
              onClick={() => toggle(equipment.id)}
              data-selected={isOn}
              className="label-cell relative flex flex-col items-center gap-1 rounded-lg border border-line bg-white p-2 text-center text-black transition-opacity data-[selected=false]:opacity-30"
            >
              {inCart && (
                <span className="no-print absolute right-1 top-1 text-fg">
                  <Icon name="bookmark" className="text-sm" filled />
                </span>
              )}
              {dataUrl ? (
                <img src={dataUrl} alt={equipment.barcode_uid} className="w-full" />
              ) : (
                <span className="flex aspect-square w-full flex-col items-center justify-center gap-1 border border-dashed border-danger/60 text-danger">
                  <Icon name="error" className="text-2xl" />
                  <span className="px-1 text-[9px] leading-tight">
                    Référence trop longue pour une étiquette
                  </span>
                </span>
              )}
              <span className="font-mono text-[10px] leading-tight">
                {equipment.barcode_uid}
              </span>
              <span className="line-clamp-2 text-[10px] font-medium leading-tight">
                {equipment.nom}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
