import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { Icon } from "@/shared/Icon";

const shortcuts = [
  { icon: "qr_code_scanner", label: "Scanner du matériel", to: "/scan" },
  { icon: "build", label: "Déclarer une panne", to: "/pannes" },
  { icon: "inventory", label: "Inventaire vrac", to: "/vrac" },
  { icon: "category", label: "Consommables", to: "/consommables" },
  { icon: "event", label: "Prestations", to: "/prestations" },
];

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prenom = user?.prenom ?? "";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-fg-muted">Bonjour {prenom}</p>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
      </header>

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
