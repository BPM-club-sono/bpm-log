import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QrScannerProps {
  /** Appelé avec le texte décodé à chaque QR lu. */
  onScan: (text: string) => void;
  /** Désactive temporairement la lecture (ex: pendant l'affichage d'un résultat). */
  paused?: boolean;
}

const REGION_ID = "qr-scanner-region";

export function QrScanner({ onScan, paused = false }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  const [error, setError] = useState<string | null>(null);

  // Garde les dernières valeurs sans relancer la caméra.
  useEffect(() => {
    onScanRef.current = onScan;
    pausedRef.current = paused;
  }, [onScan, paused]);

  useEffect(() => {
    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    scannerRef.current = scanner;
    let cancelled = false;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewW, viewH) => {
            const size = Math.floor(Math.min(viewW, viewH) * 0.6);
            return { width: size, height: size };
          },
        },
        (decodedText) => {
          if (pausedRef.current) return;
          onScanRef.current(decodedText);
        },
        () => {
          // Erreurs de décodage par frame : ignorées (bruit normal).
        },
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Accès caméra refusé. Autorise la caméra ou saisis le code manuellement."
            : "Caméra indisponible. Saisis le code manuellement.",
        );
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s && s.isScanning) {
        void s.stop().then(() => s.clear()).catch(() => undefined);
      }
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-line bg-bg-soft p-4 text-center text-sm text-warning">
        {error}
      </div>
    );
  }

  return (
    <div
      id={REGION_ID}
      className="overflow-hidden rounded-2xl border border-line bg-black [&_video]:w-full"
    />
  );
}
