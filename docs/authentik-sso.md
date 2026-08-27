# authentik SSO — configuration de référence

État de la configuration en place. Sert à reprendre le sujet ou à brancher une
nouvelle application. Ce n'est pas un tutoriel d'installation : authentik est déjà
installé et fonctionne.

Dernière vérification : 2026-08-27.

## Architecture

```
navigateur ──HTTPS──> nginx (hôte VM, 80/443)
                        ├── bpmclubsono.com      → 127.0.0.1:8080  (site vitrine)
                        └── auth.bpmclubsono.com → 127.0.0.1:9000  (authentik)

bpm-log (SPA) ──OIDC code+PKCE──> authentik ──OAuth──> Google
      │                              │
      └── id_token (RS256) ──> FastAPI, vérifié via JWKS (sans appeler authentik)
```

Deux échanges OAuth distincts : **Google → authentik** (authentik est client, Google
est l'IdP) et **authentik → bpm-log** (bpm-log est client, authentik est l'IdP).
bpm-log ne parle jamais à Google.

## VM

`ssh jojo@bpm.h.minet.net` — `157.159.195.18`, hostname `bpm-vitrine`.
`jojo` est dans `sudo` (mot de passe demandé), **pas** dans le groupe `docker` :
toute commande docker prend `sudo`.

| | |
|---|---|
| Reverse proxy | nginx 1.27.5 **sur l'hôte** (pas Caddy, pas de conteneur) |
| DNS | Cloudflare, wildcard `*.bpmclubsono.com` → IP VM, **mode DNS-only** |
| Certificats | certbot **par sous-domaine**, `/etc/letsencrypt/live/<domaine>/` |
| RAM | 8,9 Go, ≈2 Go utilisés |

### Fichiers nginx

| Fichier | Rôle |
|---|---|
| `sites-available/bpm-web.conf` | `bpmclubsono.com` + `www` → `127.0.0.1:8080` |
| `sites-available/authentik.conf` | `auth.bpmclubsono.com` → `127.0.0.1:9000` |
| `sites-available/000-default-deny.conf` | catch-all `default_server`, `return 444` — le wildcard DNS envoie tout sous-domaine inventé sur la VM |
| `conf.d/upgrade.conf` | `map $http_upgrade $connection_upgrade` — WebSocket, déclaré **une seule fois** pour tout le serveur |

`nginx.conf` inclut `conf.d/*.conf` puis `sites-enabled/*` (sans filtre `.conf`).

