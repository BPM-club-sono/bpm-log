import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Categorie, ChampSpec, Modele, SousCategorie } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { ModeleRow } from "@/features/modeles/ModeleRow";
import { CategorieForm } from "./CategorieForm";
import { Champs } from "./Champs";
import { SousCategories } from "./SousCategories";
import { useCanManage, useFail } from "./shared";

/** Fiche d'une catégorie : infos (Staff édite), sous-catégories, champs de
 *  spécification et modèles rangés dedans. Suppression seulement si inutilisée. */
export function CategorieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const categorieId = Number(id);
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const navigate = useNavigate();

  const [categorie, setCategorie] = useState<Categorie | null>(null);
  const [sousCats, setSousCats] = useState<SousCategorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [modeles, setModeles] = useState<Modele[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filtre, setFiltre] = useState<number | "tous" | "aucune">("tous");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, sc, ch, mod] = await Promise.all([
        api<Categorie>(`/categories/${categorieId}`),
        api<SousCategorie[]>(`/sous-categories?categorie_id=${categorieId}`),
        api<ChampSpec[]>(`/champs-specification?categorie_id=${categorieId}`),
        api<Modele[]>("/modeles"),
      ]);
      setCategorie(cat);
      setSousCats(sc);
      setChamps(ch);
      setModeles(mod.filter((m) => m.categorie_id === categorieId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? "Catégorie introuvable." : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [categorieId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function supprimer() {
    if (!categorie || !window.confirm(`Supprimer la catégorie « ${categorie.nom} » ?`)) return;
    setDeleting(true);
    try {
      await api(`/categories/${categorie.id}`, { method: "DELETE" });
      toast("Catégorie supprimée.", "success");
      navigate("/referentiel", { replace: true });
    } catch (err) {
      fail(err, "Suppression impossible.");
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (!categorie) {
    return (
      <div className="space-y-4">
        <p className="py-8 text-center text-sm text-danger">{error}</p>
        <Link to="/referentiel" className="text-sm text-fg-muted hover:text-fg">
          ← Retour au référentiel
        </Link>
      </div>
    );
  }

  const modelesAffiches = modeles.filter((m) =>
    filtre === "tous"
      ? true
      : filtre === "aucune"
        ? m.sous_categorie_id == null
        : m.sous_categorie_id === filtre,
  );
  const utilisee = modeles.length > 0 || sousCats.length > 0 || champs.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to="/referentiel"
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> Référentiel
        </Link>
        {canManage && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)} className="h-9 px-3">
            <Icon name="edit" className="text-base" />
            Modifier
          </Button>
        )}
      </div>

      {editing && canManage ? (
        <CategorieForm
          initial={categorie}
          onCancel={() => setEditing(false)}
          onSaved={(c) => {
            setCategorie(c);
            setEditing(false);
          }}
        />
      ) : (
        <div className="space-y-3 border-b border-line pb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{categorie.nom}</h1>
            {categorie.description && (
              <p className="text-sm text-fg-muted">{categorie.description}</p>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <Info label="Sous-cat." value={sousCats.length} />
            <Info label="Champs" value={champs.length} />
            <Info label="Modèles" value={modeles.length} />
          </dl>
        </div>
      )}

      <section className="rounded-2xl border border-line p-4">
        <SousCategories categorieId={categorie.id} items={sousCats} onChange={load} />
      </section>

      <section className="rounded-2xl border border-line p-4">
        <Champs categorieId={categorie.id} items={champs} sousCats={sousCats} onChange={load} />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg-muted">Modèles ({modeles.length})</h2>
          <Link
            to={`/modeles?categorie=${categorie.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
          >
            Voir dans Modèles
            <Icon name="arrow_forward" className="text-sm" />
          </Link>
        </div>
        {sousCats.length > 0 && modeles.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sous-catégorie">
            {[
              { value: "tous" as const, label: "Toutes" },
              ...sousCats.map((s) => ({ value: s.id, label: s.nom })),
              { value: "aucune" as const, label: "Sans sous-catégorie" },
            ].map((f) => (
              <button
                key={String(f.value)}
                type="button"
                onClick={() => setFiltre(f.value)}
                data-on={filtre === f.value}
                aria-pressed={filtre === f.value}
                className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {modelesAffiches.length === 0 ? (
          <p className="py-4 text-sm text-fg-muted">Aucun modèle.</p>
        ) : (
          <ul className="divide-y divide-line">
            {modelesAffiches.map((m) => (
              <ModeleRow key={m.id} modele={m} />
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <h2 className="text-sm font-semibold text-danger">Zone dangereuse</h2>
          <p className="text-xs text-fg-muted">
            {utilisee
              ? "Suppression impossible tant que la catégorie a des sous-catégories, des champs ou des modèles."
              : "La catégorie est vide : elle peut être supprimée."}
          </p>
          <Button
            variant="danger"
            onClick={() => void supprimer()}
            loading={deleting}
            disabled={utilisee}
            className="w-full"
          >
            <Icon name="delete" className="text-base" />
            Supprimer la catégorie
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
      <dd className="truncate">{value}</dd>
    </div>
  );
}
