import { api } from "./api";

/** Indique si le navigateur supporte les notifications push (PWA). */
export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

/** True si un abonnement push est déjà actif sur cet appareil. */
export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}

/** Demande la permission, crée l'abonnement et l'enregistre côté serveur. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("permission-denied");
  }

  const { public_key } = await api<{ public_key: string }>(
    "/notifications/vapid-public-key",
  );
  if (!public_key) throw new Error("vapid-missing");

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
  }

  await api("/notifications/subscribe", { method: "POST", body: sub.toJSON() });
}

/** Désinscrit l'appareil côté serveur puis localement. */
export async function disablePush(): Promise<void> {
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api("/notifications/subscribe", { method: "DELETE", body: sub.toJSON() });
  } finally {
    await sub.unsubscribe();
  }
}
