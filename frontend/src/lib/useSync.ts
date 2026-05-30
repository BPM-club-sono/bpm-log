import { useEffect, useState } from "react";
import { syncEngine, type SyncState } from "./syncEngine";

const INITIAL: SyncState = { pending: 0, syncing: false, conflicts: 0 };

/** Expose l'état de la file de synchronisation (réactif). */
export function useSync(): SyncState {
  const [state, setState] = useState<SyncState>(INITIAL);
  useEffect(() => syncEngine.subscribe(setState), []);
  return state;
}
