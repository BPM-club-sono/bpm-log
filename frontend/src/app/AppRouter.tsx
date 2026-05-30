import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { HomePage } from "@/features/home/HomePage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { ScanPage } from "@/features/scan/ScanPage";
import { LabelsPage } from "@/features/labels/LabelsPage";
import { PannesPage } from "@/features/pannes/PannesPage";
import { ConflictsPage } from "@/features/sync/ConflictsPage";
import { PrestationsPage } from "@/features/prestations/PrestationsPage";
import { PrestationDetailPage } from "@/features/prestations/PrestationDetailPage";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/scan", element: <ScanPage /> },
          { path: "/inventaire", element: <CatalogPage /> },
          { path: "/etiquettes", element: <LabelsPage /> },
          {
            path: "/pannes",
            element: <PannesPage />,
          },
          { path: "/conflits", element: <ConflictsPage /> },
          { path: "/prestations", element: <PrestationsPage /> },
          { path: "/prestations/:id", element: <PrestationDetailPage /> },
          { path: "/profil", element: <ProfilePage /> },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
