import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { ancetres, descendantsIds, enfants } from "@/lib/categories";
import type { Categorie, ChampSpec, Modele } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { ModeleRow } from "@/features/modeles/ModeleRow";
import { CategorieForm } from "./CategorieForm";
import { CategorieRow } from "./CategorieRow";
import { Champs } from "./Champs";
import { inputCls, pluriel, resumeChamp, useCanManage, useFail } from "./shared";
import { statsCategories } from "./stats";

/** Filtre des modèles : tous, ceux d'une sous-catégorie directe (et de ses
 *  descendantes) ou ceux rangés directement dans la catégorie. */
type FiltreModeles = "tous" | "ici" | number;

/** Fiche d'une catégorie : fil d'Ariane, sous-catégories, spécifications (héritées
 *  des parentes puis propres) et modèles de toute la branche. Staff édite ;
 *  suppression seulement si la catégorie est vide. */
export function CategorieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const categorieId = Number(id);
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const navigate = useNavigate();

  const [categorie, setCategorie] = useState<Categorie | null>(null);
  const [categories, setCategories] = useState<Categorie[]>([]);
  // Champs applicables (ancêtres puis propres) et tous les champs, pour les compteurs.
  const [lignee, setLignee] = useState<ChampSpec[]>([]);
  const [tousChamps, setTousChamps] = useState<ChampSpec[]>([]);
  const [tousModeles, setTousModeles] = useState<Modele[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filtre, setFiltre] = useState<FiltreModeles>("tous");
  const [nouvelle, setNouvelle] = useState("");
  const [ajout, setAjout] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, cats, li, ch, mod] = await Promise.all([
        api<Categorie>(`/categories/${categorieId}`),
        api<Categorie[]>("/categories"),
        api<ChampSpec[]>(`/champs-specification?categorie_id=${categorieId}&herites=true`),
        api<ChampSpec[]>("/champs-specification"),
        api<Modele[]>("/modeles"),
      ]);
      setCategorie(cat);
      setCategories(cats);
      setLignee(li);
      setTousChamps(ch);
      setTousModeles(mod);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? "Catégorie introuvable." : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [categorieId]);

  useEffect(() => {
    setFiltre("tous");
    setEditing(false);
    void load();
  }, [load]);

  const stats = useMemo(
    () => statsCategories(categories, tousChamps, tousModeles),
    [categories, tousChamps, tousModeles],
  );
  const parents = useMemo(() => ancetres(categories, categorieId).slice(0, -1), [
    categories,
    categorieId,
  ]);
  const sousCats = useMemo(() => enfants(categories, categorieId), [categories, categorieId]);
  const branche = useMemo(
    () => descendantsIds(categories, categorieId),
    [categories, categorieId],
  );
  const modeles = useMemo(
    () => tousModeles.filter((m) => m.categorie_id != null && branche.has(m.categorie_id)),
    [tousModeles, branche],
  );
  const propres = lignee.filter((c) => !c.herite);
  // Champs hérités, groupés par catégorie parente (de la racine vers la plus proche).
  const herites = useMemo(() => {
    const groupes: { categorieId: number; nom: string; champs: ChampSpec[] }[] = [];
    for (const c of lignee.filter((x) => x.herite)) {
      const dernier = groupes[groupes.length - 1];
      if (dernier?.categorieId === c.categorie_id) dernier.champs.push(c);
      else groupes.push({ categorieId: c.categorie_id, nom: c.categorie_nom, champs: [c] });
    }
    return groupes;
  }, [lignee]);

  async function ajouterSousCategorie() {
    if (!nouvelle.trim()) return;
    setAjout(true);
    try {
      await api("/categories", {
        method: "POST",
        body: { nom: nouvelle.trim(), parent_id: categorieId },
      });
      setNouvelle("");
      toast("Sous-catégorie ajoutée.", "success");
      await load();
    } catch (err) {
      fail(err, "Ajout impossible.");
    } finally {
      setAjout(false);
    }
  }

  async function supprimer() {
    if (!categorie || !window.confirm(`Supprimer la catégorie « ${categorie.nom} » ?`)) return;
    setDeleting(true);
    try {
      await api(`/categories/${categorie.id}`, { method: "DELETE" });
      toast("Catégorie supprimée.", "success");
      navigate(
        categorie.parent_id != null
          ? `/referentiel/categories/${categorie.parent_id}`
          : "/referentiel",
        { replace: true },
      );
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

  const nbDirects = modeles.filter((m) => m.categorie_id === categorie.id).length;
  const modelesAffiches = modeles.filter((m) =>
    filtre === "tous"
      ? true
      : filtre === "ici"
        ? m.categorie_id === categorie.id
        : descendantsIds(categories, filtre).has(m.categorie_id as number),
  );
  const obstacles = [
    sousCats.length > 0 && pluriel(sousCats.length, "sous-catégorie"),
    propres.length > 0 && pluriel(propres.length, "champ"),
    nbDirects > 0 && pluriel(nbDirects, "modèle"),
  ].filter(Boolean) as string[];
  const retour = parents.at(-1);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to={retour ? `/referentiel/categories/${retour.id}` : "/referentiel"}
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> {retour?.nom ?? "Référentiel"}
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
          categories={categories}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="min-w-0 space-y-1">
            <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
              <Link to="/referentiel" className="hover:text-fg">
                Référentiel
              </Link>
              {parents.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1">
                  <Icon name="chevron_right" className="text-sm" />
                  <Link to={`/referentiel/categories/${p.id}`} className="hover:text-fg">
                    {p.nom}
                  </Link>
                </span>
              ))}
            </nav>
            <h1 className="text-xl font-bold">{categorie.nom}</h1>
            {categorie.description && (
              <p className="text-sm text-fg-muted">{categorie.description}</p>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <Info label="Sous-cat." value={sousCats.length} />
            <Info label="Champs" value={lignee.length} />
            <Info label="Modèles" value={modeles.length} />
          </dl>
        </div>
      )}

      <section className="space-y-2 border-t border-line pt-5">
        <h2 className="text-sm font-semibold text-fg-muted">
          Sous-catégories ({sousCats.length})
        </h2>
        {sousCats.length === 0 ? (
          <p className="text-sm text-fg-muted">Aucune sous-catégorie.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sousCats.map((c) => (
              <CategorieRow key={c.id} categorie={c} stats={stats.get(c.id)} />
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex gap-2">
            <input
              value={nouvelle}
              onChange={(e) => setNouvelle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void ajouterSousCategorie()}
              placeholder={`Nouvelle sous-catégorie de ${categorie.nom}`}
              aria-label="Nouvelle sous-catégorie"
              className={inputCls}
            />
            <Button
              className="flex-none"
              loading={ajout}
              onClick={() => void ajouterSousCategorie()}
              aria-label="Ajouter la sous-catégorie"
            >
              <Icon name="add" className="text-base" />
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-fg-muted">
            Spécifications ({lignee.length})
          </h2>
          <p className="text-xs text-fg-muted">
            Champs à renseigner sur les modèles de cette catégorie et de ses sous-catégories.
          </p>
        </div>

        {herites.map((g) => (
          <div key={g.categorieId} className="space-y-1.5" data-testid="champs-herites">
            <p className="flex items-center gap-1 text-xs text-fg-muted">
              <Icon name="subdirectory_arrow_right" className="text-sm" />
              Hérité de
              <Link
                to={`/referentiel/categories/${g.categorieId}`}
                className="font-medium text-fg hover:text-fg-muted"
              >
                {g.nom}
              </Link>
            </p>
            <ul className="space-y-1.5 border-l-2 border-line pl-3">
              {g.champs.map((c) => (
                <li key={c.id} className="min-w-0">
                  <p className="truncate text-sm text-fg-muted">{c.nom}</p>
                  <p className="truncate text-xs text-fg-muted">{resumeChamp(c)}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="space-y-1.5">
          {herites.length > 0 && (
            <p className="text-xs font-medium text-fg-muted">Propres à {categorie.nom}</p>
          )}
          <Champs categorieId={categorie.id} items={propres} onChange={load} />
        </div>
      </section>

      <section className="space-y-2 border-t border-line pt-5">
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
              { value: "tous" as const, label: "Tous", nb: modeles.length },
              ...sousCats.map((s) => ({
                value: s.id,
                label: s.nom,
                nb: stats.get(s.id)?.modeles ?? 0,
              })),
              { value: "ici" as const, label: `Directement dans ${categorie.nom}`, nb: nbDirects },
            ]
              .filter((f) => f.value === "tous" || f.nb > 0)
              .map((f) => (
                <button
                  key={String(f.value)}
                  type="button"
                  onClick={() => setFiltre(f.value)}
                  data-on={filtre === f.value}
                  aria-pressed={filtre === f.value}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
                >
                  {f.label} <span className="tabular-nums opacity-70">{f.nb}</span>
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
        <div className="space-y-3 border-t border-line pt-5">
          <h2 className="text-sm font-semibold text-danger">Zone dangereuse</h2>
          <p className="text-xs text-fg-muted">
            {obstacles.length > 0
              ? `Suppression impossible : la catégorie a encore ${obstacles.join(", ")}.`
              : "La catégorie est vide : elle peut être supprimée."}
          </p>
          <Button
            variant="danger"
            onClick={() => void supprimer()}
            loading={deleting}
            disabled={obstacles.length > 0}
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
