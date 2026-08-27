import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { getIdToken, userManager } from "@/lib/oidc";
import { syncEngine } from "@/lib/syncEngine";
import type { Membre } from "@/lib/types";

interface AuthState {
  user: Membre | null;
  loading: boolean;
  /** Redirige vers authentik, qui redirige lui-même vers Google. */
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Recharge le profil, après le retour sur /auth/callback notamment. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Membre | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!(await getIdToken())) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<Membre>("/auth/me"));
    } catch {
      await userManager.removeUser();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Un renouvellement silencieux ou une déconnexion ailleurs doit se refléter ici.
  useEffect(() => {
    const onLoaded = () => void loadMe();
    const onUnloaded = () => setUser(null);
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    return () => {
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
    };
  }, [loadMe]);

  // Le moteur de sync ne tourne que lorsqu'un membre est authentifié.
  useEffect(() => {
    if (user) {
      syncEngine.start();
      return () => syncEngine.stop();
    }
  }, [user]);

  const login = useCallback(async () => {
    await userManager.signinRedirect();
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    // Ferme aussi la session authentik : sinon le cookie SSO encore valide
    // reconnecterait immédiatement sans rien demander.
    await userManager.signoutRedirect();
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser: loadMe }),
    [user, loading, login, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}
