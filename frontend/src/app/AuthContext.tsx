import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "@/lib/api";
import { signOut, userManager } from "@/lib/oidc";
import { syncEngine } from "@/lib/syncEngine";
import type { Membre } from "@/lib/types";

// Dernier profil connu, pour rester utilisable hors ligne : l'app est
// offline-first, perdre le réseau ne doit pas déconnecter.
const MEMBRE_CACHE_KEY = "bpm.membre";

function saveCachedMembre(membre: Membre): void {
  try {
    localStorage.setItem(MEMBRE_CACHE_KEY, JSON.stringify(membre));
  } catch {
    // Stockage indisponible (navigation privée) : pas de cache, rien de grave.
  }
}

function loadCachedMembre(): Membre | null {
  try {
    const raw = localStorage.getItem(MEMBRE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Membre) : null;
  } catch {
    return null;
  }
}

function clearCachedMembre(): void {
  try {
    localStorage.removeItem(MEMBRE_CACHE_KEY);
  } catch {
    // idem
  }
}

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
    try {
      // Session OIDC présente, même expirée : `api()` la renouvelle au besoin.
      if (!(await userManager.getUser())) {
        clearCachedMembre();
        setUser(null);
        return;
      }
      try {
        const me = await api<Membre>("/auth/me");
        saveCachedMembre(me);
        setUser(me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // Compte désactivé : fin de session légitime.
          await userManager.removeUser();
          setUser(null);
        } else {
          // Hors ligne, serveur ou authentik injoignable : la session tient
          // toujours, on garde le profil connu. Un refus d'authentik a déjà
          // vidé la session dans `api()` (→ événement unloaded).
          setUser(loadCachedMembre());
        }
      }
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
    const onUnloaded = () => {
      clearCachedMembre();
      setUser(null);
    };
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
    clearCachedMembre();
    setUser(null);
    await signOut();
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
