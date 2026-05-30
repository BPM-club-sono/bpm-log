import { useAuth } from "@/app/AuthContext";
import { Icon } from "@/shared/Icon";

const shortcuts = [
  { icon: "qr_code_scanner", label: "Scanner du matériel" },
  { icon: "build", label: "Déclarer une panne" },
  { icon: "inventory", label: "Inventaire vrac" },
  { icon: "event", label: "Prestations" },
];

export function HomePage() {
  const { user } = useAuth();
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
