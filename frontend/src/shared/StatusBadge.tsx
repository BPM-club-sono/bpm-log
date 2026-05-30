import type { StatutEquipment } from "@/lib/types";

const STATUS_META: Record<
  StatutEquipment,
  { label: string; className: string }
> = {
  Fonctionnel: { label: "Fonctionnel", className: "bg-success/15 text-success" },
  En_Panne: { label: "En panne", className: "bg-danger/15 text-danger" },
  En_Reparation: { label: "En réparation", className: "bg-warning/15 text-warning" },
  Perdu: { label: "Perdu", className: "bg-danger/15 text-danger" },
  Reforme: { label: "Réformé", className: "bg-fg-muted/15 text-fg-muted" },
};

export function StatusBadge({ statut }: { statut: StatutEquipment }) {
  const meta = STATUS_META[statut];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
