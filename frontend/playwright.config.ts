import { defineConfig, devices } from "@playwright/test";
import {
  ADMIN_EMAIL,
  API_URL,
  DB_NAME,
  FRONT_URL,
  OIDC_CLIENT_ID,
  OIDC_ISSUER,
  OIDC_URL,
  PORT_API,
  PORT_FRONT,
  PORT_OIDC,
} from "./e2e/support/env";

// Tests e2e : vrai backend (base jetable) + build de prod servi par `vite
// preview`, pour avoir le service worker et le comportement hors ligne réels.
// L'auth authentik est remplacée par un faux émetteur OIDC (e2e/support).
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: FRONT_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // App terrain, utilisée sur téléphone.
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          // Le scanner QR demande la caméra : flux factice, sans popup.
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
  ],
  webServer: [
    {
      command: `node e2e/support/oidc-server.mjs ${PORT_OIDC} ${OIDC_CLIENT_ID}`,
      url: `${OIDC_URL}/jwks/`,
      reuseExistingServer: false,
    },
    {
      command: "bash e2e/support/start-api.sh",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_DB_NAME: DB_NAME,
        E2E_API_PORT: String(PORT_API),
        E2E_ADMIN_EMAIL: ADMIN_EMAIL,
        OIDC_ISSUER,
        OIDC_CLIENT_ID,
        OIDC_JWKS_URL: `${OIDC_URL}/jwks/`,
      },
    },
    {
      // Variables d'env du process prioritaires sur frontend/.env (authentik réel).
      command: `vite build --outDir dist-e2e --emptyOutDir && vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT_FRONT} --strictPort`,
      url: FRONT_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_OIDC_ISSUER: OIDC_ISSUER,
        VITE_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
        API_PROXY_TARGET: API_URL,
      },
    },
  ],
});
