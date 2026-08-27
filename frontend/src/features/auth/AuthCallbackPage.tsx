import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { userManager } from "@/lib/oidc";
import { Button } from "@/shared/Button";

/**
 * Étape finale du flow OIDC : authentik nous renvoie ici avec un `code`,
 * échangé contre l'id_token via PKCE. Aucun rendu utile, on redirige.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState(false);
  // React 18 monte deux fois les effets en dev : le code ne vaut qu'un échange.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        await userManager.signinRedirectCallback();
        await refreshUser();
        navigate("/", { replace: true });
      } catch {
        setError(true);
      }
    })();
  }, [navigate, refreshUser]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-danger">Connexion impossible.</p>
        <Button onClick={() => navigate("/login", { replace: true })}>Réessayer</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-fg-muted">Connexion…</div>
  );
}
