import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { AvancementTicket, TicketListItem } from "@/lib/types";
import { Icon } from "@/shared/Icon";

const AVANCEMENT_META: Record<
  AvancementTicket,
  { label: string; className: string }
> = {
  A_faire: { label: "À faire", className: "bg-fg-muted/15 text-fg-muted" },
  En_cours: { label: "En cours", className: "bg-warning/15 text-warning" },
  En_attente_de_piece: {
    label: "En attente de pièce",
    className: "bg-danger/15 text-danger",
  },
  Resolu: { label: "Résolu", className: "bg-success/15 text-success" },
};

export function AvancementBadge({ avancement }: { avancement: AvancementTicket }) {
  const meta = AVANCEMENT_META[avancement];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

type Filtre = "ouvert" | AvancementTicket | "tous";

const FILTRES: { value: Filtre; label: string }[] = [
  { value: "ouvert", label: "Ouvertes" },
  { value: "A_faire", label: "À faire" },
  { value: "En_cours", label: "En cours" },
  { value: "En_attente_de_piece", label: "En attente" },
  { value: "Resolu", label: "Résolu" },
  { value: "tous", label: "Toutes" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function membreNom(m: { prenom: string | null; nom: string | null } | null): string {
  if (!m) return "—";
  return [m.prenom, m.nom].filter(Boolean).join(" ") || "—";
}

export function PannesListPage() {
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [filtre, setFiltre] = useState<Filtre>("ouvert");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api<TicketListItem[]>(
          `/tickets?statut=${encodeURIComponent(filtre)}`,
        );
        if (active) setTickets(data);
      } catch (err) {
        if (active)
          setError(
            err instanceof ApiError
              ? "Impossible de charger les pannes."
              : "Erreur réseau. Réessaie.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [filtre]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Pannes &amp; réparations</h1>
        <p className="text-sm text-fg-muted">
          {tickets.length} ticket{tickets.length > 1 ? "s" : ""}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTRES.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFiltre(f.value)}
            data-on={filtre === f.value}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>
      )}

      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && tickets.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="build" className="text-4xl" />
          <p className="text-sm">Aucune panne dans cette vue.</p>
        </div>
      )}

      {!loading && !error && tickets.length > 0 && (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                to={`/pannes/${t.id}`}
                className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg-soft p-3 transition-colors hover:bg-bg-elev"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{t.equipment_nom}</p>
                  <AvancementBadge avancement={t.avancement} />
                </div>
                <p className="font-mono text-xs text-fg-muted">
                  {t.equipment_barcode}
                </p>
                {t.description_panne && (
                  <p className="line-clamp-2 text-xs text-fg-muted">
                    {t.description_panne}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="event" className="text-sm" />
                    {formatDate(t.date_declaration)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="person" className="text-sm" />
                    {membreNom(t.declarant)}
                  </span>
                  {t.assigne && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="engineering" className="text-sm" />
                      {membreNom(t.assigne)}
                    </span>
                  )}
                  {t.nb_photos > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="photo_camera" className="text-sm" />
                      {t.nb_photos}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
