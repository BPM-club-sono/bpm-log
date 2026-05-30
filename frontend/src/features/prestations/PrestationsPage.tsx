import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Prestation, TypePrestation } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

const STATUT_LABEL: Record<Prestation["statut"], string> = {
  En_preparation: "En préparation",
  En_cours: "En cours",
  Terminee: "Terminée",
};

const STATUT_STYLE: Record<Prestation["statut"], string> = {
  En_preparation: "bg-warning/15 text-warning",
  En_cours: "bg-fg text-bg",
  Terminee: "bg-success/15 text-success",
};

export function PrestationsPage() {
  const { user } = useAuth();
  const canCreate = user?.role === "Admin" || user?.role === "Staff";
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [nom, setNom] = useState("");
  const [type, setType] = useState<TypePrestation>("Interne");
  const [clientNom, setClientNom] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPrestations(await api<Prestation[]>("/prestations"));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "Impossible de charger les prestations."
          : "Erreur réseau.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return;
    setSaving(true);
    try {
      await api<Prestation>("/prestations", {
        method: "POST",
        body: { nom: nom.trim(), type, client_nom: clientNom.trim() || null },
      });
      setNom("");
      setClientNom("");
      setType("Interne");
      setShowForm(false);
      await load();
    } catch {
      setError("Création impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Prestations</h1>
          <p className="text-sm text-fg-muted">
            {prestations.length} prestation{prestations.length > 1 ? "s" : ""}
          </p>
        </div>
        {canCreate && (
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            onClick={() => setShowForm((v) => !v)}
          >
            <Icon name={showForm ? "close" : "add"} className="text-base" />
            {showForm ? "Annuler" : "Nouvelle"}
          </Button>
        )}
      </header>

      {showForm && (
        <form
          onSubmit={onCreate}
          className="space-y-3 border-b border-line pb-4"
        >
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de la prestation"
            className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg"
          />
          <input
            value={clientNom}
            onChange={(e) => setClientNom(e.target.value)}
            placeholder="Client (optionnel)"
            className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg"
          />
          <div className="flex gap-2">
            {(["Interne", "Externe"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`h-9 flex-1 rounded-lg border text-xs font-medium transition-colors ${
                  type === t
                    ? "border-fg bg-fg text-bg"
                    : "border-line text-fg-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <Button type="submit" className="w-full" disabled={!nom.trim()} loading={saving}>
            Créer la prestation
          </Button>
        </form>
      )}

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && prestations.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="event" className="text-4xl" />
          <p className="text-sm">Aucune prestation pour l'instant.</p>
        </div>
      )}

      {!loading && prestations.length > 0 && (
        <ul className="divide-y divide-line">
          {prestations.map((p) => (
            <li key={p.id}>
              <Link
                to={`/prestations/${p.id}`}
                className="flex items-center justify-between gap-3 py-4 transition-opacity hover:opacity-70"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.nom}</p>
                  <p className="text-xs text-fg-muted">
                    {p.type}
                    {p.client_nom ? ` · ${p.client_nom}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUT_STYLE[p.statut]}`}
                >
                  {STATUT_LABEL[p.statut]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
