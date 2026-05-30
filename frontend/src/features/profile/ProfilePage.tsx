import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";

export function ProfilePage() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const fullName = [user.prenom, user.nom].filter(Boolean).join(" ") || user.email;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profil</h1>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
        <Row label="Nom" value={fullName} />
        <Row label="Email" value={user.email} />
        <Row label="Rôle" value={user.role} />
      </dl>
      <Button variant="ghost" className="w-full" onClick={logout}>
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
