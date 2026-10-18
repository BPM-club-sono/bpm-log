import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Specs } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { SpecsEditor } from "./SpecsEditor";
import { SpecsSheet } from "./SpecsSheet";

/** Bloc « Spécifications » de la fiche d'une unité : héritées du modèle (lecture
 *  seule ici) ou propres à l'unité (éditables par Staff+). */
export function EquipmentSpecs({
  equipmentId,
  modeleNom,
}: {
  equipmentId: number;
  modeleNom: string | null;
}) {
  const { user } = useAuth();
  const canEdit = user?.role === "Admin" || user?.role === "Staff";
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSpecs(await api<Specs>(`/equipments/${equipmentId}/specs`));
      setError(false);
    } catch {
      setSpecs(null);
      setError(true);
    }
  }, [equipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-danger">Spécifications indisponibles.</p>;
  if (!specs) return null;

  if (editing) {
    return (
      <SpecsEditor
        cible="equipments"
        id={equipmentId}
        onCancel={() => setEditing(false)}
        onSaved={(s) => {
          setSpecs(s);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Spécifications</h2>
        {specs.source === "equipement" && canEdit && (
          <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(true)}>
            Éditer
          </Button>
        )}
      </div>
      {specs.source === "modele" && (
        <p className="text-xs text-fg-muted">
          Héritées du modèle «{" "}
          <Link to="/modeles" className="underline">
            {modeleNom ?? "modèle"}
          </Link>
          {" "}»
        </p>
      )}
      <SpecsSheet specs={specs} />
    </section>
  );
}
