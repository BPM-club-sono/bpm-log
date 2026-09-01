import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./app/AuthContext";
import { AppRouter } from "./app/AppRouter";
import { userManager } from "./lib/oidc";
import { ToastProvider } from "./shared/Toast";
import "./index.css";

// Renouvellement silencieux : oidc-client-ts charge `redirect_uri` dans un
// iframe caché. Inutile d'y monter l'application — router, contexte, pages
// paresseuses et leurs requêtes n'y servent à rien, et en dev cela fait
// retélécharger des centaines de modules à chaque renouvellement. On répond au
// parent et on s'arrête là.
if (window.self !== window.top && window.location.pathname === "/auth/callback") {
  void userManager.signinSilentCallback().catch(() => {
    // Le parent tranche via son propre timeout.
  });
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ToastProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </StrictMode>,
  );
}
