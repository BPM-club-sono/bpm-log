import {
  ErrorResponse,
  ErrorTimeout,
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";

// Client OIDC public : aucun secret ici (tout le JS est lisible par le
// navigateur). oidc-client-ts active PKCE par défaut avec response_type "code".
export const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_ISSUER,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  // `offline_access` : sans lui, authentik n'émet aucun refresh_token et le
  // renouvellement retombe sur l'iframe `prompt=none`, fragile sur mobile et
  // impossible hors ligne. Le scope doit aussi être mappé sur le provider.
  scope: "openid email profile offline_access",
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // Renouvellement piloté par `renewToken` (voir plus bas) : le timer interne
  // de la lib ne passerait pas par la déduplication.
  automaticSilentRenew: false,
});

/**
 * Issue d'un renouvellement :
 * - `ok` : nouveau token en place ;
 * - `refused` : authentik refuse (refresh token révoqué/expiré, session SSO
 *   close) — la session est vraiment finie ;
 * - `network` : authentik injoignable — la session reste valable, on réessaiera.
 */
export type RenewResult = "ok" | "refused" | "network";

let pendingRenew: Promise<RenewResult> | null = null;

async function doRenew(): Promise<RenewResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "network";
  const hadRefreshToken = (await userManager.getUser())?.refresh_token != null;
  try {
    // Avec un refresh_token, oidc-client-ts fait un grant `refresh_token`
    // direct sur l'endpoint token ; sinon, iframe `prompt=none`.
    const user = await userManager.signinSilent();
    return user?.id_token != null ? "ok" : "refused";
  } catch (err) {
    if (err instanceof ErrorResponse) return "refused";
    // Un timeout d'iframe signifie en général qu'elle est bloquée : ça ne
    // passera jamais. Un timeout du grant refresh_token, lui, est réseau.
    if (err instanceof ErrorTimeout && !hadRefreshToken) return "refused";
    return "network";
  }
}

/**
 * Renouvelle l'id_token sans interaction. Les appels concurrents partagent le
 * même renouvellement : authentik fait tourner le refresh_token à chaque usage,
 * un second grant avec l'ancien échouerait en `invalid_grant`.
 */
export function renewToken(): Promise<RenewResult> {
  pendingRenew ??= doRenew().finally(() => {
    pendingRenew = null;
  });
  return pendingRenew;
}

// Renouvellement proactif ~60 s avant expiration. Un refus n'est pas traité
// ici : le prochain appel API tombera en 401 et `api()` tranchera.
userManager.events.addAccessTokenExpiring(() => {
  void renewToken();
});

/**
 * Token courant, renouvelé au besoin ; null si personne n'est connecté ou si le
 * renouvellement a échoué.
 */
export async function getIdToken(): Promise<string | null> {
  let user = await userManager.getUser();
  // Onglet en veille, téléphone verrouillé : le timer proactif n'a pas tourné.
  if (user?.expired && user.refresh_token && (await renewToken()) === "ok") {
    user = await userManager.getUser();
  }
  if (!user || user.expired) return null;
  // C'est l'id_token qui porte le claim `email` et vise notre client_id ;
  // l'access_token d'authentik cible l'API d'authentik, pas la nôtre.
  return user.id_token ?? null;
}

export type OidcUser = User;
