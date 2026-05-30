import { Outlet } from "react-router-dom";
import { OfflineIndicator } from "@/shared/OfflineIndicator";
import { TabBar } from "@/shared/TabBar";

export function AppLayout() {
  return (
    <div className="flex h-full flex-col">
      <OfflineIndicator />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md px-4 py-4">
          <Outlet />
        </div>
      </main>
      <TabBar />
    </div>
  );
}
