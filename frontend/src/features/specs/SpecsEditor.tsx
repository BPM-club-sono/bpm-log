import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  ChampSpec,
  Connecteur,
  ConnectiqueIn,
  SensConnectique,
  SousCategorie,
  Specs,
  SpecsWrite,
} from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { inputCls, useFail } from "@/features/referentiel/shared";
import { parseNombre } from "./format";

type FixeKey =
  | "poids"
  | "longueur"
  | "largeur"
  | "hauteur"
  | "prix_interne"
  | "prix_externe";

const FIXES: { key: FixeKey; label: string }[] = [
  { key: "poids", label: "Poids (kg)" },
  { key: "longueur", label: "Longueur (cm)" },
  { key: "largeur", label: "Largeur (cm)" },
  { key: "hauteur", label: "Hauteur (cm)" },
  { key: "prix_interne", label: "Prix interne (€)" },
  { key: "prix_externe", label: "Prix externe (€)" },
];

const texte = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

interface LigneConnectique {
  connecteur_id: number | "";
  sens: SensConnectique;
  quantite: number;
}

/** Édition des spécifications d'un modèle ou d'une unité sans modèle. */
export function SpecsEditor({
  cible,
  id,
  onSaved,
  onCancel,
}: {
  cible: "modeles" | "equipments";
  id: number;
  onSaved: (s: Specs) => void;
  onCancel: () => void;
}) {
  const fail = useFail();
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [sousCats, setSousCats] = useState<SousCategorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [connecteurs, setConnecteurs] = useState<Connecteur[]>([]);
  const [sousCatId, setSousCatId] = useState<number | "">("");
  const [fixes, setFixes] = useState<Record<FixeKey, string>>({
    poids: "",
    longueur: "",
    largeur: "",
    hauteur: "",
    prix_interne: "",
    prix_externe: "",
  });
  const [valeurs, setValeurs] = useState<Record<number, string>>({});
  const [lignes, setLignes] = useState<LigneConnectique[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const s = await api<Specs>(`/${cible}/${id}/specs`);
        const q = s.categorie_id !== null ? `?categorie_id=${s.categorie_id}` : "";
        const [sc, ch, co] = await Promise.all([
          s.categorie_id !== null
            ? api<SousCategorie[]>(`/sous-categories${q}`)
            : Promise.resolve([] as SousCategorie[]),
          s.categorie_id !== null
            ? api<ChampSpec[]>(`/champs-specification${q}`)
            : Promise.resolve([] as ChampSpec[]),
          api<Connecteur[]>("/connecteurs"),
        ]);
        if (annule) return;
        setSpecs(s);
        setSousCats(sc);
        setChamps(ch);
        setConnecteurs(co);
        setSousCatId(s.sous_categorie_id ?? "");
        setFixes({
          poids: texte(s.poids),
          longueur: texte(s.longueur),
          largeur: texte(s.largeur),
          hauteur: texte(s.hauteur),
          prix_interne: texte(s.prix_interne),
          prix_externe: texte(s.prix_externe),
        });
        setValeurs(
          Object.fromEntries(s.valeurs.map((v) => [v.champ_id, v.valeur ?? ""])),
        );
        setLignes(
          s.connectiques.map((c) => ({
            connecteur_id: c.connecteur_id,
            sens: c.sens,
            quantite: c.quantite,
          })),
        );
      } catch {
        if (!annule) setLoadError(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, [cible, id]);

  // Champs applicables : ceux de toute la catégorie + ceux de la sous-catégorie choisie.
  const applicables = useMemo(
    () =>
      champs.filter(
        (c) => c.sous_categorie_id === null || c.sous_categorie_id === sousCatId,
      ),
    [champs, sousCatId],
  );

  function majLigne(i: number, patch: Partial<LigneConnectique>) {
    setLignes((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    const e: Record<string, string> = {};
    const body: SpecsWrite = {
      sous_categorie_id: sousCatId === "" ? null : sousCatId,
    };
    for (const { key } of FIXES) {
      const n = parseNombre(fixes[key]);
      if (n !== null && Number.isNaN(n)) e[key] = "Nombre invalide.";
      else body[key] = n;
    }
    const vals: Record<number, string | null> = {};
    for (const c of applicables) {
      const v = (valeurs[c.id] ?? "").trim();
      if (c.type === "nombre" && v !== "" && Number.isNaN(parseNombre(v))) {
        e[`champ-${c.id}`] = "Nombre invalide.";
      }
      vals[c.id] = v === "" ? null : v;
    }
    if (lignes.some((l) => l.connecteur_id === "")) {
      e.connectiques = "Choisis un connecteur pour chaque ligne.";
    }
    setErrs(e);
    if (Object.keys(e).length > 0) return;
    body.valeurs = vals;
    body.connectiques = lignes.map(
      (l): ConnectiqueIn => ({
        connecteur_id: l.connecteur_id as number,
        sens: l.sens,
        quantite: Math.max(1, l.quantite),
      }),
    );
    setSaving(true);
    try {
      onSaved(await api<Specs>(`/${cible}/${id}/specs`, { method: "PUT", body }));
    } catch (err) {
      fail(err, "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="text-sm text-danger">Impossible de charger les spécifications.</p>;
  if (!specs) return <p className="text-sm text-fg-muted">Chargement…</p>;

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
      <h2 className="text-sm font-semibold">Spécifications</h2>

      {specs.categorie_id === null && (
        <p className="text-xs text-fg-muted">
          Sans catégorie, seuls les champs fixes et la connectique sont disponibles.
        </p>
      )}

      {sousCats.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">Sous-catégorie</span>
          <select
            value={sousCatId}
            onChange={(e) => setSousCatId(e.target.value === "" ? "" : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">—</option>
            {sousCats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        {FIXES.map(({ key, label }) => (
          <label key={key} className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">{label}</span>
            <input
              inputMode="decimal"
              value={fixes[key]}
              onChange={(e) => setFixes((p) => ({ ...p, [key]: e.target.value }))}
              className={inputCls}
            />
            {errs[key] && <span className="block text-xs text-danger">{errs[key]}</span>}
          </label>
        ))}
      </div>

      {applicables.map((c) => (
        <label key={c.id} className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">
            {c.nom}
            {c.unite ? ` (${c.unite})` : ""}
          </span>
          {c.type === "choix" || c.type === "oui_non" ? (
            <select
              value={valeurs[c.id] ?? ""}
              onChange={(e) => setValeurs((p) => ({ ...p, [c.id]: e.target.value }))}
              className={inputCls}
            >
              <option value="">—</option>
              {c.type === "oui_non" ? (
                <>
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </>
              ) : (
                c.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              inputMode={c.type === "nombre" ? "decimal" : undefined}
              value={valeurs[c.id] ?? ""}
              onChange={(e) => setValeurs((p) => ({ ...p, [c.id]: e.target.value }))}
              className={inputCls}
            />
          )}
          {errs[`champ-${c.id}`] && (
            <span className="block text-xs text-danger">{errs[`champ-${c.id}`]}</span>
          )}
        </label>
      ))}

      <div className="space-y-2">
        <p className="text-xs font-medium text-fg-muted">Connectique</p>
        {lignes.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={l.connecteur_id}
              onChange={(e) =>
                majLigne(i, { connecteur_id: e.target.value === "" ? "" : Number(e.target.value) })
              }
              className={`${inputCls} min-w-0 flex-1`}
              aria-label="Connecteur"
            >
              <option value="">Connecteur…</option>
              {connecteurs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
            <select
              value={l.sens}
              onChange={(e) => majLigne(i, { sens: e.target.value as SensConnectique })}
              className={`${inputCls} w-24 flex-none`}
              aria-label="Sens"
            >
              <option value="entree">Entrée</option>
              <option value="sortie">Sortie</option>
            </select>
            <input
              type="number"
              min={1}
              value={l.quantite}
              onChange={(e) => majLigne(i, { quantite: Number(e.target.value) })}
              className={`${inputCls} w-16 flex-none`}
              aria-label="Quantité"
            />
            <button
              type="button"
              onClick={() => setLignes((prev) => prev.filter((_, k) => k !== i))}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
              aria-label="Retirer"
            >
              <Icon name="delete" className="text-lg" />
            </button>
          </div>
        ))}
        {errs.connectiques && <p className="text-xs text-danger">{errs.connectiques}</p>}
        <Button
          variant="ghost"
          className="h-9 px-3"
          onClick={() =>
            setLignes((prev) => [...prev, { connecteur_id: "", sens: "entree", quantite: 1 }])
          }
        >
          <Icon name="add" className="text-base" />
          Ajouter
        </Button>
      </div>

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
