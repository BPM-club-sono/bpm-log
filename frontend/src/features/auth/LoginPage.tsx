import { useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

export function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setError(null);
    setLoading(true);
    try {
      // Redirige hors de l'app : si on revient ici, c'est que ça a échoué.
      await login();
    } catch {
      setError("Connexion impossible. Réessaie plus tard.");
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Icon name="inventory_2" className="text-4xl" />
          <h1 className="text-2xl font-bold">BPM Log</h1>
          <p className="text-sm text-fg-muted">Gestion du parc matériel</p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="button" loading={loading} onClick={onLogin} className="w-full">
          Se connecter avec Google
        </Button>

        <p className="text-center text-xs text-fg-muted">
          Réservé aux membres du club. Contacte le bureau si ton compte n'est pas reconnu.
        </p>
      </div>
    </div>
  );
}
