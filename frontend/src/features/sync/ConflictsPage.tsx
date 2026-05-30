import { useCallback, useEffect, useState } from "react";
import { syncEngine } from "@/lib/syncEngine";
import type { SyncQueueItem } from "@/lib/db";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

const TYPE_LABEL: Record<SyncQueueItem["type"], string> = {
  ticket_reparation: "Déclaration de panne",
  log_scan: "Scan",
  presta_check: "Pointage de prestation",
};

export function ConflictsPage() {
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const conflicts = await syncEngine.listConflicts();
    setItems(conflicts);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function retry(item: SyncQueueItem) {
    const newBarcode = edits[item.uuid_client]?.trim();
    const patch =
      newBarcode && newBarcode !== item.payload.barcode_uid
        ? { barcode_uid: newBarcode }
        : undefined;
    await syncEngine.retryItem(item.uuid_client, patch);
    await reload();
  }

  async function discard(uuid: string) {
    await syncEngine.discardItem(uuid);
    await reload();
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-fg-muted">Chargement…</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-fg-muted">
        <Icon name="task_alt" className="text-5xl text-success" />
        <p className="text-sm">Aucun conflit à arbitrer.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Conflits</h1>
        <p className="text-sm text-fg-muted">
          {items.length} élément{items.length > 1 ? "s" : ""} à arbitrer
        </p>
      </header>

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.uuid_client}
            className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{TYPE_LABEL[item.type]}</p>
                <p className="text-xs text-fg-muted">
                  {new Date(item.offline_created_at).toLocaleString("fr-FR")}
                </p>
              </div>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                {item.retry_count} essai{item.retry_count > 1 ? "s" : ""}
              </span>
            </div>

            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {item.last_error}
            </p>

            {typeof item.payload.barcode_uid === "string" && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-fg-muted">
                  Code-barres
                </label>
                <input
                  defaultValue={item.payload.barcode_uid}
                  onChange={(e) =>
                    setEdits((prev) => ({
                      ...prev,
                      [item.uuid_client]: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-line bg-bg-soft px-3 font-mono text-sm outline-none focus:border-fg"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => retry(item)}>
                <Icon name="refresh" className="text-lg" />
                Réessayer
              </Button>
              <Button variant="danger" onClick={() => discard(item.uuid_client)}>
                <Icon name="delete" className="text-lg" />
                Abandonner
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
