import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { ApiError } from "@/lib/api";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Email ou mot de passe incorrect."
          : "Connexion impossible. Réessaie plus tard.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Icon name="inventory_2" className="text-4xl" />
          <h1 className="text-2xl font-bold">BPM Log</h1>
          <p className="text-sm text-fg-muted">Gestion du parc matériel</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">Mot de passe</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg"
            />
          </label>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" loading={loading} className="w-full">
          Se connecter
        </Button>
      </form>
    </div>
  );
}
