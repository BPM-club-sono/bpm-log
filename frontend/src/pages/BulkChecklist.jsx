import React, { useState, useEffect } from 'react';
import { Package, X, Plus, Minus } from 'lucide-react';

const DEFAULT_BULK_CONTENTS = {
  "BPM-BOX-XLR": [
    { id: "xlr-10m", name: "Câble XLR M/F - 10m", expected: 12, actual: 12 },
    { id: "xlr-5m", name: "Câble XLR M/F - 5m", expected: 20, actual: 20 },
    { id: "xlr-2m", name: "Câble XLR M/F - 2m", expected: 10, actual: 10 },
    { id: "jack-xlr", name: "Adaptateur Jack vers XLR M", expected: 4, actual: 4 }
  ],
  "BPM-BOX-POW": [
    { id: "pc-1.5m", name: "Câble Shuko / Powercon - 1.5m", expected: 8, actual: 8 },
    { id: "pc-5m", name: "Câble Shuko / Powercon - 5m", expected: 4, actual: 4 },
    { id: "triplette", name: "Multiprise 3 plots (Triplette)", expected: 6, actual: 6 },
    { id: "iec-1.5m", name: "Câble Alimentation standard IEC", expected: 10, actual: 10 }
  ]
};

export function BulkChecklist({ currentBulkBox, onCancel, onSubmit }) {
  const [checklist, setChecklist] = useState([]);

  useEffect(() => {
    if (currentBulkBox) {
      // Charger le vrac théorique (fallback par défaut si vide dans le cache)
      const defaultItems = DEFAULT_BULK_CONTENTS[currentBulkBox.id] || [];
      // Copier profondément pour éviter les mutations de cache
      setChecklist(defaultItems.map(item => ({ ...item })));
    }
  }, [currentBulkBox]);

  const triggerHaptics = (pattern = 30) => {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  const adjustQuantity = (id, delta) => {
    triggerHaptics(20);
    setChecklist(prev =>
      prev.map(item => {
        if (item.id === id) {
          const newQty = Math.max(0, item.actual + delta);
          return { ...item, actual: newQty };
        }
        return item;
      })
    );
  };

  const handleValidate = () => {
    triggerHaptics([50, 50, 100]);
    onSubmit(checklist);
  };

  if (!currentBulkBox) return null;

  return (
    <div class="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center transition-all duration-300">
      <div class="w-full bg-bpm-surface border-t border-indigo-900 rounded-t-3xl p-5 shadow-[0_-10px_40px_rgba(0,0,0,0.8)] flex flex-col gap-4 animate-slide-up max-h-[85%]">
        
        {/* Drawer Header */}
        <div class="flex justify-between items-start">
          <div class="flex flex-col">
            <span class="text-[9px] bg-bpm-accent/20 text-bpm-neon px-2 py-0.5 rounded-full font-bold tracking-wider uppercase w-max flex items-center gap-1">
              <Package class="w-2.5 h-2.5" /> Caisse de Vrac
            </span>
            <h3 class="font-bold text-base text-white font-outfit mt-1">{currentBulkBox.name}</h3>
            <p class="text-[10px] text-slate-400 mt-0.5 font-mono">Identifiant : {currentBulkBox.id}</p>
          </div>
          <button 
            onClick={() => { triggerHaptics(30); onCancel(); }}
            class="w-7 h-7 rounded-full bg-slate-800/80 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        {/* Informative banner */}
        <div class="bg-indigo-950/20 rounded-xl p-3 border border-indigo-900/30">
          <p class="text-[10px] text-slate-400 leading-relaxed">
            Vérification de vrac en cours. Veuillez ajuster les quantités physiques réelles si des éléments manquent ou ont été ajoutés à la caisse de transport.
          </p>
        </div>

        {/* Checklist item list */}
        <div class="flex-1 overflow-y-auto space-y-2.5 my-2">
          {checklist.map((item) => {
            const isDifferent = item.actual !== item.expected;
            return (
              <div 
                key={item.id} 
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                  isDifferent 
                    ? 'bg-amber-500/5 border-amber-500/20' 
                    : 'bg-bpm-base/50 border-indigo-950/60'
                }`}
              >
                <div>
                  <h4 class="text-xs font-bold text-slate-200">{item.name}</h4>
                  <span class="text-[10px] text-slate-500">Théorique : {item.expected} unités</span>
                </div>
                
                {/* Controls +/- */}
                <div class="flex items-center gap-3">
                  <button 
                    onClick={() => adjustQuantity(item.id, -1)}
                    class="w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-900 flex items-center justify-center font-bold text-slate-300 hover:bg-indigo-900 active:scale-95 transition-transform"
                  >
                    <Minus class="w-3.5 h-3.5" />
                  </button>
                  <span className={`w-6 text-center font-bold text-sm ${isDifferent ? 'text-amber-400' : 'text-slate-200'}`}>
                    {item.actual}
                  </span>
                  <button 
                    onClick={() => adjustQuantity(item.id, 1)}
                    class="w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-900 flex items-center justify-center font-bold text-slate-300 hover:bg-indigo-900 active:scale-95 transition-transform"
                  >
                    <Plus class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drawer actions */}
        <div class="grid grid-cols-2 gap-3 mt-2 shrink-0">
          <button 
            onClick={() => { triggerHaptics(30); onCancel(); }}
            class="py-3 rounded-xl border border-indigo-950 text-xs font-bold text-slate-400 hover:text-white"
          >
            ANNULER
          </button>
          <button 
            onClick={handleValidate}
            class="py-3 bg-gradient-to-r from-bpm-accent to-bpm-neon text-white rounded-xl text-xs font-bold glow-neon shadow-lg hover:opacity-95"
          >
            VALIDER LE CONTENU
          </button>
        </div>

      </div>
    </div>
  );
}
export default BulkChecklist;
