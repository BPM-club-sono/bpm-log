# 🎧 BPM-Log — Gestion de Parc Matériel & Logistique

Bienvenue dans le dépôt de **BPM-Log**, l'application de logistique et de suivi de matériel offline-first pour l'association de musique et d'événementiel **BPM**.

Ce dépôt est configuré en monorepo pour accueillir le frontend (PWA React) et le backend (API Express + PostgreSQL).

---

## 🚀 Proof of Concept (POC) — Test Instantané

Pour valider le concept technique hors-ligne (Offline-First), IndexedDB et l'expérience mobile sur le terrain en un temps record, nous avons développé un **POC entièrement fonctionnel** logé dans un fichier HTML/React autonome.

### Ce que contient ce POC :
1. **Moteur Offline (IndexedDB via Dexie.js)** : Enregistrement local instantané de tous les scans.
2. **Gestionnaire de Vrac (Check-list)** : Scan d'un code de caisse (`BPM-BOX-XLR`) qui ouvre une check-list interactive permettant d'ajuster les quantités réelles avec des boutons tactiles optimisés.
3. **Simulateur Réseau (Online/Offline)** : Un bouton poussoir dans la barre de titre permet de simuler la coupure ou le rétablissement d'Internet pour observer la file de synchronisation en action.
4. **Scanner QR Code Réel** : Intégration de la caméra arrière du smartphone (ou webcam) avec filtre de décodage.
5. **Simulateur de Scan Intégré** : Pour tester l'application directement sur ordinateur ou sans étiquettes imprimées.
6. **Design Haute Fidélité** : Interface premium en mode sombre (dégradés néon, vibrations haptiques simulées, transitions animées).

---

## 🛠️ Comment lancer le POC ?

### Option 1 : Ouverture Directe (Zéro Configuration)
Double-cliquez simplement sur le fichier `index.html` à la racine de ce dépôt, ou ouvrez-le depuis votre navigateur :
`file:///home/jonathan/git/bpm-log/index.html`

### Option 2 : Serveur Local Rapide
Si vous souhaitez le tester sur votre smartphone connecté au même réseau Wi-Fi pour tester l'appareil photo :
1. Lancez un mini-serveur statique depuis la racine du dépôt :
   ```bash
   npx serve .
   # ou
   python3 -m http.server 8000
   ```
2. Ouvrez l'adresse affichée sur votre téléphone !

---

## 🏗️ Architecture & Jalons Techniques

Le plan d'action technique complet a été rédigé et est disponible dans l'artifact suivant :
👉 [implementation_plan.md](file:///home/jonathan/.gemini/antigravity/brain/e7c2b34f-e3bd-41eb-826e-0d9d24472be5/implementation_plan.md)