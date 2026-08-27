import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { dashboardMode, useDashboardMode } from "@/lib/dashboardMode";
import { disablePush, enablePush, isPushEnabled, pushSupported } from "@/lib/push";
import type { DashboardMode } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

const VIEW_MODES: {
  key: DashboardMode;
  label: string;
  icon: string;
  hint: string;
}[] = [
  {
    key: "evenementiel",
    label: "Événementiel",
    icon: "event",
    hint: "Prestations et leur avancement",
  },
  {
    key: "maintenance",
    label: "Maintenance",
    icon: "build",
    hint: "Santé du parc et pannes",
  },
];

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const pushOk = pushSupported();

  const viewMode = useDashboardMode(user?.role);

  useEffect(() => {
    if (pushOk) void isPushEnabled().then(setPushOn);
  }, [pushOk]);

  if (!user) return null;
  const fullName = [user.prenom, user.nom].filter(Boolean).join(" ") || user.email;
  const canManage = user.role === "Admin" || user.role === "Staff";

  async function onTogglePush() {
    setPushError(null);
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        await enablePush();
        setPushOn(true);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "permission-denied") {
        setPushError("Autorise les notifications dans les r\u00e9glages du navigateur.");
      } else {
        setPushError("Impossible de modifier les notifications.");
      }
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profil</h1>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
        <Row label="Nom" value={fullName} />
        <Row label="Email" value={user.email} />
        <Row label="Rôle" value={user.role} />
      </dl>

      {canManage && (
        <Link
          to="/fournisseurs"
          className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-bg-soft px-4 py-3"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon name="local_shipping" className="text-xl" />
            Fournisseurs
          </span>
          <Icon name="chevron_right" className="text-xl text-fg-muted" />
        </Link>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Icon name="dashboard" className="text-xl" />
          <h2 className="text-sm font-semibold">Vue d'accueil</h2>
        </div>
        <p className="text-xs text-fg-muted">
          Choisis ce que ton tableau de bord met en avant.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {VIEW_MODES.map((m) => {
            const active = viewMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => dashboardMode.set(m.key)}
                aria-pressed={active}
                className={`flex flex-col gap-1 rounded-xl border px-3 py-3 text-left transition-colors ${
                  active
                    ? "border-fg bg-fg text-bg"
                    : "border-line bg-bg-soft text-fg hover:bg-bg-elev"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon name={m.icon} className="text-lg" />
                  {m.label}
                </span>
                <span
                  className={`text-xs ${active ? "text-bg/80" : "text-fg-muted"}`}
                >
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {pushOk && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="notifications" className="text-xl" />
            <h2 className="text-sm font-semibold">Notifications</h2>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-soft px-4 py-3">
            <p className="text-xs text-fg-muted">
              Reçois une alerte pour les pannes urgentes et le matériel non rendu.
            </p>
            <Button
              variant={pushOn ? "ghost" : "primary"}
              loading={pushBusy}
              className="shrink-0"
              onClick={onTogglePush}
            >
              {pushOn ? "Désactiver" : "Activer"}
            </Button>
          </div>
          {pushError && <p className="text-sm text-danger">{pushError}</p>}
        </section>
      )}

      <Button variant="ghost" className="w-full" onClick={() => void logout()}>
        Se déconnecter
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
