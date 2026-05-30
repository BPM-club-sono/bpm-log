import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { api } from "@/lib/api";
import type {
  ActiviteItem,
  CategorieActivite,
  DashboardData,
  PrestationCourante,
} from "@/lib/types";
import { Icon } from "@/shared/Icon";

const shortcuts = [
  { icon: "build", label: "Déclarer une panne", to: "/pannes" },
  { icon: "event", label: "Prestations", to: "/prestations" },
];

type Filtre = "tout" | CategorieActivite;

const filtres: { key: Filtre; label: string }[] = [
  { key: "tout", label: "Tout" },
  { key: "reparation", label: "Réparations" },
  { key: "scan", label: "Scans" },
  { key: "statut", label: "Statuts" },
];

const ACTIVITE_LIMIT = 10;

const ACTIVITE_ICON: Record<CategorieActivite, string> = {
  reparation: "build",
  scan: "swap_horiz",
  statut: "published_with_changes",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJour(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prenom = user?.prenom ?? "";

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filtre, setFiltre] = useState<Filtre>("tout");

  useEffect(() => {
    let active = true;
    api<DashboardData>("/dashboard")
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activiteFiltree = useMemo(() => {
    if (!data) return [];
    if (filtre === "tout") return data.activite;
    return data.activite.filter((a) => a.categorie === filtre);
  }, [data, filtre]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-fg-muted">Bonjour {prenom}</p>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
      </header>

      {loading && <p className="text-sm text-fg-muted">Chargement…</p>}

      {error && !data && (
        <p className="text-sm text-fg-muted">
          Tableau de bord indisponible hors-ligne.
        </p>
      )}

      {data && (
        <>
          {/* Santé du parc — anneau sobre, sans boîte */}
          <section className="space-y-4">
            <div className="flex items-center gap-6">
              <HealthRing pct={data.parc.pourcentage_sante} />
              <div className="flex-1 space-y-3">
                <LegendRow
                  color="bg-danger"
                  value={data.parc.en_panne}
                  label="En panne"
                />
                <LegendRow
                  color="bg-warning"
                  value={data.parc.en_reparation}
                  label="En réparation"
                />
                <LegendRow
                  color="bg-fg-muted"
                  value={data.parc.perdu}
                  label="Perdu"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>
                {data.parc.fonctionnel} fonctionnels · {data.parc.total_actif}{" "}
                actifs
              </span>
              <Link to="/inventaire" className="font-medium hover:text-fg">
                Voir le parc
              </Link>
            </div>
          </section>

          {/* À traiter — liste épurée, sans cartes */}
          <section className="space-y-1">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              À traiter
            </h2>
            <div className="divide-y divide-line">
              <TaskRow
                icon="build"
                label="Pannes en cours"
                value={data.parc.tickets_ouverts}
                alert={data.parc.tickets_ouverts > 0}
                onClick={() => navigate("/pannes/liste")}
              />
              <TaskRow
                icon="assignment_late"
                label="Tickets non assignés"
                value={data.parc.tickets_non_assignes}
                alert={data.parc.tickets_non_assignes > 0}
                onClick={() => navigate("/pannes/liste")}
              />
              <TaskRow
                icon="category"
                label="Consommables bas"
                value={data.parc.consommables_sous_seuil}
                alert={data.parc.consommables_sous_seuil > 0}
                onClick={() => navigate("/inventaire?type=consommable")}
              />
            </div>
          </section>

          {/* Prestation — bloc épuré */}
          <PrestationBlock
            presta={data.prestation}
            onOpen={(id) => navigate(`/prestations/${id}`)}
            onList={() => navigate("/prestations")}
          />

          {/* Raccourcis */}
          <section className="grid grid-cols-2 gap-3">
            {shortcuts.map((s) => (
              <button
                key={s.label}
                onClick={() => navigate(s.to)}
                className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-3 text-sm font-medium transition-colors hover:bg-bg-soft"
              >
                <Icon name={s.icon} className="text-xl text-fg-muted" />
                {s.label}
              </button>
            ))}
          </section>

          {/* ⑥ Historique global */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-fg-muted">
              Activité récente
            </h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {filtres.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFiltre(f.key)}
                  className={`flex-none rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    filtre === f.key
                      ? "border-fg bg-fg text-bg"
                      : "border-line bg-bg-soft text-fg-muted hover:bg-bg-elev"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {activiteFiltree.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Aucune activité à afficher.
              </p>
            ) : (
              <div className="relative">
                <ol className="relative ml-1">
                  {activiteFiltree.slice(0, ACTIVITE_LIMIT).map((item, i) => (
                    <ActivityItem
                      key={item.id}
                      item={item}
                      isFirst={i === 0}
                      isLast={i === Math.min(activiteFiltree.length, ACTIVITE_LIMIT) - 1}
                    />
                  ))}
                </ol>
                {activiteFiltree.length > ACTIVITE_LIMIT && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent" />
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HealthRing({ pct }: { pct: number }) {
  const size = 132;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div
      className="relative flex-none"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-bg-elev"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="text-fg transition-all"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold leading-none">{pct}%</span>
        <span className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          Santé du parc
        </span>
      </div>
    </div>
  );
}

function LegendRow({
  color,
  value,
  label,
}: {
  color: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`h-2.5 w-2.5 flex-none rounded-full ${color}`} />
      <span className="w-5 text-base font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-fg-muted">{label}</span>
    </div>
  );
}

function TaskRow({
  icon,
  label,
  value,
  alert,
  onClick,
}: {
  icon: string;
  label: string;
  value: number;
  alert: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 py-3 text-left transition-opacity hover:opacity-70"
    >
      <Icon
        name={icon}
        className={`text-xl ${alert ? "text-danger" : "text-fg-muted"}`}
      />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <span
        className={`text-base font-semibold tabular-nums ${
          alert ? "text-fg" : "text-fg-muted"
        }`}
      >
        {value}
      </span>
      <Icon name="chevron_right" className="text-base text-fg-muted" />
    </button>
  );
}

function PrestationBlock({
  presta,
  onOpen,
  onList,
}: {
  presta: PrestationCourante | null;
  onOpen: (id: number) => void;
  onList: () => void;
}) {
  if (!presta) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Prestation
        </h2>
        <button
          onClick={onList}
          className="flex w-full items-center gap-2 text-left text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <Icon name="event" className="text-lg" />
          Aucune prestation planifiée
          <Icon name="chevron_right" className="ml-auto" />
        </button>
      </section>
    );
  }

  const debut = formatJour(presta.date_debut);
  const fin = formatJour(presta.date_fin);
  const periode = debut && fin ? `${debut} → ${fin}` : (debut ?? fin);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            presta.a_venir ? "bg-fg-muted" : "bg-success"
          }`}
        />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {presta.a_venir ? "Prochaine prestation" : "Prestation en cours"}
        </h2>
      </div>
      <button
        onClick={() => onOpen(presta.id)}
        className="flex w-full items-start gap-3 text-left transition-opacity hover:opacity-80"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{presta.nom}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            {presta.client_nom && (
              <span className="inline-flex items-center gap-1">
                <Icon name="person" className="text-sm" />
                {presta.client_nom}
              </span>
            )}
            {periode && (
              <span className="inline-flex items-center gap-1">
                <Icon name="event" className="text-sm" />
                {periode}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Icon name="inventory_2" className="text-sm" />
              {presta.nb_objets} objet{presta.nb_objets > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <Icon name="chevron_right" className="mt-0.5 flex-none text-fg-muted" />
      </button>
    </section>
  );
}

function ActivityItem({
  item,
  isFirst,
  isLast,
}: {
  item: ActiviteItem;
  isFirst: boolean;
  isLast: boolean;
}) {
  const icon = ACTIVITE_ICON[item.categorie];
  const to =
    item.ticket_id != null
      ? `/pannes/${item.ticket_id}`
      : item.equipment_id != null
        ? `/inventaire/${item.equipment_id}`
        : undefined;

  const sub = item.contexte
    ? `${item.equipment_nom} · ${item.contexte}`
    : item.equipment_nom;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icon name={icon} className="text-base text-fg-muted" />
          <span className="truncate">{item.titre}</span>
          {to && (
            <Icon
              name="chevron_right"
              className="flex-none text-sm text-fg-muted"
            />
          )}
        </p>
        <span className="flex-none text-xs text-fg-muted">
          {formatDateTime(item.date)}
        </span>
      </div>
      {sub && <p className="mt-0.5 truncate text-xs text-fg-muted">{sub}</p>}
    </>
  );

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <span className="absolute left-[7px] top-4 h-full w-px bg-line" />
      )}
      <span className="relative z-10 mt-1 flex h-4 w-4 flex-none items-center justify-center">
        <span
          className={
            isFirst
              ? "h-3 w-3 rounded-full bg-fg"
              : "h-2.5 w-2.5 rounded-full border-2 border-line bg-bg"
          }
        />
      </span>
      {to ? (
        <Link to={to} className="min-w-0 flex-1 transition-colors hover:opacity-80">
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}
    </li>
  );
}
