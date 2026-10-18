import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Paramètres partagés entre playwright.config.ts (process principal) et les
// fixtures (workers) : tout doit être déterministe, chaque process les recalcule.

const racine = fileURLToPath(new URL("../../..", import.meta.url));
const empreinte = createHash("sha1").update(racine).digest("hex").slice(0, 8);

// Ports dérivés du chemin du checkout : deux worktrees lancent leurs e2e en
// parallèle sans se marcher dessus (et sans toucher aux 5173/8000 du dev).
const base = Number(
  process.env.E2E_PORT_BASE ?? 20_000 + (parseInt(empreinte.slice(0, 4), 16) % 2_000) * 4,
);

export const PORT_FRONT = base;
export const PORT_API = base + 1;
export const PORT_OIDC = base + 2;

export const FRONT_URL = `http://127.0.0.1:${PORT_FRONT}`;
export const API_URL = `http://127.0.0.1:${PORT_API}`;

// Faux émetteur OIDC (support/oidc-server.mjs) : remplace authentik. Le
// backend le vérifie exactement comme authentik, via OIDC_ISSUER/OIDC_JWKS_URL.
export const OIDC_URL = `http://127.0.0.1:${PORT_OIDC}`;
export const OIDC_ISSUER = `${OIDC_URL}/`;
export const OIDC_CLIENT_ID = "bpm-log-e2e";

// Base jetable, recréée à chaque lancement (support/start-api.sh).
export const DB_NAME = `bpm_log_e2e_${empreinte}`;

/** Membre seedé en Admin. Tout autre email est provisionné en Staff. */
// Domaine `.example` : email-validator (côté schémas Pydantic) refuse `.test`.
export const ADMIN_EMAIL = "admin@e2e.example";

export const REPO_ROOT = racine;
