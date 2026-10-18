// Faux émetteur OIDC pour les tests e2e — remplace authentik.
//
// Génère une paire RSA à chaque démarrage (aucune clé sur disque) et expose :
//   GET  /jwks/        clé publique, lue par le backend (OIDC_JWKS_URL)
//   POST /mint         {email, name?} → {id_token, expires_at}, utilisé par les
//                      fixtures pour fabriquer une session sans passer par le
//                      flux code+PKCE.
//
// Aucun code de test côté backend : il vérifie ces tokens exactement comme
// ceux d'authentik (signature RS256, iss, aud, exp).
//
// Usage : node oidc-server.mjs <port> <client_id>

import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

const [port, clientId] = process.argv.slice(2);
if (!port || !clientId) {
  console.error("usage : node oidc-server.mjs <port> <client_id>");
  process.exit(1);
}
const issuer = `http://127.0.0.1:${port}/`;
const kid = "e2e";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] };

const b64url = (data) => Buffer.from(data).toString("base64url");

function mint(email, name) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: email,
    email,
    name: name ?? email.split("@")[0],
    iat: now,
    // Large marge : un test ne doit jamais tomber sur un renouvellement.
    exp: now + 3600,
  };
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), privateKey).toString("base64url");
  return { id_token: `${input}.${signature}`, expires_at: claims.exp };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/jwks/") return json(res, 200, jwks);
  if (req.method === "POST" && req.url === "/mint") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        const { email, name } = JSON.parse(raw);
        if (!email) return json(res, 400, { detail: "email requis" });
        return json(res, 200, mint(email, name));
      } catch {
        return json(res, 400, { detail: "JSON invalide" });
      }
    });
    return;
  }
  json(res, 404, { detail: "inconnu" });
}).listen(Number(port), "127.0.0.1", () => {
  console.log(`[oidc-e2e] émetteur ${issuer}`);
});
