import { getIdToken, renewToken, userManager } from "./oidc";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await getIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    const renewed = await renewToken();
    if (renewed === "ok") {
      return api<T>(path, { ...opts, retry: false });
    }
    // Seul un refus d'authentik met fin à la session. Injoignable : on garde
    // l'utilisateur, l'appelant (sync notamment) réessaiera plus tard.
    if (renewed === "refused") await userManager.removeUser();
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail ?? detail;
    } catch {
      // corps non JSON
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
