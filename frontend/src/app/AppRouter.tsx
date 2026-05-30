import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { HomePage } from "@/features/home/HomePage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { PlaceholderPage } from "@/features/PlaceholderPage";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/scan", element: <PlaceholderPage title="Scan" icon="qr_code_scanner" /> },
          { path: "/inventaire", element: <CatalogPage /> },
          {
            path: "/pannes",
            element: <PlaceholderPage title="Déclarer une panne" icon="build" />,
          },
          {
            path: "/prestations",
            element: <PlaceholderPage title="Prestations" icon="event" />,
          },
          { path: "/profil", element: <ProfilePage /> },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
