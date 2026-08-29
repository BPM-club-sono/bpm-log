import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { EquipmentMirrorRow } from "@/lib/db";
import {
  findByBarcode,
  mirrorCount,
  refreshEquipmentMirror,
} from "@/lib/equipmentMirror";
import type { Equipment } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";
import { QrScanner } from "./QrScanner";

type Result =
  /** Résolu depuis le miroir local, sans réseau. */
  | { kind: "local"; eq: EquipmentMirrorRow }
  /** Le serveur a répondu : ce code n'existe pas au parc. */
  | { kind: "not_found"; code: string }
  /** Hors ligne et absent du miroir : on ne peut pas trancher. */
  | { kind: "unknown_offline"; code: string }
  | { kind: "error"; message: string };

export function ScanPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [loading, setLoading] = useState(false);
  const [mirrored, setMirrored] = useState<number | null>(null);
  const lastCodeRef = useRef<string>("");

  // Le miroir sert de repli hors ligne : on le rafraîchit à l'ouverture du
  // scanner, moment où l'appareil est encore souvent connecté (départ dépôt).
  useEffect(() => {
    let active = true;
    async function prime() {
      await refreshEquipmentMirror();
      if (active) setMirrored(await mirrorCount());
    }
    void prime();
    return () => {
      active = false;
    };
  }, []);

  const resolve = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        const local = await findByBarcode(trimmed);

        // Hors ligne : le miroir est la seule source disponible.
        if (!navigator.onLine) {
          if (navigator.vibrate && local) navigator.vibrate(60);
          setResult(
            local
              ? { kind: "local", eq: local }
              : { kind: "unknown_offline", code: trimmed },
          );
          return;
        }

        // En ligne : le serveur fait foi (le miroir peut être périmé).
        try {
          const equipment = await api<Equipment>(
            `/equipments/by-barcode/${encodeURIComponent(trimmed)}`,
          );
          if (navigator.vibrate) navigator.vibrate(60);
          navigate(`/inventaire/${equipment.id}`);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setResult({ kind: "not_found", code: trimmed });
          } else if (local) {
            // `navigator.onLine` ment volontiers (wifi capté, pas d'internet) :
            // le miroir prend le relais plutôt que d'afficher une erreur sèche.
            if (navigator.vibrate) navigator.vibrate(60);
            setResult({ kind: "local", eq: local });
          } else {
            setResult({ kind: "error", message: "Erreur réseau. Réessaie." });
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  const onScan = useCallback(
    (text: string) => {
      // Anti-rebond : ignore les lectures répétées du même code.
      if (text === lastCodeRef.current) return;
      lastCodeRef.current = text;
      void resolve(text);
    },
    [resolve],
  );

  function onManualSubmit(e: FormEvent) {
    e.preventDefault();
    lastCodeRef.current = manual.trim();
    void resolve(manual);
  }

  function reset() {
    setResult(null);
    setManual("");
    lastCodeRef.current = "";
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Scanner</h1>
        <p className="text-sm text-fg-muted">Vise un QR code matériel</p>
      </header>

      {!result && <QrScanner onScan={onScan} paused={loading} />}

      {result && <ResultCard result={result} onReset={reset} />}

      {!result && (
        <form onSubmit={onManualSubmit} className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">
            Ou saisis le code-barres manuellement
          </label>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="BPM-000001"
              className="h-11 flex-1 rounded-xl border border-line bg-bg-soft px-3 font-mono text-sm outline-none focus:border-fg"
            />
            <Button type="submit" loading={loading} disabled={!manual.trim()}>
              Chercher
            </Button>
          </div>
        </form>
      )}

      {!result && mirrored !== null && (
        <p className="text-center text-xs text-fg-muted">
          {mirrored > 0
            ? `${mirrored} équipements disponibles hors ligne`
            : "Parc non disponible hors ligne — connecte-toi une fois pour le précharger"}
        </p>
      )}
    </div>
  );
}

function ResultCard({ result, onReset }: { result: Result; onReset: () => void }) {
  const navigate = useNavigate();

  if (result.kind === "local") {
    const { eq } = result;
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-bg-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{eq.nom}</p>
            <p className="font-mono text-xs text-fg-muted">{eq.barcode_uid}</p>
          </div>
          <StatusBadge statut={eq.statut_actuel} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Icon name="cloud_off" className="text-base" />
          Hors ligne — données du dernier passage en ligne.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => navigate(`/inventaire/${eq.id}`)}>
            <Icon name="info" className="text-xl" />
            Fiche
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              navigate(`/pannes?barcode=${encodeURIComponent(eq.barcode_uid)}`)
            }
          >
            <Icon name="build" className="text-xl" />
            Déclarer une panne
          </Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onReset}>
          <Icon name="qr_code_scanner" className="text-xl" />
          Scanner un autre
        </Button>
      </div>
    );
  }

  if (result.kind === "unknown_offline") {
    return (
      <div className="space-y-4 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-center">
        <Icon name="cloud_off" className="text-4xl text-warning" />
        <p className="text-sm">
          Code <span className="font-mono">{result.code}</span> absent du parc
          préchargé. Impossible de vérifier hors ligne.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              navigate(`/pannes?barcode=${encodeURIComponent(result.code)}`)
            }
          >
            <Icon name="build" className="text-xl" />
            Déclarer une panne
          </Button>
          <Button variant="ghost" onClick={onReset}>
            <Icon name="qr_code_scanner" className="text-xl" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (result.kind === "not_found") {
    return (
      <div className="space-y-4 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-center">
        <Icon name="error" className="text-4xl text-warning" />
        <p className="text-sm">
          Code <span className="font-mono">{result.code}</span> inconnu dans le parc.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              navigate(`/pannes?barcode=${encodeURIComponent(result.code)}`)
            }
          >
            <Icon name="build" className="text-xl" />
            Déclarer une panne
          </Button>
          <Button variant="ghost" onClick={onReset}>
            <Icon name="qr_code_scanner" className="text-xl" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-center">
      <p className="text-sm text-danger">{result.message}</p>
      <Button variant="ghost" className="w-full" onClick={onReset}>
        Réessayer
      </Button>
    </div>
  );
}
