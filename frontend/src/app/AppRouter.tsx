import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";

// Pages chargées en lazy → code-splitting par route (bundle initial réduit,
// chaque écran est un chunk séparé mis en cache par le service worker).
const LoginPage = lazy(() =>
  import("@/features/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const HomePage = lazy(() =>
  import("@/features/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const CatalogPage = lazy(() =>
  import("@/features/catalog/CatalogPage").then((m) => ({ default: m.CatalogPage })),
);
const EquipmentDetailPage = lazy(() =>
  import("@/features/equipment/EquipmentDetailPage").then((m) => ({
    default: m.EquipmentDetailPage,
  })),
);
const EquipmentCreatePage = lazy(() =>
  import("@/features/equipment/EquipmentCreatePage").then((m) => ({
    default: m.EquipmentCreatePage,
  })),
);
const ExplorerPage = lazy(() =>
  import("@/features/equipment/ExplorerPage").then((m) => ({
    default: m.ExplorerPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/features/profile/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const ScanPage = lazy(() =>
  import("@/features/scan/ScanPage").then((m) => ({ default: m.ScanPage })),
);
const LabelsPage = lazy(() =>
  import("@/features/labels/LabelsPage").then((m) => ({ default: m.LabelsPage })),
);
const PannesPage = lazy(() =>
  import("@/features/pannes/PannesPage").then((m) => ({ default: m.PannesPage })),
);
const PannesListPage = lazy(() =>
  import("@/features/pannes/PannesListPage").then((m) => ({ default: m.PannesListPage })),
);
const TicketDetailPage = lazy(() =>
  import("@/features/pannes/TicketDetailPage").then((m) => ({ default: m.TicketDetailPage })),
);
const ConflictsPage = lazy(() =>
  import("@/features/sync/ConflictsPage").then((m) => ({ default: m.ConflictsPage })),
);
const PrestationsPage = lazy(() =>
  import("@/features/prestations/PrestationsPage").then((m) => ({
    default: m.PrestationsPage,
  })),
);
const PrestationDetailPage = lazy(() =>
  import("@/features/prestations/PrestationDetailPage").then((m) => ({
    default: m.PrestationDetailPage,
  })),
);
const FournisseursPage = lazy(() =>
  import("@/features/fournisseurs/FournisseursPage").then((m) => ({
    default: m.FournisseursPage,
  })),
);

function PageFallback() {
  return <p className="p-8 text-center text-sm text-fg-muted">Chargement…</p>;
}

function lazyRoute(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

const router = createBrowserRouter([
  { path: "/login", element: lazyRoute(<LoginPage />) },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: lazyRoute(<HomePage />) },
          { path: "/scan", element: lazyRoute(<ScanPage />) },
          { path: "/inventaire", element: lazyRoute(<CatalogPage />) },
          { path: "/inventaire/rangement", element: lazyRoute(<ExplorerPage />) },
          { path: "/inventaire/nouveau", element: lazyRoute(<EquipmentCreatePage />) },
          { path: "/inventaire/:id", element: lazyRoute(<EquipmentDetailPage />) },
          { path: "/etiquettes", element: lazyRoute(<LabelsPage />) },
          { path: "/pannes", element: lazyRoute(<PannesPage />) },
          { path: "/pannes/liste", element: lazyRoute(<PannesListPage />) },
          { path: "/pannes/:id", element: lazyRoute(<TicketDetailPage />) },
          { path: "/conflits", element: lazyRoute(<ConflictsPage />) },
          { path: "/prestations", element: lazyRoute(<PrestationsPage />) },
          { path: "/prestations/:id", element: lazyRoute(<PrestationDetailPage />) },
          { path: "/fournisseurs", element: lazyRoute(<FournisseursPage />) },
          { path: "/profil", element: lazyRoute(<ProfilePage />) },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
