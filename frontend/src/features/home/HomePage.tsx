import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { api } from "@/lib/api";
import type { TicketListItem } from "@/lib/types";
import { Icon } from "@/shared/Icon";

const shortcuts = [
  { icon: "qr_code_scanner", label: "Scanner du matériel", to: "/scan" },
  { icon: "build", label: "Déclarer une panne", to: "/pannes" },
  { icon: "inventory", label: "Inventaire vrac", to: "/inventaire?type=vrac" },
  { icon: "category", label: "Consommables", to: "/inventaire?type=consommable" },
  { icon: "event", label: "Prestations", to: "/prestations" },
];

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prenom = user?.prenom ?? "";
  const [pannesOuvertes, setPannesOuvertes] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api<TicketListItem[]>("/tickets?statut=ouvert")
      .then((t) => {
        if (active) setPannesOuvertes(t.length);
      })
      .catch(() => {
        /* best-effort : carte masquée si indisponible (hors-ligne) */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-fg-muted">Bonjour {prenom}</p>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
      </header>

      {pannesOuvertes !== null && (
        <button
          onClick={() => navigate("/pannes/liste")}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-bg-soft p-4 text-left transition-colors hover:bg-bg-elev"
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-danger/15 text-danger">
            <Icon name="build" className="text-2xl" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Pannes en cours</p>
            <p className="text-xs text-fg-muted">
              {pannesOuvertes === 0
                ? "Aucune réparation en attente"
                : `${pannesOuvertes} ticket${pannesOuvertes > 1 ? "s" : ""} à traiter`}
            </p>
          </div>
          {pannesOuvertes > 0 && (
            <span className="flex-none rounded-full bg-danger px-2.5 py-0.5 text-sm font-bold text-fg">
              {pannesOuvertes}
            </span>
          )}
          <Icon name="chevron_right" className="flex-none text-fg-muted" />
        </button>
      )}

      <section className="grid grid-cols-2 gap-3">
        {shortcuts.map((s) => (
          <button
            key={s.label}
            onClick={() => navigate(s.to)}
            className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-bg-soft p-4 text-left transition-colors hover:bg-bg-elev"
          >
            <Icon name={s.icon} className="text-3xl" />
            <span className="text-sm font-medium">{s.label}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
