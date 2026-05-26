import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, AlertCircle } from 'lucide-react';

export function QRScanner({ onScanSuccess, selectedAction }) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [selectedMockQR, setSelectedMockQR] = useState('');
  const html5QrCodeRef = useRef(null);

  useEffect(() => {
    return () => {
      // Nettoyer la caméra lors du démontage du composant
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(err => console.log('Error stopping reader:', err));
      }
    };
  }, []);

  const triggerHaptics = (pattern = 100) => {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  const startCamera = () => {
    setIsCameraActive(true);
    setTimeout(() => {
      try {
        const html5QrCode = new Html5Qrcode('reader-element');
        html5QrCodeRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 230, height: 230 },
          aspectRatio: 1.0
        };

        html5QrCode.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            triggerHaptics([80, 50, 80]);
            onScanSuccess(decodedText);
            stopCamera();
          },
          () => {
            // Frame error, ignorée pour ne pas polluer la console
          }
        ).catch(err => {
          console.error('Accès caméra échoué:', err);
          setIsCameraActive(false);
          alert("Impossible d'accéder à la caméra arrière (vérifiez les permissions). Utilisez le simulateur de QR codes !");
        });
      } catch (err) {
        console.error('Erreur init scanner:', err);
        setIsCameraActive(false);
      }
    }, 200);
  };

  const stopCamera = () => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop()
        .then(() => {
          setIsCameraActive(false);
          html5QrCodeRef.current = null;
        })
        .catch(err => {
          console.error('Erreur arrêt caméra:', err);
          setIsCameraActive(false);
        });
    } else {
      setIsCameraActive(false);
    }
  };

  const toggleCamera = () => {
    triggerHaptics(30);
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  return (
    <div class="flex flex-col items-center justify-between gap-4 w-full">
      {/* CAMERA VIEWPORT */}
      <div class="relative w-full max-w-[280px] aspect-square rounded-3xl overflow-hidden bg-bpm-surface border border-indigo-950/60 shadow-[inset_0_0_20px_rgba(0,0,0,0.6)] flex items-center justify-center">
        {isCameraActive ? (
          <div id="reader-element" class="w-full h-full object-cover"></div>
        ) : (
          <div class="flex flex-col items-center p-6 text-center text-slate-500">
            <div class="w-16 h-16 rounded-full bg-indigo-950/30 flex items-center justify-center mb-3">
              <CameraOff class="w-8 h-8 text-indigo-400" />
            </div>
            <p class="text-xs font-semibold max-w-[200px]">Caméra inactive</p>
            <p class="text-[10px] text-slate-600 mt-1">
              Activez la caméra physique ou utilisez le simulateur ci-dessous pour tester.
            </p>
          </div>
        )}

        {/* Viewfinder overlay */}
        <div class="absolute inset-5 border-2 border-dashed border-bpm-accent/30 rounded-2xl pointer-events-none flex items-center justify-center">
          {/* Neon corners */}
          <div class="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-bpm-neon rounded-tl-md"></div>
          <div class="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-bpm-neon rounded-tr-md"></div>
          <div class="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-bpm-neon rounded-bl-md"></div>
          <div class="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-bpm-neon rounded-br-md"></div>

          {/* Laser scanning bar */}
          {isCameraActive && (
            <div class="absolute left-1/10 right-1/10 h-0.5 bg-gradient-to-r from-transparent via-bpm-neon to-transparent shadow-[0_0_10px_#c084fc] laser-line"></div>
          )}
        </div>
      </div>

      {/* Camera activation button */}
      <button
        onClick={toggleCamera}
        className={`px-6 py-2.5 rounded-full font-semibold text-xs tracking-wider transition-all duration-300 flex items-center gap-2 ${
          isCameraActive
            ? 'bg-bpm-red/20 border border-bpm-red/30 text-bpm-red'
            : 'bg-bpm-accent hover:bg-purple-600 text-white glow-neon shadow-lg shadow-bpm-accent/30'
        }`}
      >
        <Camera class="w-4 h-4" />
        {isCameraActive ? 'DÉSACTIVER LA CAMÉRA' : 'ACTIVER LA CAMÉRA REELLE'}
      </button>

      {/* MOCK SCAN SIMULATOR */}
      <div class="w-full glass rounded-2xl p-4 border border-indigo-950/40 mt-2">
        <h3 class="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5 uppercase tracking-wide">
          <span>🛠️ Simulateur QR Code BPM</span>
        </h3>
        <p class="text-[10px] text-slate-500 mb-3">
          Simulez la lecture instantanée d'un QR code pour tester les cas de gros matériel ou vrac sans caméra.
        </p>

        <div class="flex gap-2">
          <select
            value={selectedMockQR}
            onChange={(e) => setSelectedMockQR(e.target.value)}
            class="flex-1 bg-bpm-base border border-indigo-950/80 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-bpm-accent/60"
          >
            <option value="">-- Choisir un QR Code --</option>
            <optgroup label="Gros Matériel (Individuel)">
              <option value="BPM-EQ-001">Lyre Beam Wash 150W (BPM-EQ-001)</option>
              <option value="BPM-EQ-002">Ampli Crown 2x600W (BPM-EQ-002)</option>
              <option value="BPM-EQ-003">Console Behringer X32 (BPM-EQ-003)</option>
              <option value="BPM-EQ-004">Pied Alu Renforcé (BPM-EQ-004)</option>
            </optgroup>
            <optgroup label="Caisses Vrac (Checklist)">
              <option value="BPM-BOX-XLR">Caisse Vrac Câbles XLR (BPM-BOX-XLR)</option>
              <option value="BPM-BOX-POW">Caisse Vrac Alims & Multi (BPM-BOX-POW)</option>
            </optgroup>
          </select>
          <button
            onClick={() => {
              if (selectedMockQR) {
                triggerHaptics([60, 40]);
                onScanSuccess(selectedMockQR);
              }
            }}
            disabled={!selectedMockQR}
            className="px-4 py-2 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-800/30 rounded-xl text-xs font-bold text-bpm-neon transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Scanner
          </button>
        </div>
      </div>
    </div>
  );
}
export default QRScanner;
