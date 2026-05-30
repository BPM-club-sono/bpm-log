import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">Chargement…</div>
    );
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
