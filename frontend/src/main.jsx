import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Enregistrement automatique du Service Worker pour le support Offline-First
if ('serviceWorker' in navigator) {
  registerSW({ 
    immediate: true,
    onNeedRefresh() {
      // Notification de mise à jour si désiré (ici géré en auto-update par défaut)
      console.log('Nouvelle version disponible !');
    },
    onOfflineReady() {
      console.log('Application prête à fonctionner hors-ligne !');
    }
  });
}
