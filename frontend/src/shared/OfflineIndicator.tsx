import { useEffect, useState } from "react";
import { useSync } from "@/lib/useSync";
import { Icon } from "./Icon";

export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const { pending, syncing } = useSync();

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!online) {
    return (
      <div className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-xs font-medium text-warning">
        <Icon name="cloud_off" className="text-base" />
        Hors ligne — {pending > 0 ? `${pending} en attente` : "modifications synchronisées plus tard"}
      </div>
    );
  }

  if (pending > 0 || syncing) {
    return (
      <div className="flex items-center justify-center gap-2 bg-bg-elev px-4 py-1.5 text-xs font-medium text-fg-muted">
        <Icon
          name="sync"
          className={`text-base ${syncing ? "animate-spin" : ""}`}
        />
        {syncing ? "Synchronisation…" : `${pending} en attente de synchro`}
      </div>
    );
  }

  return null;
}

