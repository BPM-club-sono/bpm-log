import { useCallback, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Equipment } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { QrScanner } from "./QrScanner";

type Result =
  | { kind: "not_found"; code: string }
  | { kind: "error"; message: string };

export function ScanPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [loading, setLoading] = useState(false);
  const lastCodeRef = useRef<string>("");

  const resolve = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        const equipment = await api<Equipment>(
          `/equipments/by-barcode/${encodeURIComponent(trimmed)}`,
        );
        if (navigator.vibrate) navigator.vibrate(60);
        navigate(`/inventaire/${equipment.id}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setResult({ kind: "not_found", code: trimmed });
        } else {
          setResult({ kind: "error", message: "Erreur réseau. Réessaie." });
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
              placeholder="BPM-LUM-0001"
              className="h-11 flex-1 rounded-xl border border-line bg-bg-soft px-3 font-mono text-sm outline-none focus:border-fg"
            />
            <Button type="submit" loading={loading} disabled={!manual.trim()}>
              Chercher
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ResultCard({ result, onReset }: { result: Result; onReset: () => void }) {
  const navigate = useNavigate();

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
