import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, API_URL, OIDC_CLIENT_ID, OIDC_ISSUER, OIDC_URL } from "./support/env";

interface Fixtures {
  /** Membre connecté ; `null` pour un visiteur non authentifié. Admin par défaut. */
  membre: string | null;
  /** id_token signé par le faux émetteur pour `membre`. */
  idToken: string | null;
  /** Client HTTP vers l'API, authentifié comme `membre` : préparer et vérifier les données. */
  api: APIRequestContext;
}

export const test = base.extend<Fixtures>({
  membre: [ADMIN_EMAIL, { option: true }],

  idToken: async ({ membre, request }, use) => {
    if (!membre) return use(null);
    const res = await request.post(`${OIDC_URL}/mint`, { data: { email: membre } });
    expect(res.ok()).toBeTruthy();
    const { id_token } = (await res.json()) as { id_token: string };
    await use(id_token);
  },

  context: async ({ context, membre, idToken }, use) => {
    if (membre && idToken) {
      // Session telle qu'oidc-client-ts la range après un login réel : l'app
      // démarre déjà connectée, sans redirection vers l'émetteur.
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
      const session = JSON.stringify({
        id_token: idToken,
        access_token: "e2e",
        token_type: "Bearer",
        scope: "openid email profile offline_access",
        profile: { sub: payload.sub, email: payload.email },
        expires_at: payload.exp,
      });
      await context.addInitScript(
        ([key, value]) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        },
        [`oidc.user:${OIDC_ISSUER}:${OIDC_CLIENT_ID}`, session] as const,
      );
    }
    await use(context);
  },

  api: async ({ playwright, idToken }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: `${API_URL}/api/`,
      extraHTTPHeaders: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };

export interface Equipement {
  id: number;
  nom: string;
  barcode_uid: string;
}

/**
 * Crée un équipement propre au test (nom suffixé, unique) : les tests ne
 * partagent aucune donnée et peuvent tourner en parallèle ou être répétés.
 */
export async function creerEquipement(
  api: APIRequestContext,
  nom: string,
  extra: Record<string, unknown> = {},
): Promise<Equipement> {
  const res = await api.post("equipments", {
    data: { nom: `${nom} ${randomUUID().slice(0, 8)}`, ...extra },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Equipement;
}
