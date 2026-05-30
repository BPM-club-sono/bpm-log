import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSync } from "@/lib/useSync";
import { Icon } from "./Icon";

export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const { pending, syncing, conflicts } = useSync();

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

  if (conflicts > 0) {
    return (
      <Link
        to="/conflits"
        className="flex items-center justify-center gap-2 bg-danger/15 px-4 py-1.5 text-xs font-medium text-danger"
      >
        <Icon name="error" className="text-base" />
        {conflicts} conflit{conflicts > 1 ? "s" : ""} à arbitrer
      </Link>
    );
  }

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

