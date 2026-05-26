import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedLocalDb } from './db/localDb';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { synchronizeQueue, fetchCatalogFromServer } from './services/syncEngine';
import { QRScanner } from './components/QRScanner';
import { BulkChecklist } from './pages/BulkChecklist';

// Lucide icons
import { 
  Wifi, 
  WifiOff, 
  Scan, 
  Layers, 
  History, 
  Database,
  ArrowRightLeft, 
  Info, 
  RefreshCw, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'queue' | 'inventory'
  const isOnline = useNetworkStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Action en cours de sélection (SORTIE, ENTRÉE, PANNE)
  const [selectedAction, setSelectedAction] = useState('SORTIE');
  
  // Caisses de vrac en cours de checklist
  const [currentBulkBox, setCurrentBulkBox] = useState(null);
  
  // Notification visuelle éphémère (style Toast iOS)
  const [notification, setNotification] = useState('');

  // Live queries réactives Dexie.js
  const equipmentList = useLiveQuery(() => db.equipment.toArray()) || [];
  const syncQueue = useLiveQuery(() => db.sync_queue.toArray()) || [];
  const syncedHistory = useLiveQuery(() => db.synced_movements.toArray()) || [];

  useEffect(() => {
    // Initialiser IndexedDB locale
    seedLocalDb();
    
    // Tenter de charger le catalogue mis à jour depuis le serveur FastAPI au boot si en ligne
    if (isOnline) {
      fetchCatalogFromServer();
    }
  }, []);

  // Déclencher une synchronisation en tâche de fond automatique lors de la reconnexion réseau
  useEffect(() => {
    if (isOnline && syncQueue.length > 0) {
      handleSync();
    }
  }, [isOnline, syncQueue.length]);

  const triggerHaptics = (pattern = 100) => {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  const showToast = (message) => {
    setNotification(message);
    setTimeout(() => {
      setNotification('');
    }, 3000);
  };

  // Traiter la détection d'un QR code
  const handleQRDetected = async (qrCode) => {
    const item = await db.equipment.get(qrCode);
    
    if (!item) {
      triggerHaptics([100, 50, 100]);
      showToast(`⚠️ QR Code inconnu : "${qrCode}"`);
      return;
    }

    if (item.isBulk) {
      // Si caisse de vrac, ouvrir le tiroir check-list interactif
      setCurrentBulkBox(item);
    } else {
      // Matériel individuel normal
      await registerMovement(item, selectedAction, { type: 'individuel' });
    }
  };

  // Enregistrer un scan en local (IndexedDB)
  const registerMovement = async (equipment, action, details) => {
    const uuid = `mv-${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();

    const newMovement = {
      id: uuid,
      equipment_id: equipment.id,
      action: action,
      timestamp: now,
      details: JSON.stringify(details),
      offline_created_at: now
    };

    await db.sync_queue.add(newMovement);
    triggerHaptics([80, 40]);
    showToast(`✅ Mouvement enregistré (${action}) !`);

    // Lancer une sync auto instantanée si réseau disponible
    if (isOnline) {
      handleSync();
    }
  };

  // Synchronisation des scans
  const handleSync = async () => {
    if (isSyncing || syncQueue.length === 0) return;
    setIsSyncing(true);
    showToast('🔄 Synchronisation avec le serveur...');

    const result = await synchronizeQueue();
    setIsSyncing(false);

    if (result.success) {
      showToast(`⚡ ${result.count} scans synchronisés !`);
    } else {
      showToast(`⚠️ Échec : ${result.error}`);
    }
  };

  // Soumission de la checklist vrac complétée
  const handleBulkChecklistSubmit = async (checklistContents) => {
    if (!currentBulkBox) return;
    
    await registerMovement(currentBulkBox, selectedAction, {
      type: 'vrac',
      contents: checklistContents.map(i => ({ name: i.name, actual: i.actual, expected: i.expected }))
    });

    setCurrentBulkBox(null);
  };

  return (
    <div className="w-full max-w-md min-h-screen sm:min-h-[850px] sm:max-h-[850px] bg-bpm-base sm:rounded-3xl sm:shadow-[0_0_50px_rgba(0,0,0,0.8)] border-0 sm:border border-indigo-950/50 flex flex-col overflow-hidden relative mx-auto my-0 sm:my-4">
      
      {/* Toast Notification */}
      {notification && (
        <div className="absolute top-16 left-4 right-4 z-50 glass border-bpm-accent/50 rounded-2xl p-4 shadow-xl flex items-center justify-between animate-bounce transition-all duration-300">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-bpm-neon animate-ping"></span>
            <span className="font-medium text-xs text-purple-200">{notification}</span>
          </div>
          <Info className="w-4 h-4 text-bpm-neon" />
        </div>
      )}

      {/* TOP HEADER */}
      <header className="p-4 border-b border-indigo-950/40 bg-bpm-surface/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-bpm-accent to-bpm-neon flex items-center justify-center font-bold text-white shadow-md shadow-bpm-accent/20 font-outfit text-lg">
            B
          </div>
          <div>
            <h1 className="font-semibold text-sm font-outfit leading-tight tracking-wide bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">BPM LOG</h1>
            <span className="text-[10px] text-slate-500 font-medium">Logistique de Terrain</span>
          </div>
        </div>

        {/* Network status and manual toggle for testing */}
        <div className="flex items-center gap-2">
          {isOnline && syncQueue.length > 0 && (
            <button 
              onClick={handleSync}
              disabled={isSyncing}
              className="p-1.5 rounded-lg bg-bpm-accent/10 border border-bpm-accent/20 text-bpm-neon active:scale-95 transition-transform"
            >
              {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          )}

          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold tracking-wider ${
            isOnline 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <Wifi className="w-3 h-3 animate-pulse" /> : <WifiOff className="w-3 h-3 animate-bounce" />}
            {isOnline ? 'EN LIGNE' : 'HORS LIGNE'}
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col relative">
        
        {/* VIEW 1: SCANNER */}
        {activeTab === 'scan' && (
          <div className="flex-1 flex flex-col justify-between gap-4">
            
            {/* Mode selection grid */}
            <div className="grid grid-cols-3 gap-2 bg-bpm-surface/40 p-1 rounded-xl border border-indigo-950/20 shrink-0">
              <button 
                onClick={() => { setSelectedAction('SORTIE'); triggerHaptics(30); }}
                className={`py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                  selectedAction === 'SORTIE' 
                    ? 'bg-bpm-accent text-white shadow-md shadow-bpm-accent/10' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                SORTIE
              </button>
              <button 
                onClick={() => { setSelectedAction('ENTRÉE'); triggerHaptics(30); }}
                className={`py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                  selectedAction === 'ENTRÉE' 
                    ? 'bg-bpm-green/80 text-white shadow-md shadow-bpm-green/10' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                RETOUR
              </button>
              <button 
                onClick={() => { setSelectedAction('PANNE'); triggerHaptics(30); }}
                className={`py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                  selectedAction === 'PANNE' 
                    ? 'bg-bpm-red/80 text-white shadow-md shadow-bpm-red/10' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                SIGNALER PANNE
              </button>
            </div>

            {/* QR Scanner Module */}
            <div className="flex-1 flex items-center justify-center">
              <QRScanner onScanSuccess={handleQRDetected} selectedAction={selectedAction} />
            </div>

          </div>
        )}

        {/* VIEW 2: OFFLINE QUEUE & SYNC HISTORY */}
        {activeTab === 'queue' && (
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">File d'attente ({syncQueue.length})</h2>
              
              {syncQueue.length > 0 && (
                <button 
                  onClick={handleSync}
                  disabled={!isOnline || isSyncing}
                  className={`px-4 py-1.5 rounded-xl text-[10px] font-bold tracking-wider transition-all duration-300 flex items-center gap-1.5 ${
                    isOnline 
                      ? 'bg-bpm-accent text-white glow-neon hover:opacity-90' 
                      : 'bg-indigo-950/30 text-slate-600 border border-indigo-950/20 cursor-not-allowed'
                  }`}
                >
                  {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Synchroniser'}
                </button>
              )}
            </div>

            {/* Queued lists */}
            <div className="flex-1 min-h-[150px] max-h-[300px] overflow-y-auto space-y-2 border border-indigo-950/10 p-1">
              {syncQueue.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center text-center text-slate-600">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/20 mb-2" />
                  <p className="text-xs font-medium">Aucun scan en attente</p>
                  <p className="text-[10px] text-slate-700 mt-0.5">Tous les mouvements sont synchronisés avec la base.</p>
                </div>
              ) : (
                syncQueue.map((item) => (
                  <div key={item.id} className="glass p-3 rounded-xl border-l-4 border-l-bpm-accent flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-white">{item.equipment_id}</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${
                          item.action === 'SORTIE' ? 'bg-bpm-accent/20 text-bpm-neon' :
                          item.action === 'ENTRÉE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {item.action}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1">
                        Créé localement à {new Date(item.offline_created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className="text-[8px] font-bold text-bpm-neon animate-pulse bg-bpm-neon/10 px-2 py-0.5 rounded-full border border-bpm-neon/20">OFFLINE</span>
                  </div>
                ))
              )}
            </div>

            {/* Synced history */}
            <div className="flex-1 flex flex-col gap-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Historique récent synchronisé
              </h3>
              <div className="flex-1 overflow-y-auto space-y-2 border border-indigo-950/10 p-1">
                {syncedHistory.length === 0 ? (
                  <div className="h-24 flex items-center justify-center text-xs text-slate-600 text-center">
                    Aucun log synchronisé dans cette session.
                  </div>
                ) : (
                  syncedHistory.slice(0, 8).map((item) => (
                    <div key={item.id} className="bg-indigo-950/10 border border-indigo-950/40 p-2.5 rounded-xl flex justify-between items-center opacity-85">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs text-slate-300">{item.equipment_id}</span>
                          <span className={`text-[8px] font-bold ${
                            item.action === 'SORTIE' ? 'text-bpm-accent' :
                            item.action === 'ENTRÉE' ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {item.action}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          Scanné à {new Date(item.offline_created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <span className="text-[8px] text-emerald-400 font-bold bg-emerald-400/5 border border-emerald-400/10 px-2 py-0.5 rounded-full">SYNCRONISÉ</span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* VIEW 3: INVENTORY STOCKS */}
        {activeTab === 'inventory' && (
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Catalogue Stock local ({equipmentList.length})</h2>
              {isOnline && (
                <button 
                  onClick={async () => {
                    triggerHaptics(30);
                    showToast("🔄 Rafraîchissement catalogue...");
                    await fetchCatalogFromServer();
                  }}
                  className="p-1 rounded-lg bg-indigo-950/60 border border-indigo-900 text-slate-400 hover:text-white"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {equipmentList.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-xs text-slate-500 text-center">
                  Aucun matériel enregistré localement.
                </div>
              ) : (
                equipmentList.map((item) => (
                  <div key={item.id} className="glass p-3 rounded-xl flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-200">{item.name}</span>
                        <span className="text-[7px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-extrabold tracking-wide uppercase">{item.category}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[9px] text-slate-500">
                        <span className="font-mono">{item.id}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${item.isBulk ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                          {item.type}
                        </span>
                      </div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${
                      item.status === 'Disponible' 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : item.status === 'En Réparation' 
                          ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </main>

      {/* BULKCHECKLIST MODAL DRAWER */}
      {currentBulkBox && (
        <BulkChecklist 
          currentBulkBox={currentBulkBox} 
          onCancel={() => setCurrentBulkBox(null)} 
          onSubmit={handleBulkChecklistSubmit} 
        />
      )}

      {/* PERSISTENT BOTTOM NAVIGATION */}
      <nav className="p-3 bg-bpm-surface/80 border-t border-indigo-950/50 flex justify-around items-center shrink-0">
        <button 
          onClick={() => { triggerHaptics(30); setActiveTab('scan'); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all duration-200 ${
            activeTab === 'scan' ? 'text-bpm-neon scale-105' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Scan className="w-4 h-4" />
          <span className="text-[9px] font-bold tracking-wide">SCANNER</span>
        </button>

        <button 
          onClick={() => { triggerHaptics(30); setActiveTab('queue'); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all duration-200 relative ${
            activeTab === 'queue' ? 'text-bpm-neon scale-105' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span className="text-[9px] font-bold tracking-wide">FILE ATTENTE</span>
          {syncQueue.length > 0 && (
            <span className="absolute -top-1 right-2 bg-bpm-neon text-bpm-base font-extrabold text-[8px] w-4 h-4 rounded-full flex items-center justify-center scale-90 border border-bpm-base">
              {syncQueue.length}
            </span>
          )}
        </button>

        <button 
          onClick={() => { triggerHaptics(30); setActiveTab('inventory'); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all duration-200 ${
            activeTab === 'inventory' ? 'text-bpm-neon scale-105' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Database className="w-4 h-4" />
          <span className="text-[9px] font-bold tracking-wide">MATÉRIELS</span>
        </button>
      </nav>

    </div>
  );
}
export default App;
