import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type {
  Categorie,
  EquipmentListItem,
  Modele,
  Specs,
  StatutEquipment,
} from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { EquipmentRow } from "@/features/equipment/EquipmentRow";
import { SpecsEditor } from "@/features/specs/SpecsEditor";
import { SpecsSheet } from "@/features/specs/SpecsSheet";
import { ModeleForm } from "./ModeleForm";

/** Libellé du résumé des unités, au singulier puis au pluriel. */
const STATUT_LABEL: Record<StatutEquipment, [string, string]> = {
  Fonctionnel: ["fonctionnel", "fonctionnels"],
  En_Panne: ["en panne", "en panne"],
  En_Reparation: ["en réparation", "en réparation"],
  Perdu: ["perdu", "perdus"],
  Reforme: ["réformé", "réformés"],
};

/** Fiche d'un modèle : infos (Staff édite), spécifications partagées par toutes
 *  ses unités, et liste de ces unités. Admin supprime un modèle sans unité. */
export function ModeleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const modeleId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const canManage = user?.role === "Admin" || user?.role === "Staff";
  const isAdmin = user?.role === "Admin";

  const [modele, setModele] = useState<Modele | null>(null);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [specsError, setSpecsError] = useState(false);
  const [unites, setUnites] = useState<EquipmentListItem[] | null>(null);
  const [archives, setArchives] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [specsEdit, setSpecsEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadModele = useCallback(async () => {
    try {
      setModele(await api<Modele>(`/modeles/${modeleId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? "Modèle introuvable." : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [modeleId]);

  const loadSpecs = useCallback(async () => {
    try {
      setSpecs(await api<Specs>(`/modeles/${modeleId}/specs`));
      setSpecsError(false);
    } catch {
      setSpecsError(true);
    }
  }, [modeleId]);

  useEffect(() => {
    void loadModele();
    void loadSpecs();
  }, [loadModele, loadSpecs]);

  useEffect(() => {
    api<Categorie[]>("/categories").then(setCategories, () => setCategories([]));
  }, []);

  useEffect(() => {
    let active = true;
    setUnites(null);
    api<EquipmentListItem[]>(
      `/equipments?modele_id=${modeleId}${archives ? "&archive=1" : ""}`,
    ).then(
      (eq) => active && setUnites(eq),
      () => active && setUnites([]),
    );
    return () => {
      active = false;
    };
  }, [modeleId, archives]);

  const resume = useMemo(() => {
    if (!unites || archives) return null;
    const compte = new Map<StatutEquipment, number>();
    for (const u of unites) compte.set(u.statut_actuel, (compte.get(u.statut_actuel) ?? 0) + 1);
    return [...compte.entries()].map(([s, n]) => `${n} ${STATUT_LABEL[s][n > 1 ? 1 : 0]}`).join(" · ");
  }, [unites, archives]);

  async function supprimer() {
    if (!modele || !window.confirm(`Supprimer le modèle « ${modele.nom} » ?`)) return;
    setDeleting(true);
    try {
      await api(`/modeles/${modele.id}`, { method: "DELETE" });
      toast("Modèle supprimé.", "success");
      navigate("/modeles", { replace: true });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Suppression impossible.", "error");
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (!modele) {
    return (
      <div className="space-y-4">
        <p className="py-8 text-center text-sm text-danger">{error}</p>
        <Link to="/modeles" className="text-sm text-fg-muted hover:text-fg">
          ← Retour aux modèles
        </Link>
      </div>
    );
  }

  const nb = modele.nb_unites ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/modeles" className="inline-flex items-center gap-1 text-sm text-fg-muted">
          <Icon name="arrow_back" className="text-base" /> Modèles
        </Link>
        {canManage && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)} className="h-9 px-3">
            <Icon name="edit" className="text-base" />
            Modifier
          </Button>
        )}
      </div>

      {editing && canManage ? (
        <ModeleForm
          initial={modele}
          categories={categories}
          onCancel={() => setEditing(false)}
          onSaved={async (m) => {
            setModele(m);
            setEditing(false);
            // Changer de catégorie efface la sous-catégorie : la fiche suit.
            await loadSpecs();
          }}
        />
      ) : (
        <div className="space-y-3 border-b border-line pb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{modele.nom}</h1>
            {modele.marque && <p className="text-sm text-fg-muted">{modele.marque}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Info label="Catégorie" value={modele.categorie_nom} />
            <Info label="Sous-catégorie" value={modele.sous_categorie_nom} />
            <Info label="Marque" value={modele.marque} />
            <Info label="Unités" value={nb} />
          </dl>
        </div>
      )}

      {specsEdit && canManage ? (
        <SpecsEditor
          cible="modeles"
          id={modele.id}
          onCancel={() => setSpecsEdit(false)}
          onSaved={(s) => {
            setSpecs(s);
            setSpecsEdit(false);
            setModele({
              ...modele,
              sous_categorie_id: s.sous_categorie_id,
              sous_categorie_nom: s.sous_categorie_nom,
            });
            toast("Spécifications enregistrées.", "success");
          }}
        />
      ) : (
        <section className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Spécifications</h2>
            {canManage && specs && (
              <Button variant="ghost" className="h-9 px-3" onClick={() => setSpecsEdit(true)}>
                Éditer
              </Button>
            )}
          </div>
          {nb > 0 && (
            <p className="text-xs text-fg-muted">
              Partagées par les {nb} unité{nb > 1 ? "s" : ""} de ce modèle.
            </p>
          )}
          {specsError ? (
            <p className="text-sm text-danger">Spécifications indisponibles.</p>
          ) : specs ? (
            <SpecsSheet specs={specs} />
          ) : (
            <p className="text-sm text-fg-muted">Chargement…</p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg-muted">
            Unités{unites ? ` (${unites.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={() => setArchives((v) => !v)}
            data-on={archives}
            className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev data-[on=true]:border-warning data-[on=true]:bg-warning/15 data-[on=true]:text-warning"
          >
            <Icon name="archive" className="text-sm" />
            <span>Archives</span>
          </button>
        </div>
        {resume && <p className="text-xs text-fg-muted">{resume}</p>}
        {canManage && !archives && (
          <Link
            to={`/inventaire/nouveau?modele=${modele.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="add" className="text-base" />
            Ajouter des unités
          </Link>
        )}
        {unites === null ? (
          <p className="py-4 text-center text-sm text-fg-muted">Chargement…</p>
        ) : unites.length === 0 ? (
          <p className="py-4 text-sm text-fg-muted">
            {archives ? "Aucune unité archivée." : "Aucune unité."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {unites.map((u) => (
              <EquipmentRow key={u.id} item={u} />
            ))}
          </ul>
        )}
      </section>

      {isAdmin && (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <h2 className="text-sm font-semibold text-danger">Zone dangereuse</h2>
          <p className="text-xs text-fg-muted">
            {nb > 0
              ? "Suppression impossible tant que des unités utilisent ce modèle."
              : "Le modèle n'a aucune unité : il peut être supprimé."}
          </p>
          <Button
            variant="danger"
            onClick={() => void supprimer()}
            loading={deleting}
            disabled={nb > 0}
            className="w-full"
          >
            <Icon name="delete" className="text-base" />
            Supprimer le modèle
          </Button>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="truncate">{value ?? "—"}</dd>
    </div>
  );
}
