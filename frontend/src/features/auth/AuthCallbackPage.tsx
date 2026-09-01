import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/AuthContext";
import { userManager } from "@/lib/oidc";
import { Button } from "@/shared/Button";

/**
 * Étape finale du flow OIDC : authentik nous renvoie ici avec un `code`,
 * échangé contre l'id_token via PKCE. Aucun rendu utile, on redirige.
 *
 * Cette route sert aussi de cible au renouvellement silencieux : faute de
 * `silent_redirect_uri`, oidc-client-ts retombe sur `redirect_uri` et charge
 * cette page dans un iframe caché. Il y attend le message de
 * `signinSilentCallback` ; un `signinRedirectCallback` ne le poste jamais, donc
 * le renouvellement partait en timeout de 10 s pendant que l'app entière se
 * rechargeait dans l'iframe. D'où la distinction ci-dessous.
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
      // Dans l'iframe de renouvellement : rendre la main à la lib, sans toucher
      // à la navigation de la fenêtre principale.
      if (window.self !== window.top) {
        try {
          await userManager.signinSilentCallback();
        } catch {
          // Le parent tranche via son propre timeout ; rien à afficher ici.
        }
        return;
      }
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
