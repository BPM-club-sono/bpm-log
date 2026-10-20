import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Modele, SerieCreee } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { EquipmentForm } from "./EquipmentForm";

export function EquipmentCreatePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const modeleParam = params.get("modele");
  // `?modele=<id>` (fiche modèle) : le formulaire s'ouvre avec ce modèle choisi.
  const [modele, setModele] = useState<Modele | null | undefined>(
    modeleParam ? undefined : null,
  );
  useEffect(() => {
    if (!modeleParam) return;
    api<Modele>(`/modeles/${modeleParam}`).then(setModele, () =>
      setModele(null),
    );
  }, [modeleParam]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          to={modeleParam ? `/modeles/${modeleParam}` : "/inventaire"}
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" />{" "}
          {modeleParam ? "Modèle" : "Parc"}
        </Link>
      </div>
      <h1 className="text-2xl font-bold">Nouvel équipement</h1>

      {modele === undefined ? (
        <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>
      ) : (
        <EquipmentForm
          modeleDefault={modele}
          externeDefault={params.get("externe") === "1"}
          onCreated={(res: SerieCreee) => {
            if (res.ids.length > 1) {
              toast(`${res.ids.length} équipements créés`, "success");
              // Depuis la fiche modèle on y revient ; sinon le Parc filtré sur le modèle.
              navigate(
                modeleParam && String(res.modele_id) === modeleParam
                  ? `/modeles/${modeleParam}`
                  : res.modele_id == null
                    ? "/inventaire"
                    : `/inventaire?modele=${res.modele_id}`,
              );
            } else {
              toast("Équipement créé", "success");
              navigate(`/inventaire/${res.ids[0]}`);
            }
          }}
        />
      )}
    </div>
  );
}
