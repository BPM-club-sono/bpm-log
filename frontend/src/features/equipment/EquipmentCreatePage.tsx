import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { SerieCreee } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { EquipmentForm } from "./EquipmentForm";

export function EquipmentCreatePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          to="/inventaire"
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> Parc
        </Link>
      </div>
      <h1 className="text-2xl font-bold">Nouvel équipement</h1>

      <EquipmentForm
        externeDefault={params.get("externe") === "1"}
        onCreated={(res: SerieCreee) => {
          if (res.ids.length > 1) {
            toast(`${res.ids.length} équipements créés`, "success");
            navigate(`/inventaire?modele=${res.modele_id}`);
          } else {
            toast("Équipement créé", "success");
            navigate(`/inventaire/${res.ids[0]}`);
          }
        }}
      />
    </div>
  );
}
