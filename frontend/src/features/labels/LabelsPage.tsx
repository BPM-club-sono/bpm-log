import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "@/lib/api";
import type { Equipment } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

interface Label {
  equipment: Equipment;
  dataUrl: string;
}

export function LabelsPage() {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const eq = await api<Equipment[]>("/equipments");
        if (!active) return;
        const generated = await Promise.all(
          eq.map(async (equipment) => ({
            equipment,
            dataUrl: await QRCode.toDataURL(equipment.barcode_uid, {
              margin: 1,
              width: 240,
              errorCorrectionLevel: "M",
            }),
          })),
        );
        if (!active) return;
        setEquipments(eq);
        setLabels(generated);
        setSelected(new Set(eq.map((e) => e.id)));
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

  const allSelected = selected.size === equipments.length && equipments.length > 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(equipments.map((e) => e.id)));
  }

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

      <div className="no-print">
        <button
          onClick={toggleAll}
          className="text-sm font-medium text-fg-muted underline"
        >
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
      </div>

      {/* Grille d'étiquettes (24 / page A4 en impression). */}
      <div className="label-sheet grid grid-cols-3 gap-2">
        {labels.map(({ equipment, dataUrl }) => {
          const isOn = selected.has(equipment.id);
          return (
            <button
              key={equipment.id}
              type="button"
              onClick={() => toggle(equipment.id)}
              data-selected={isOn}
              className="label-cell flex flex-col items-center gap-1 rounded-lg border border-line bg-white p-2 text-center text-black transition-opacity data-[selected=false]:opacity-30"
            >
              <img src={dataUrl} alt={equipment.barcode_uid} className="w-full" />
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
