/** Profil de vue de l'accueil (localStorage, réactif), même pattern que labelCart.
 *  Le choix vit sur l'appareil ; en l'absence de choix explicite, on retombe sur
 *  un défaut déduit du rôle (cf. defaultModeForRole). */

import { useSyncExternalStore } from "react";
import type { DashboardMode, Role } from "./types";

const KEY = "bpm.dashboard_mode";
type Listener = (mode: DashboardMode | null) => void;

const listeners = new Set<Listener>();

function read(): DashboardMode | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "evenementiel" || raw === "maintenance" ? raw : null;
  } catch {
    return null;
  }
}

export const dashboardMode = {
  /** Choix explicite de l'utilisateur, ou null s'il n'a rien choisi. */
  get(): DashboardMode | null {
    return read();
  },
  set(mode: DashboardMode): void {
    localStorage.setItem(KEY, mode);
    for (const l of listeners) l(mode);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Défaut selon le rôle : Tech → maintenance, Staff/Admin → événementiel. */
export function defaultModeForRole(role: Role | undefined): DashboardMode {
  return role === "Tech" ? "maintenance" : "evenementiel";
}

function subscribe(onChange: () => void): () => void {
  return dashboardMode.subscribe(onChange);
}

/** Mode effectif : choix explicite, sinon défaut déduit du rôle. */
export function useDashboardMode(role: Role | undefined): DashboardMode {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  return stored ?? defaultModeForRole(role);
}
