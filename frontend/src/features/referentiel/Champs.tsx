import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ChampSpec, TypeChampSpec } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { inputCls, resumeChamp, TYPES, useCanManage, useFail } from "./shared";

/** Champs propres d'une catégorie (Staff : ajout, édition, suppression). Les champs
 *  hérités des ancêtres sont affichés à part par la fiche. */
export function Champs({
  categorieId,
  items,
  onChange,
}: {
  categorieId: number;
  items: ChampSpec[];
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

  return (
    <div className="space-y-2">
      {items.length === 0 && !creating && (
        <p className="text-sm text-fg-muted">Aucun champ propre à cette catégorie.</p>
      )}
      <ul className="space-y-2">
        {[...items]
          .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom))
          .map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{c.nom}</p>
                <p className="truncate text-xs text-fg-muted">
                  {resumeChamp(c)}
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
  onCancel,
  onSaved,
}: {
  initial: ChampSpec | null;
  categorieId: number;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [type, setType] = useState<TypeChampSpec>(initial?.type ?? "texte");
  const [unite, setUnite] = useState(initial?.unite ?? "");
  const [options, setOptions] = useState((initial?.options ?? []).join("\n"));
  const [ordre, setOrdre] = useState(String(initial?.ordre ?? 0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!nom.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    const opts = options
      .split("\n")
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
          <span className="text-xs font-medium text-fg-muted">Options (une par ligne)</span>
          <textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={"LED\nHalogène\nLaser"}
            rows={4}
            className={inputCls}
          />
        </label>
      )}
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
