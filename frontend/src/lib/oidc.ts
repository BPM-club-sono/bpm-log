import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

// Client OIDC public : aucun secret ici (tout le JS est lisible par le
// navigateur). oidc-client-ts active PKCE par défaut avec response_type "code".
export const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_ISSUER,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  scope: "openid email profile",
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true
});

/** Token courant, ou null si personne n'est connecté. */
export async function getIdToken(): Promise<string | null> {
  const user = await userManager.getUser();
  if (!user || user.expired) return null;
  // C'est l'id_token qui porte le claim `email` et vise notre client_id ;
  // l'access_token d'authentik cible l'API d'authentik, pas la nôtre.
  return user.id_token ?? null;
}

export type OidcUser = User;
