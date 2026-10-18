import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Categorie, ChampSpec, SousCategorie, TypeChampSpec } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

const TYPES: Record<TypeChampSpec, string> = {
  nombre: "Nombre",
  texte: "Texte",
  choix: "Choix",
  oui_non: "Oui / non",
};

export function CategoriesTab() {
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [sousCats, setSousCats] = useState<SousCategorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [cat, sc, ch] = await Promise.all([
        api<Categorie[]>("/categories"),
        api<SousCategorie[]>("/sous-categories"),
        api<ChampSpec[]>("/champs-specification"),
      ]);
      setCategories(cat);
      setSousCats(sc);
      setChamps(ch);
      setError(null);
    } catch {
      setError("Impossible de charger le référentiel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && categories.length === 0 && (
        <p className="text-sm text-fg-muted">Aucune catégorie.</p>
      )}
      {categories.map((c) => {
        const open = ouverte === c.id;
        const sc = sousCats.filter((s) => s.categorie_id === c.id);
        const ch = champs.filter((x) => x.categorie_id === c.id);
        return (
          <section key={c.id} className="rounded-2xl border border-line bg-bg-soft">
            <button
              type="button"
              onClick={() => setOuverte(open ? null : c.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.nom}</p>
                <p className="text-xs text-fg-muted">
                  {sc.length} sous-catégorie{sc.length > 1 ? "s" : ""} · {ch.length} champ
                  {ch.length > 1 ? "s" : ""}
                </p>
              </div>
              <Icon name={open ? "expand_less" : "expand_more"} className="text-xl" />
            </button>
            {open && (
              <div className="space-y-5 border-t border-line px-4 py-4">
                <SousCategories categorieId={c.id} items={sc} onChange={load} />
                <Champs categorieId={c.id} items={ch} sousCats={sc} onChange={load} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function useCanManage() {
  const { user } = useAuth();
  return user?.role === "Admin" || user?.role === "Staff";
}

function useFail() {
  const { toast } = useToast();
  return (err: unknown, fallback: string) =>
    toast(err instanceof ApiError ? err.message : fallback, "error");
}

function SousCategories({
  categorieId,
  items,
  onChange,
}: {
  categorieId: number;
  items: SousCategorie[];
  onChange: () => Promise<void>;
}) {
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const [nouveau, setNouveau] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNom, setEditNom] = useState("");

  async function add() {
    if (!nouveau.trim()) return;
    try {
      await api("/sous-categories", {
        method: "POST",
        body: { nom: nouveau.trim(), categorie_id: categorieId },
      });
      setNouveau("");
      toast("Sous-catégorie ajoutée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Ajout impossible.");
    }
  }

  async function rename(s: SousCategorie) {
    if (!editNom.trim()) return;
    try {
      await api(`/sous-categories/${s.id}`, { method: "PATCH", body: { nom: editNom.trim() } });
      setEditId(null);
      toast("Sous-catégorie renommée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Modification impossible.");
    }
  }

  async function remove(s: SousCategorie) {
    const usage =
      s.nb_utilisations > 0 ? `\n\nElle est utilisée ${s.nb_utilisations} fois.` : "";
    if (!window.confirm(`Supprimer la sous-catégorie « ${s.nom} » ?${usage}`)) return;
    try {
      await api(`/sous-categories/${s.id}`, { method: "DELETE" });
      toast("Sous-catégorie supprimée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Sous-catégories
      </h3>
      {items.length === 0 && <p className="text-sm text-fg-muted">Aucune.</p>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            {editId === s.id ? (
              <>
                <input
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void rename(s)}
                  aria-label="Nom de la sous-catégorie"
                  className={inputCls}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void rename(s)}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line"
                  aria-label="Enregistrer"
                >
                  <Icon name="check" className="text-lg" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                  aria-label="Annuler"
                >
                  <Icon name="close" className="text-lg" />
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {s.nom}
                  <span className="text-xs text-fg-muted"> · {s.nb_utilisations}</span>
                </span>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(s.id);
                        setEditNom(s.nom);
                      }}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                      aria-label={`Renommer ${s.nom}`}
                    >
                      <Icon name="edit" className="text-lg" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                      aria-label={`Supprimer ${s.nom}`}
                    >
                      <Icon name="delete" className="text-lg" />
                    </button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex gap-2">
          <input
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Nouvelle sous-catégorie"
            aria-label="Nouvelle sous-catégorie"
            className={inputCls}
          />
          <Button className="flex-none" onClick={() => void add()} aria-label="Ajouter">
            <Icon name="add" className="text-base" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Champs({
  categorieId,
  items,
  sousCats,
  onChange,
}: {
  categorieId: number;
  items: ChampSpec[];
  sousCats: SousCategorie[];
  onChange: () => Promise<void>;
}) {
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const [editing, setEditing] = useState<ChampSpec | null>(null);
  const [creating, setCreating] = useState(false);

  async function remove(c: ChampSpec) {
    const usage =
      c.nb_valeurs > 0
        ? `\n\n${c.nb_valeurs} valeur${c.nb_valeurs > 1 ? "s" : ""} saisie${
            c.nb_valeurs > 1 ? "s" : ""
          } seront perdues.`
        : "";
    if (!window.confirm(`Supprimer le champ « ${c.nom} » ?${usage}`)) return;
    try {
      await api(`/champs-specification/${c.id}`, { method: "DELETE" });
      toast("Champ supprimé.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  const sousNom = (id: number | null) => sousCats.find((s) => s.id === id)?.nom;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Champs</h3>
      {items.length === 0 && !creating && <p className="text-sm text-fg-muted">Aucun.</p>}
      <ul className="space-y-2">
        {[...items]
          .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom))
          .map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{c.nom}</p>
                <p className="truncate text-xs text-fg-muted">
                  {TYPES[c.type]}
                  {c.unite ? ` (${c.unite})` : ""}
                  {c.type === "choix" && c.options.length > 0 ? ` : ${c.options.join(", ")}` : ""}
                  {sousNom(c.sous_categorie_id) ? ` · ${sousNom(c.sous_categorie_id)}` : ""}
                  {` · ordre ${c.ordre} · ${c.nb_valeurs} valeur${c.nb_valeurs > 1 ? "s" : ""}`}
                </p>
              </div>
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setEditing(c);
                    }}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                    aria-label={`Modifier ${c.nom}`}
                  >
                    <Icon name="edit" className="text-lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(c)}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                    aria-label={`Supprimer ${c.nom}`}
                  >
                    <Icon name="delete" className="text-lg" />
                  </button>
                </>
              )}
            </li>
          ))}
      </ul>
      {canManage && (creating || editing) ? (
        <ChampForm
          key={editing?.id ?? "new"}
          initial={editing}
          categorieId={categorieId}
          sousCats={sousCats}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await onChange();
          }}
        />
      ) : (
        canManage && (
          <Button variant="ghost" className="h-9 px-3" onClick={() => setCreating(true)}>
            <Icon name="add" className="text-base" />
            Nouveau champ
          </Button>
        )
      )}
    </div>
  );
}

function ChampForm({
  initial,
  categorieId,
  sousCats,
  onCancel,
  onSaved,
}: {
  initial: ChampSpec | null;
  categorieId: number;
  sousCats: SousCategorie[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [type, setType] = useState<TypeChampSpec>(initial?.type ?? "texte");
  const [unite, setUnite] = useState(initial?.unite ?? "");
  const [options, setOptions] = useState((initial?.options ?? []).join(", "));
  const [sousId, setSousId] = useState<number | "">(initial?.sous_categorie_id ?? "");
  const [ordre, setOrdre] = useState(String(initial?.ordre ?? 0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!nom.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    const opts = options
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (type === "choix" && opts.length === 0) {
      setErr("Indiquez au moins une option.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body = {
        nom: nom.trim(),
        type,
        unite: type === "nombre" && unite.trim() ? unite.trim() : null,
        options: type === "choix" ? opts : [],
        categorie_id: categorieId,
        sous_categorie_id: sousId === "" ? null : sousId,
        ordre: Number.parseInt(ordre, 10) || 0,
      };
      if (initial) {
        await api(`/champs-specification/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/champs-specification", { method: "POST", body });
      }
      toast(initial ? "Champ modifié." : "Champ créé.", "success");
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <h4 className="text-sm font-semibold">{initial ? "Modifier le champ" : "Nouveau champ"}</h4>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Nom</span>
        <input value={nom} onChange={(e) => setNom(e.target.value)} className={inputCls} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TypeChampSpec)}
          className={inputCls}
        >
          {Object.entries(TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {type === "nombre" && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">
            Unité <span className="font-normal">(facultatif)</span>
          </span>
          <input
            value={unite}
            onChange={(e) => setUnite(e.target.value)}
            maxLength={20}
            placeholder="W, lm, Hz…"
            className={inputCls}
          />
        </label>
      )}
      {type === "choix" && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">Options (séparées par des virgules)</span>
          <input
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder="LED, Halogène, Laser"
            className={inputCls}
          />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">
          Sous-catégorie <span className="font-normal">(facultatif)</span>
        </span>
        <select
          value={sousId}
          onChange={(e) => setSousId(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputCls}
        >
          <option value="">Toute la catégorie</option>
          {sousCats.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nom}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Ordre</span>
        <input
          type="number"
          inputMode="numeric"
          value={ordre}
          onChange={(e) => setOrdre(e.target.value)}
          className={inputCls}
        />
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Annuler
        </Button>
        <Button className="flex-1" loading={saving} onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