`authentik.conf` doit garder `proxy_set_header X-Forwarded-Proto $scheme` (sinon
authentik fabrique des `redirect_uri` en `http://` que Google refuse) et les en-têtes
`Upgrade`/`Connection` (interface d'admin en WebSocket).

### Ports

| Port | Service |
|---|---|
| `127.0.0.1:8080` | site vitrine (`/opt/site-bpm`) |
| `127.0.0.1:9000` | authentik |
| `127.0.0.1:3306` | MySQL (sans rapport) |

**Toujours publier sur `127.0.0.1`**, jamais `0.0.0.0` : nginx est le seul point
d'entrée et le seul à terminer le TLS. À l'intérieur de la VM tout circule en HTTP
sur la loopback — terminaison TLS standard.

## authentik

Installé dans `/opt/authentik` (compose officiel + `.env`). Port fixé par
`COMPOSE_PORT_HTTP=127.0.0.1:9000` dans `.env`, pas en éditant le compose : une mise
à jour ne l'écrasera pas.

```bash
cd /opt/authentik && sudo docker compose ps
```

Toute la configuration ci-dessous vit dans **la base PostgreSQL d'authentik**, pas
dans des fichiers : seule la sauvegarde la protège, pas git.

### Source Google

`Directory → Federation & Social login → Google`

| Champ | Valeur |
|---|---|
| Slug | `google` — doit correspondre à l'URL de callback |
| Consumer key / secret | client OAuth Google `bpm-auth` (console Google Cloud) |
| **User matching mode** | **`Link to a user with identical email address`** |
| **Enrollment flow** | **vide** |

URI de redirection déclarée côté Google :
`https://auth.bpmclubsono.com/source/oauth/callback/google/` (slash final obligatoire).

Le club n'a **pas** de Google Workspace : les membres arrivent avec des Gmail
personnels, écran de consentement en *External*. Google ne filtre donc rien —
**tout le contrôle d'accès est dans authentik** :

- *Enrollment flow* vide → un compte Google inconnu ne peut pas s'inscrire, seulement
  se **rattacher** à un utilisateur créé à la main.
- *Matching mode* `email_link` → rattachement sur l'email. Sûr **parce que la source
  est Google**, qui vérifie ses propres adresses. À ne jamais activer sur une source
  dont les emails ne sont pas vérifiés.

### Provider OAuth2 `bpm-log`

| Champ | Valeur |
|---|---|
| Client type | **Public** (SPA : aucun secret possible → PKCE) |
| Client ID | `k9fTwpGGVAgN92wiNHOwH3QQp63eNOICUWIzUGMl` — pas un secret, il circule dans l'URL |
| Authorization flow | `default-provider-authorization-implicit-consent` |
| Redirect URIs | `https://log.bpmclubsono.com/auth/callback` et `http://localhost:5173/auth/callback` — **littérales, mode Strict** |
| Signing key | certificat auto-signé authentik (RS256) |
| Scopes | `openid`, `email`, `profile` |
| Subject mode | `Based on the User's Email` |

Application : slug **`bpm-log`**, groupe d'accès **`bpm-log-users`** lié via
*Policy / Group / User Bindings → Bind existing Group/User*.

> Une application **sans aucune liaison est ouverte à tous** les comptes authentik.
> Avec le provisioning automatique (plus bas), cela créerait des membres Staff tout
> seuls : la liaison de groupe est la vraie frontière d'accès.

### Endpoints

```
issuer    https://auth.bpmclubsono.com/application/o/bpm-log/
jwks      https://auth.bpmclubsono.com/application/o/bpm-log/jwks/
discovery https://auth.bpmclubsono.com/application/o/bpm-log/.well-known/openid-configuration
```

## Intégration bpm-log

### Backend

`app/security/oidc.py` télécharge le JWKS (cache 1 h, un rafraîchissement forcé en
cas d'échec de signature pour survivre à une rotation de clé) et vérifie **quatre**
choses d'un coup : signature, `iss`, `aud`, `exp`.

`aud` n'est pas optionnel : toutes les apps d'un même authentik sont signées par la
même clé avec le même `iss`. Seul `aud` distingue « émis pour bpm-log » de « émis
pour une autre app ».

`app/deps.py` → `get_current_user` :

1. valide l'`id_token` ;
2. cherche le membre par le claim `email` ;
3. **s'il n'existe pas, le crée** — rôle `Staff`, nom depuis `given_name` /
   `family_name` ;
4. refuse si `UserAuth.is_active` est faux — permet de couper l'accès sans attendre
   l'expiration du token.

L'insertion est protégée contre `IntegrityError` : la SPA émet plusieurs requêtes en
parallèle au chargement, deux peuvent créer le même membre simultanément.

L'API **n'émet plus aucun token**. `POST /auth/login`, `POST /auth/refresh` et le
router WebAuthn ont été supprimés : ils fabriquaient des tokens que l'API rejette
désormais, et contournaient les flows et policies d'authentik. Seul `GET /auth/me`
subsiste sous `/api/auth`. `passwords.py` et les colonnes SQL correspondantes restent
en place, `seed.py` les utilise encore.

### Frontend

`oidc-client-ts`, authorization code + PKCE (`src/lib/oidc.ts`). La SPA envoie
l'**`id_token`** en `Authorization: Bearer` — c'est lui qui porte `email` et vise
notre `client_id` ; l'`access_token` d'authentik vise l'API d'authentik.
`/auth/callback` termine l'échange ; `api.ts` tente un renouvellement silencieux
sur 401.

### Variables d'environnement

`.env` à la racine — une seule valeur de `client_id`, recopiée du provider :

```dotenv
OIDC_ISSUER=https://auth.bpmclubsono.com/application/o/bpm-log/
OIDC_CLIENT_ID=<client id du provider>
OIDC_JWKS_URL=https://auth.bpmclubsono.com/application/o/bpm-log/jwks/
VITE_OIDC_ISSUER=https://auth.bpmclubsono.com/application/o/bpm-log/
VITE_OIDC_CLIENT_ID=<même valeur>
```

Les `VITE_*` sont **inlinées dans le bundle au build**, pas lues au runtime : les
deux `docker-compose*.yml` les passent en `args` au Dockerfile du frontend. Les
changer impose `docker compose up -d --build frontend`, pas un restart.

Désynchronisation : mauvaise valeur côté **front** → `invalid_client` immédiat ;
côté **back** → le login réussit puis **401 sur tous les appels API**, la vérif `aud`
échouant sans rien dire.

En dev, Vite lit `frontend/.env` (pas le `.env` racine) et doit tourner sur le port
**5173**, seul port localhost déclaré dans les redirect URIs.

## Ajouter un membre

1. authentik → `Directory → Users → Create`, **email = son adresse Google exacte**.
   Pas de mot de passe.
2. L'ajouter au groupe `bpm-log-users`.
3. Il se connecte avec Google : authentik rattache par email, et le membre bpm-log
   est créé automatiquement en `Staff` à son premier appel API.

Les étapes 1 et 2 se font **avant** sa première connexion.

Promotion : `UPDATE membres SET role='Admin' WHERE email='…';`
Rôles : `Admin`, `Staff`, `Tech`.

Une faute de frappe sur l'email donne le compte — groupe et rôle Staff compris — au
propriétaire de l'adresse saisie. N'entrer que des adresses confirmées.

## Ajouter une application

1. DNS : rien à faire, le wildcard couvre le sous-domaine.
2. nginx : copier `authentik.conf`, changer `server_name` et le port loopback.
   **Créer le bloc et recharger avant** `sudo certbot --nginx -d <app>.bpmclubsono.com`,
   sinon le challenge ACME tombe dans le catch-all et échoue (Let's Encrypt compte les
   échecs).
3. authentik : **un provider par app**, jamais réutiliser un `client_id` — c'est `aud`
   qui isole les apps entre elles.
4. Créer le groupe `<app>-users` et le lier à l'application.

Type de provider : SPA → *Public* + PKCE ; app avec backend → *Confidential* ; outil
non modifiable (Adminer, Grafana…) → **Proxy Provider** + `auth_request` nginx, sans
une ligne de code.

## Sauvegardes

authentik est un point de défaillance unique : s'il tombe, personne ne se connecte
nulle part.

```bash
cd /opt/authentik && sudo docker compose exec postgresql \
  pg_dump -U authentik authentik | gzip > authentik-$(date +%F).sql.gz
```

Sauvegarder aussi `/opt/authentik/.env` : sans `AUTHENTIK_SECRET_KEY` le dump est
inexploitable. Garder le mot de passe `akadmin` hors ligne — seul accès si Google
devient indisponible.

## Pièges rencontrés

| Symptôme | Cause |
|---|---|
| discovery en `500` **seulement depuis un navigateur** | une **redirect URI en regex**. CORS impose une origine littérale ; authentik la dérive en parsant chaque URI, et `[` y est réservé aux adresses IPv6 → `ValueError: Invalid IPv6 URL`. N'utiliser que des URIs littérales. Test : `curl -H "Origin: http://localhost:5173" <discovery>` doit renvoyer 200 — **sans** `Origin` il renvoie 200 même quand c'est cassé |
| `Request to authenticate with google has been denied` | *User matching mode* sur une variante `deny`, qui refuse de rattacher Google à un compte existant. Mettre `Link to a user with identical email address` |
| Rien dans les logs authentik | logs en **JSON structuré**, `grep -i traceback` ne trouve rien. Utiliser l'en-tête `x-authentik-id` de la réponse 500 comme clé de recherche |
| `[emerg] cannot load certificate` | bloc `ssl_certificate` écrit avant d'avoir lancé certbot → impasse. Repasser le fichier en HTTP seul, recharger, puis certbot (qui écrit lui-même le bloc 443) |
| `ssl_session_timeout is duplicate` | `include options-ssl-nginx.conf` présent deux fois : certbot l'a déjà ajouté |
| 401 sur tous les appels API après un login réussi | `OIDC_CLIENT_ID` du backend ≠ `client_id` du provider |

## Reste à faire

- **Grant types** : `implicit` est bloqué, mais `password`, `client_credentials` et
  `device_code` répondent encore `invalid_grant` (et non `unsupported_grant_type`) →
  toujours actifs. Ne garder que `authorization_code` et `refresh_token`. `password`
  est le plus important : il court-circuite les flows d'authentik, donc la règle
  « Google uniquement », et le client étant public rien ne le protège.
  ```bash
  curl -s -X POST https://auth.bpmclubsono.com/application/o/token/ \
    -d "grant_type=password&client_id=<id>&username=x&password=y" | jq -r .error
  # attendu : unsupported_grant_type
  ```
- **bpm-log n'est pas déployé sur la VM** : pas de conteneur, pas de bloc nginx
  `log.bpmclubsono.com`. La bascule n'a été testée qu'en local.
- Vérifier `email_verified` dans le backend (`is False` → rejet ; l'absence du claim
  doit rester tolérée pour ne pas verrouiller tout le monde).
