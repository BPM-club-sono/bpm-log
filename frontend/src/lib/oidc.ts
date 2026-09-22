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

/**
 * Révoque le refresh_token auprès d'authentik. Sans ça, il resterait valable
 * jusqu'à expiration (30 jours) même après déconnexion : un token volé
 * auparavant continuerait de fonctionner.
 *
 * Best effort : hors ligne ou authentik injoignable, la déconnexion locale doit
 * quand même avoir lieu. On n'utilise pas `revokeTokensOnSignout` de la lib :
 * un échec de révocation y fait échouer toute la déconnexion, et elle émet un
 * `userLoaded` qui relancerait le chargement du profil en pleine déconnexion.
 */
export async function revokeRefreshToken(): Promise<void> {
  const token = (await userManager.getUser())?.refresh_token;
  if (!token) return;
  try {
    const endpoint = await userManager.metadataService.getRevocationEndpoint();
    if (!endpoint) return;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: "refresh_token",
        // Client public : il s'identifie par son seul client_id (RFC 7009 §2.1).
        client_id: userManager.settings.client_id,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Réseau indisponible : le token expirera de lui-même.
  }
}

/** Déconnexion complète : révocation, puis fin de session SSO authentik. */
export async function signOut(): Promise<void> {
  await revokeRefreshToken();
  // Ferme aussi la session authentik : sinon le cookie SSO encore valide
  // reconnecterait immédiatement sans rien demander.
  await userManager.signoutRedirect();
}

export type OidcUser = User;
