import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { api } from "./api";
import type { TokenPair } from "./types";

interface WebauthnOptions {
  options: Record<string, unknown>;
  state: string;
}

export interface Passkey {
  id: number;
  device_name: string | null;
  created_at: string;
}

export const passkeySupported = browserSupportsWebAuthn;

/** Enregistre une nouvelle Passkey pour l'utilisateur authentifié. */
export async function registerPasskey(deviceName: string): Promise<Passkey> {
  const begin = await api<WebauthnOptions>("/auth/webauthn/register/begin", {
    method: "POST",
  });
  const credential = await startRegistration({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionsJSON: begin.options as any,
  });
  return api<Passkey>("/auth/webauthn/register/complete", {
    method: "POST",
    body: {
      state: begin.state,
      credential,
      device_name: deviceName.trim() || null,
    },
  });
}

/** Connexion sans mot de passe via Passkey. Renvoie une paire de tokens. */
export async function loginWithPasskey(email: string): Promise<TokenPair> {
  const begin = await api<WebauthnOptions>("/auth/webauthn/login/begin", {
    method: "POST",
    body: { email },
    auth: false,
  });
  const credential = await startAuthentication({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionsJSON: begin.options as any,
  });
  return api<TokenPair>("/auth/webauthn/login/complete", {
    method: "POST",
    body: { state: begin.state, credential },
    auth: false,
  });
}

export async function listPasskeys(): Promise<Passkey[]> {
  return api<Passkey[]>("/auth/webauthn/credentials");
}

export async function deletePasskey(id: number): Promise<void> {
  await api(`/auth/webauthn/credentials/${id}`, { method: "DELETE" });
}
