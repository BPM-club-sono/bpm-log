# Authentik SSO + Google — guide d'installation pour bpm-log

But : remplacer l'authentification maison (mot de passe + JWT + WebAuthn) de bpm-log
par une connexion Google fédérée via authentik, hébergé sur la même VM.

Contexte de déploiement : VM unique, **nginx sur l'hôte** comme reverse proxy
(`/etc/nginx/sites-available/`), DNS **wildcard** `*.bpmclubsono.com` → IP de la VM.
Le club n'a **pas** de Google Workspace : les membres se connectent avec des Gmail
personnels, donc tout le contrôle d'accès vit dans authentik (§6).

authentik est monté comme SSO **multi-apps** dès le départ — bpm-log est la première,
pas la seule (§13).

---

## 0. Concepts en 2 minutes

| Terme | Ce que c'est ici |
|---|---|
| **IdP** (Identity Provider) | Le service qui dit « cet utilisateur est bien X ». Ici : authentik. |
| **Source** | Un IdP *en amont* d'authentik. Ici : Google. authentik délègue la vérification à Google. |
| **Provider** | Ce qu'authentik expose *en aval* à une app. Ici : un provider OAuth2/OIDC pour bpm-log. |
| **OIDC** | OAuth2 + une couche identité. Le résultat est un `id_token` = un JWT signé par authentik. |
| **JWKS** | URL publique où authentik publie ses clés publiques. Le backend s'en sert pour vérifier la signature des JWT sans jamais appeler authentik à chaque requête. |
| **PKCE** | Extension OAuth2 obligatoire pour les clients « publics » (SPA), qui ne peuvent pas garder un secret. Le navigateur génère un secret éphémère par login. |

Chaîne complète après migration :

```
navigateur → bpm-log SPA → authentik → Google
                    ↑          |
                    └──── id_token (JWT RS256) ────┘
                                 ↓
                        FastAPI vérifie via JWKS
```

Point clé : **le backend ne signe plus rien**. Il ne fait que *vérifier* des tokens
signés par authentik. `app/security/jwt.py` (HS256, secret partagé) devient
inutile pour l'access token.

---

## 0bis. Le flux complet, étape par étape

Il y a **deux échanges OAuth distincts**, souvent confondus :

- **Google → authentik** : authentik est le *client*, Google est l'IdP.
  Se produit une fois par session authentik.
- **authentik → bpm-log** : bpm-log est le *client*, authentik est l'IdP.
  Se produit une fois par app, par session.

bpm-log ne parle **jamais** à Google. Il ne connaît qu'authentik.

### Premier login (session vide)

```
navigateur          bpm-log (SPA)        authentik           Google
    │                    │                   │                  │
 1  │ clic "Connexion"   │                   │                  │
    │───────────────────>│                   │                  │
    │                    │ génère code_verifier (aléatoire)     │
    │                    │ code_challenge = SHA256(verifier)    │
 2  │<── 302 ────────────│                   │                  │
    │  /authorize?client_id=bpm-log&code_challenge=…&redirect_uri=…
    │───────────────────────────────────────>│                  │
    │                                        │ pas de cookie    │
    │                                        │ de session       │
 3  │<─── page de login authentik ───────────│                  │
    │  clic "Google"                         │                  │
    │───────────────────────────────────────>│                  │
 4  │<─── 302 vers accounts.google.com ──────│                  │
    │──────────────────────────────────────────────────────────>│
 5  │  choix du compte + consentement                           │
    │<──────────────────────────────────────────────────────────│
 6  │  302 /source/oauth/callback/google/?code=G                 │
    │───────────────────────────────────────>│                  │
    │                                        │ POST /token ────>│
    │                                        │<─ profil (email) │
 7  │                                        │ policies §6      │
    │                                        │ rattache le User │
    │                                        │ ★ POSE LE COOKIE │
    │                                        │   DE SESSION     │
 8  │<─── 302 /auth/callback?code=A ─────────│                  │
    │───────────────────>│                   │                  │
 9  │                    │ POST /token       │                  │
    │                    │  code=A + code_verifier              │
    │                    │──────────────────>│                  │
    │                    │  vérifie SHA256(verifier)==challenge │
10  │                    │<── id_token (JWT) ─│                  │
    │                    │    + refresh_token │                  │
```

Puis, pour **chaque appel API** :

```
11  SPA ── GET /api/… + "Authorization: Bearer <id_token>" ──> FastAPI
12  FastAPI: vérifie signature avec la clé publique (JWKS, en cache 1 h)
           vérifie exp / iss / aud
           lit le claim "email" → SELECT … FROM membre WHERE email = …
13  FastAPI ── 200 ──> SPA
```

**Étape 12 = le point important.** FastAPI n'appelle *pas* authentik. Il a
téléchargé la clé publique une fois et vérifie la signature localement. Si
authentik est éteint, les sessions en cours continuent de fonctionner jusqu'à
expiration des tokens ; seuls les *nouveaux* logins échouent.

### Deuxième app, même navigateur (le vrai SSO)

```
    │ clic "Connexion" sur app-2                │
    │──────────> app-2 ──302──> /authorize?client_id=app-2 ──>│
    │                                        ★ COOKIE PRÉSENT │
    │<─────────── 302 /auth/callback?code=B ──────────────────│
```

Étapes 3 à 7 **entièrement sautées**. Pas de page de login, pas de Google, pas de
clic. L'utilisateur voit une redirection instantanée. C'est ça, le SSO : le cookie
de session posé à l'étape 7 vaut pour toutes les apps.

### Ce que contient l'`id_token`

Un JWT = 3 parties base64 séparées par des points. Rien n'est chiffré — tout est
lisible, la signature garantit seulement que **rien n'a été modifié**.

```json
{
  "iss": "https://auth.bpmclubsono.com/application/o/bpm-log/",
  "aud": "SbXk9…client_id de bpm-log",
  "sub": "membre@gmail.com",
  "exp": 1770000000,
  "iat": 1769996400,
  "email": "membre@gmail.com",
  "email_verified": true,
  "name": "Prénom Nom",
  "groups": ["bpm-log-users", "bpm-log-admins"]
}
```

Les 4 champs que le backend doit vérifier, dans l'ordre :

| Champ | Vérification | Sans elle |
|---|---|---|
| signature | clé publique JWKS | n'importe qui forge un token |
| `iss` | == ton authentik | un autre authentik est accepté |
| `aud` | == ton `client_id` | **le token d'une autre app est accepté** |
| `exp` | non expiré | un token volé vaut à vie |

`jwt.decode(...)` de `python-jose` fait les quatre d'un coup si on lui passe
`audience=` et `issuer=` (§8.2). Ne jamais les omettre.

> ⚠️ Ne jamais faire confiance à un JWT en le décodant sans vérifier la signature
> (`jwt.get_unverified_claims`). Le payload est modifiable par n'importe qui —
> c'est la signature, et elle seule, qui le rend digne de confiance.

### Durées de vie

| Élément | Durée par défaut | Effet |
|---|---|---|
| Session authentik (cookie) | plusieurs jours | ne reclique pas sur Google |
| `id_token` / `access_token` | 5 min (`minutes=5`) | à renouveler souvent |
| `refresh_token` | 30 jours | renouvelle sans interaction |

`oidc-client-ts` avec `automaticSilentRenew: true` gère le renouvellement dans un
iframe caché — invisible pour l'utilisateur. Réglable dans le provider
(**Advanced protocol settings → Token validity**).

**Révocation** : un `id_token` reste valide jusqu'à `exp`, même après désactivation
du compte. Fenêtre d'exposition = la durée du token (5 min). Pour couper
immédiatement : `UserAuth.is_active = false` en base, contrôlé par FastAPI à chaque
requête (§8.3).

---

## 1. Décision d'architecture — comment le backend consomme authentik

Deux options. À trancher avant de coder.

### Option A — Proxy Provider / `auth_request`

nginx interroge authentik avant chaque requête (directive `auth_request`). authentik injecte des en-têtes
(`X-authentik-email`, `X-authentik-groups`) et FastAPI leur fait confiance.

- ✅ Zéro code OAuth dans le front et le back. Le plus court.
- ✅ Protège aussi Adminer et tout autre outil non-OIDC gratuitement.
- ❌ Le backend fait confiance à des en-têtes HTTP → si un jour l'API est joignable
  autrement que par nginx, n'importe qui peut forger `X-authentik-email`. Fragile.
- ❌ Mal adapté à une SPA + PWA : la session est un cookie, les redirections 302
  cassent les appels `fetch`, et les notifications push / le mode hors-ligne
  deviennent pénibles.

### Option B — OIDC Authorization Code + PKCE (recommandé)

Le front fait le flow OIDC, récupère un `id_token`, l'envoie en `Authorization: Bearer`.
Le backend le vérifie via JWKS.

- ✅ Modèle standard pour une SPA. Le token est auto-porteur et vérifiable.
- ✅ Aucune confiance accordée au reverse-proxy.
- ✅ `Authorization: Bearer` déjà en place dans `frontend/src/lib/api.ts` → le
  transport ne change pas, seule la *provenance* du token change.
- ❌ Plus de code : flow PKCE côté front, vérif JWKS côté back.

**Recommandation : Option B** pour l'app, **plus** un Proxy Provider (Option A)
uniquement devant Adminer. Le reste du guide suit ce choix.

---

## 2. État réel de la VM (constaté le 2026-08-25)

`ssh jojo@bpm.h.minet.net` — `157.159.195.18`, alias `exotic-sage.h.minet.net`.

| Élément | État constaté |
|---|---|
| RAM | 8,9 Go total, **7,1 Go libres** → large pour authentik (~1,5 Go) |
| nginx | `1.27.5` sur l'hôte, ports 80/443 |
| Conf active | `sites-enabled/bpm-web.conf` → `bpmclubsono.com` + `www` → `127.0.0.1:8080` |
| Docker | `/opt/site-bpm/docker-compose.yml` — **le site vitrine uniquement** |
| Port 8080 | pris par `site-bpm` |
| Port 3306 | MySQL, sur `127.0.0.1` |
| Port 9000 | **libre** → pour authentik |
| Certificats | `certbot` par domaine : `/etc/letsencrypt/live/bpmclubsono.com/`. **Pas de wildcard.** |
| DNS | Cloudflare (`adi/kareem.ns.cloudflare.com`), wildcard `*` → IP de la VM, **mode DNS-only** (pas de proxy orange) |
| `jojo` | membre du groupe `sudo` (mot de passe demandé), **pas** dans le groupe `docker` |

Wildcard vérifié :

```bash
dig +short auth.bpmclubsono.com        # → 157.159.195.18
dig +short randomxyz123.bpmclubsono.com # → 157.159.195.18 (le wildcard attrape tout)
```

Cloudflare étant en **DNS-only**, les requêtes arrivent directement sur nginx :
le challenge HTTP-01 de Let's Encrypt fonctionne, et le cert « Cloudflare Origin »
présent dans `bpm-web2.conf` est un vestige inutilisé.

### ⚠️ Trois choses à corriger *avant* d'ajouter authentik

Constatées en lisant la VM. Aucune n'est bloquante, les trois sont des dettes qui
vont empirer avec chaque app ajoutée.

**1. `site-bpm` est publié sur `0.0.0.0:8080`, pas sur la loopback.**

```
LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:*
```

Le site est donc servi **en clair, sans TLS, sans passer par nginx**, sur
`http://157.159.195.18:8080`. Le HTTPS de `bpmclubsono.com` est contournable par
quiconque connaît l'IP. Correctif dans `/opt/site-bpm/docker-compose.yml` :

```yaml
    ports:
      - "127.0.0.1:8080:80"   # au lieu de "8080:80"
```

Puis `docker compose up -d`. C'est exactement la règle du §3.1, et c'est pour ça
qu'elle y figure.

> Le service `dev` du même compose publie aussi `5173` (serveur Vite, `--host 0.0.0.0`).
> Il n'est pas lancé actuellement — ne jamais le démarrer sur la VM.

**2. `bpm-web.conf.save` traîne dans `sites-enabled/`.**

`nginx.conf` fait `include /etc/nginx/sites-enabled/*;` — **sans filtre `.conf`**.
Le `.save` est donc chargé, avec les mêmes `server_name` que la conf réelle. nginx
garde la première définition et émet un avertissement « conflicting server name ».
Ça marche aujourd'hui par chance sur l'ordre alphabétique.

```bash
sudo mv /etc/nginx/sites-enabled/bpm-web.conf.save /root/         # hors du include
sudo nginx -t && sudo systemctl reload nginx
```

**3. Pas de `default_server`.**

Le wildcard DNS fait que *tout* sous-domaine inventé atteint la VM. Sans bloc par
défaut, nginx sert le premier `server` block chargé. Créer
`/etc/nginx/sites-available/000-default-deny.conf` :

```nginx
# Attrape tout Host inconnu (conséquence du wildcard DNS) et ferme la connexion.
server {
    listen      80  default_server;
    listen [::]:80  default_server;
    listen      443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name _;

    # Refuse le handshake TLS sans présenter de certificat (nginx >= 1.19.4 ;
    # la VM est en 1.27.5).
    ssl_reject_handshake on;

    return 444;   # ferme la connexion sans rien renvoyer
}
```

```bash
sudo ln -s /etc/nginx/sites-available/000-default-deny.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`server_name _;` est un nom volontairement invalide : il ne peut matcher aucun
`Host:` réel. C'est `default_server` qui fait le travail, pas ce nom. Le préfixe
`000-` est décoratif — dès qu'un bloc porte `default_server`, la promotion
automatique du premier bloc chargé disparaît et l'ordre alphabétique ne décide plus
rien pour le catch-all. Il ne pilote plus que les `server_name` **dupliqués** (le
point 2 ci-dessus) → sortir `bpm-web.conf.save` de `sites-enabled/` **d'abord**.

> ⚠️ **Un seul `default_server` par port.** Deux blocs sur le même port et nginx
> refuse de démarrer : `nginx: [emerg] a duplicate default server for 0.0.0.0:443`.
> C'est une `[emerg]`, pas un `[warn]` : le reload est refusé, et un `restart` te
> laisse **sans nginx du tout**. Vérifier avant :
> ```bash
> grep -rn default_server /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /etc/nginx/nginx.conf
> ```
> `/etc/nginx/sites-available/default` (fichier Debian d'origine, présent sur la VM)
> contient `listen 80 default_server;`. Il n'est pas symlinké aujourd'hui, donc pas
> de conflit — mais l'activer un jour casserait nginx net.

> ⚠️ **Effet de bord sur certbot** : ce bloc avale aussi les challenges ACME des
> sous-domaines pas encore configurés. Pour chaque nouvelle app, l'ordre compte :
> 1. créer d'abord le `server { listen 80; server_name <app>.bpmclubsono.com; … }`
> 2. `sudo nginx -t && sudo systemctl reload nginx`
> 3. **ensuite seulement** `sudo certbot --nginx -d <app>.bpmclubsono.com`
>
> Certbot lancé avant l'étape 1 : le `Host:` ne matche aucun bloc, tombe dans le
> default, reçoit `444` → challenge en échec, et Let's Encrypt compte les échecs
> (rate-limit).

Vérifier :

```bash
curl -I -H "Host: nimportequoi.bpmclubsono.com" http://127.0.0.1  # → curl: (52) Empty reply
curl -I https://nimportequoi.bpmclubsono.com                      # → erreur SSL
curl -I https://bpmclubsono.com                                   # → HTTP/2 200 (inchangé)
```

Les deux premières doivent échouer, la troisième doit continuer à répondre.

### bpm-log n'est pas encore déployé

Aucun conteneur bpm-log ne tourne, aucun bloc nginx `log.bpmclubsono.com`
n'existe, aucun port 8000 n'écoute. Le §10 (bascule) suppose une prod existante :
il faut donc **d'abord déployer bpm-log en HTTPS avec son auth actuelle**, vérifier
que ça tourne, *puis* faire la migration authentik. Faire les deux d'un coup rend
tout échec indébogable.

Ports proposés pour la suite :

| Service | Port loopback |
|---|---|
| site-bpm (existant) | `127.0.0.1:8080` |
| bpm-log frontend | `127.0.0.1:8082` |
| bpm-log api | `127.0.0.1:8000` |
| **authentik** | **`127.0.0.1:9000`** |

> Note : `docker-compose.prod.yml` du dépôt contient un service `caddy`. La VM
> n'utilise pas Caddy. Le supprimer du fichier avant le premier déploiement, sinon
> il se battra avec nginx pour les ports 80/443.

---

## 3. Installer authentik à côté de bpm-log

### 3.0 Quel fichier ? — trois compose distincts, à ne pas confondre

authentik est une **stack indépendante**, avec son propre dossier et son propre
`docker-compose.yml`. Il ne s'ajoute ni au compose de site-bpm, ni à celui de bpm-log.

| Fichier | À qui | Rôle dans ce guide |
|---|---|---|
| `/opt/site-bpm/docker-compose.yml` | site vitrine | déjà corrigé au §2 (port loopback). **Ne plus y toucher.** |
| `/opt/authentik/docker-compose.yml` | **authentik** | **à créer au §3.2** — téléchargé, puis édité |
| `<dépôt bpm-log>/docker-compose.prod.yml` | bpm-log | pas encore déployé. **Inchangé au §3**, servira au §10 |

Une app = un dossier = un compose. Chaque stack a ses conteneurs, son réseau Docker
privé et sa base. Elles ne communiquent pas entre elles : **le seul point de contact
est nginx sur l'hôte**, qui parle à chacune via son port loopback.

```
/opt/site-bpm/    → conteneur site      → 127.0.0.1:8080 ─┐
/opt/authentik/   → conteneurs authentik → 127.0.0.1:9000 ─┼→ nginx (hôte, 80/443)
<bpm-log>/        → conteneurs bpm-log   → 127.0.0.1:8082 ─┘
```

### 3.0bis Faut-il un dépôt git pour authentik ?

**Non.** Deux raisons :

1. Il n'y a **pas de code** à versionner. authentik est une image publique ; sur
   disque il n'y a que deux fichiers, `docker-compose.yml` et `.env`.
2. Toute la configuration que tu feras aux §5–§7 (source Google, provider, groupes,
   policies) vit **dans la base PostgreSQL d'authentik**, pas dans des fichiers.
   Un dépôt git ne la capturerait pas. Ce qui protège cette config, c'est la
   sauvegarde du §11 — pas git.

Et surtout : le `.env` contient `AUTHENTIK_SECRET_KEY` et `PG_PASS`. **Ne jamais le
commiter**, même dans un dépôt privé.

> Si tu veux quand même versionner : mettre uniquement le `docker-compose.yml` et
> les confs nginx dans un dépôt d'infra, avec un `.gitignore` contenant `.env`, et
> un `.env.example` sans valeurs. Utile à plusieurs ; superflu en solo tant que la
> sauvegarde du §11 tourne.

### 3.1 Pas de réseau partagé à créer

nginx tourne **sur l'hôte**, pas dans Docker. Il joint donc les conteneurs par un
port publié sur la loopback, pas par un réseau Docker. Rien à modifier dans
`docker-compose.prod.yml` de bpm-log, ni dans celui de site-bpm.

#### Pourquoi du HTTP en clair à l'intérieur de la VM ?

Le montage s'appelle **terminaison TLS** : le chiffrement s'arrête à la porte
d'entrée, nginx, et tout ce qui est derrière parle en clair.

```
Internet ──HTTPS 443──> nginx ──HTTP──> 127.0.0.1:9000 (authentik)
                          │                  ▲
Internet ──HTTP 80───> nginx │              jamais exposé
                     301 → https://          au réseau
```

Précision sur le port 80 : nginx n'y **redirige** rien vers les conteneurs. Le bloc
`listen 80` ne contient qu'un `return 301 https://$host$request_uri` — il renvoie le
navigateur vers HTTPS, point. Tout le trafic utile passe par le bloc `listen 443`,
qui déchiffre puis reparle en HTTP à `127.0.0.1:9000`.

Le TLS protège des données **en transit sur un réseau non fiable** : câbles, wifi,
routeurs, FAI — des endroits où un tiers peut lire ou modifier les paquets. Entre
nginx et le conteneur, il n'y a rien de tout ça : l'interface `lo` est de la mémoire
noyau, sur la même machine. Les octets ne touchent aucune carte réseau. Chiffrer ce
saut protégerait contre un attaquant qui est **déjà root sur la VM** — et un tel
attaquant lit de toute façon la clé privée de nginx.

Ce qu'on gagne à ne pas chiffrer en interne :

- **un seul certificat à gérer**, sur nginx, au lieu d'un par conteneur ;
- **un seul renouvellement** certbot, pas trois ;
- pas de CA interne, pas de conteneurs à qui apprendre à se faire confiance ;
- `curl http://127.0.0.1:9000` débogue directement, sans démêler du TLS.

Le port 9443 d'authentik est supprimé pour la même raison, plus une : il sert un
certificat **auto-signé**. nginx devrait le contacter en désactivant la vérification
— du chiffrement sans authentification, c'est-à-dire une illusion de sécurité pour
un coût réel.

> Ce raisonnement tient **parce que le saut reste sur `127.0.0.1`**. Le jour où un
> conteneur part sur une autre machine, le trafic redevient du réseau réel et il faut
> du TLS (ou un tunnel) sur ce saut.

Corollaire : puisque authentik reçoit du HTTP, il croit par défaut que le client a
demandé du HTTP, et fabrique des `redirect_uri` en `http://` que Google refuse. C'est
pour ça que le bloc nginx du §3.3 envoie `X-Forwarded-Proto $scheme` — c'est
l'en-tête qui lui dit « la requête d'origine était en HTTPS ».

Règle : **publier sur `127.0.0.1` uniquement**, jamais sur `0.0.0.0`.

```yaml
ports:
  - "127.0.0.1:9000:9000"   # ✅ joignable par nginx local seulement
  # - "9000:9000"           # ❌ exposé sur Internet, contourne nginx et le TLS
```

Plan d'attribution des ports : voir le tableau du §2. Le 9000 est libre (vérifié).

```bash
ss -tlnp | grep 9000   # doit ne rien renvoyer avant l'install
```

### 3.2 Stack authentik

> `jojo` n'est **pas** dans le groupe `docker` et `/opt` appartient à `root` :
> toutes les commandes de cette section prennent `sudo`. (Pour éviter le `sudo`
> devant chaque `docker` : `sudo usermod -aG docker jojo` puis re-login — mais
> c'est équivalent à donner le root à `jojo`, donc à faire en connaissance de cause.)

```bash
sudo mkdir -p /opt/authentik
cd /opt/authentik
sudo curl -O https://goauthentik.io/docker-compose.yml
```

> Toujours partir du compose officiel plutôt que d'en écrire un : les tags d'image
> et les variables changent à chaque version. Stable courante : https://version.goauthentik.io/

Générer les secrets et fixer le port loopback, dans `/opt/authentik/.env` :

```bash
sudo sh -c '{
  echo "PG_PASS=$(openssl rand -base64 36 | tr -d "\n")"
  echo "AUTHENTIK_SECRET_KEY=$(openssl rand -base64 60 | tr -d "\n")"
  echo "AUTHENTIK_ERROR_REPORTING__ENABLED=false"
  echo "COMPOSE_PORT_HTTP=127.0.0.1:9000"
} > /opt/authentik/.env'
sudo chmod 600 /opt/authentik/.env
```

`COMPOSE_PORT_HTTP` mérite une explication. Le compose officiel contient :

```yaml
    ports:
      - "${COMPOSE_PORT_HTTP:-9000}:9000"
      - "${COMPOSE_PORT_HTTPS:-9443}:9443"
```

Docker Compose fait une simple substitution de texte, donc
`COMPOSE_PORT_HTTP=127.0.0.1:9000` produit `"127.0.0.1:9000:9000"` — exactement le
binding voulu, **sans éditer le compose**. Avantage : la prochaine mise à jour
d'authentik (re-télécharger le `docker-compose.yml`) n'écrase pas ce réglage.

> ⚠️ Sans ce réglage, le compose publie sur toutes les interfaces et authentik est
> joignable **en clair depuis Internet** sur le port 9000, ce qui court-circuite
> nginx et le TLS. C'est la même erreur que celle corrigée sur site-bpm au §2.

Reste une seule édition manuelle du `docker-compose.yml`, service `server` :

```yaml
  server:
    # ...
    container_name: authentik_server   # nom stable pour docker logs / exec
    ports:
      - "${COMPOSE_PORT_HTTP:-9000}:9000"
      # supprimer la ligne 9443 : c'est nginx qui termine le TLS
```

Vérifier le résultat avant de lancer :

```bash
cd /opt/authentik
sudo docker compose config | grep -E "host_ip|published|target"
```

Attendu — `host_ip: 127.0.0.1` et un seul port publié :

```yaml
        target: 9000
        published: "9000"
        host_ip: 127.0.0.1
```

> `docker compose config` affiche la conf **normalisée** : la forme courte
> `"127.0.0.1:9000:9000"` est réécrite en forme longue sur plusieurs lignes
> (`target` / `published` / `host_ip`). Chercher la chaîne `127.0.0.1:9000` telle
> quelle ne donne donc rien — il faut chercher `host_ip`.

Lancer :

```bash
cd /opt/authentik
sudo docker compose up -d
sudo docker compose ps   # server + worker + postgresql + redis doivent être healthy
```

Le premier démarrage prend 1–3 min (migrations DB). Suivre : `sudo docker compose logs -f server`.

Contrôle avant de passer à nginx :

```bash
ss -tln | grep 9000                       # doit afficher 127.0.0.1:9000, PAS 0.0.0.0:9000
curl -sI http://127.0.0.1:9000/ | head -1 # doit répondre (302 ou 200)
```

### 3.3 nginx

> ⚠️ **L'ordre est contraignant.** Un bloc `ssl_certificate` qui pointe sur un
> fichier inexistant est une erreur `[emerg]` : nginx refuse de charger *toute* la
> conf. Or certbot a besoin d'un nginx qui tourne **et** d'un `server` block qui
> réponde sur le port 80 pour ce nom. Écrire le bloc HTTPS complet avant d'avoir le
> certificat mène donc à une impasse :
> ```
> [emerg] cannot load certificate "/etc/letsencrypt/live/auth.bpmclubsono.com/fullchain.pem"
> ```
> On procède en deux temps : **HTTP d'abord, certbot ensuite**. C'est certbot qui
> écrit lui-même le bloc 443.

#### Étape 1 — bloc HTTP seul

Nouveau fichier `/etc/nginx/sites-available/authentik.conf` — **séparé** de
`bpm-web.conf`, pour qu'une erreur de conf sur l'un ne casse pas l'autre.
Aucune ligne `ssl_*`, aucun `listen 443` à ce stade :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name auth.bpmclubsono.com;

    # authentik envoie de gros cookies de session et des uploads d'icônes.
    client_max_body_size 20M;
    proxy_buffers 8 16k;
    proxy_buffer_size 32k;

    location / {
        proxy_pass http://127.0.0.1:9000;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # WebSocket : requis par l'interface d'admin authentik.
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/authentik.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://auth.bpmclubsono.com/ | head -1   # doit répondre (302 ou 200), pas de 444
```

Ce `curl` est le test qui compte : il prouve que le `Host:` atteint bien ce bloc et
non le catch-all `default_server` du §2 — condition nécessaire pour que le challenge
ACME aboutisse.

#### Étape 2 — certbot écrit le bloc HTTPS

```bash
sudo certbot --nginx -d auth.bpmclubsono.com
```

certbot obtient le certificat, puis **modifie `authentik.conf` lui-même** : il ajoute
`listen 443 ssl` + les deux lignes `ssl_certificate` au bloc existant (les
`proxy_set_header` sont donc conservés) et crée un second bloc port 80 qui redirige
vers HTTPS. Répondre *Redirect* quand il pose la question.

#### Étape 3 — finitions

⚠️ **Ne rien ajouter avant d'avoir relu le fichier.** certbot a déjà inséré, avec le
commentaire `# managed by Certbot` :

```nginx
    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    ssl_certificate     /etc/letsencrypt/live/auth.bpmclubsono.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.bpmclubsono.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
```

Les deux dernières lignes **sont déjà là**. Les rajouter à la main donne :

```
[emerg] "ssl_session_timeout" directive is duplicate in /etc/letsencrypt/options-ssl-nginx.conf:8
```

`options-ssl-nginx.conf` contient des directives non répétables ; l'inclure deux fois
dans le même bloc les déclare deux fois. Le message pointe le fichier inclus, pas
l'`include` fautif — d'où sa lecture trompeuse.

**La seule ligne à ajouter** dans le bloc 443, et uniquement si elle est absente :

```nginx
    http2 on;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Un `nginx -t` qui échoue ne casse rien : le processus en cours garde son ancienne
> configuration et continue de servir. Les sites déjà en ligne restent debout tant
> que le `reload` n'a pas été accepté.

> `http2 on;` est la forme moderne. L'ancienne syntaxe `listen 443 ssl http2;` est
> dépréciée depuis nginx 1.25 et produit l'avertissement visible sur `bpm-web.conf` :
> ```
> [warn] the "listen ... http2" directive is deprecated, use the "http2" directive instead
> ```
> Sans gravité, mais à corriger en passant : dans `bpm-web.conf` lignes 15–16,
> retirer le `http2` des deux `listen` et ajouter une ligne `http2 on;` dans le bloc.

`$connection_upgrade` n'existe pas par défaut. L'ajouter **une fois** dans le
contexte `http` — `/etc/nginx/conf.d/upgrade.conf` :

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

#### Pourquoi `conf.d/` et pas directement dans `authentik.conf` ?

D'abord ce que fait `conf.d/`. Le `nginx.conf` de la VM se termine par :

```nginx
http {
    # ...
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

Les deux dossiers sont donc inclus **au même endroit**, dans le contexte `http`. La
séparation est une **convention Debian**, pas une règle nginx :

| Dossier | Contient | Portée |
|---|---|---|
| `conf.d/` | réglages partagés : `map`, `gzip`, formats de log, zones `limit_req`, réglages SSL communs | tout le serveur |
| `sites-available/` + symlink dans `sites-enabled/` | un fichier par site, avec ses blocs `server` | un site |

`conf.d/` est inclus **avant** `sites-enabled/`, donc ce qu'il définit est disponible
pour tous les sites.

Techniquement, rien n'interdit de mettre le `map` en haut de `authentik.conf` :
placé hors de tout bloc `server`, il est bien dans le contexte `http` et fonctionne.
La raison de ne pas le faire est ailleurs.

**Un `map` définit une variable globale au contexte `http`.** Le jour où tu ajoutes
une deuxième app qui a besoin de WebSocket et où tu copies son bloc nginx — `map`
compris — nginx refuse de démarrer :

```
nginx: [emerg] duplicate variable "connection_upgrade"
```

Même logique que le `default_server` du §2 : une ressource unique pour tout le
serveur se déclare **une fois, dans un fichier partagé**. Chaque `sites-available/`
ne contient que ce qui est propre à son site.

#### Pourquoi ce `map` est nécessaire

Un WebSocket ne commence pas comme une connexion à part : c'est une requête HTTP/1.1
normale qui demande un changement de protocole.

```http
GET /ws/client/ HTTP/1.1
Connection: Upgrade
Upgrade: websocket
```

Le serveur répond `101 Switching Protocols`, et la connexion devient un tuyau
bidirectionnel.

Problème : `Connection` et `Upgrade` sont des en-têtes **hop-by-hop** (RFC 7230
§6.1) — ils décrivent le lien entre *deux machines adjacentes*, pas le message de
bout en bout. La norme impose à tout proxy de les **retirer** au lieu de les
transmettre. nginx respecte la norme : par défaut il les supprime, authentik reçoit
une requête ordinaire, ne renvoie jamais `101`, et le navigateur affiche un échec de
WebSocket.

Il faut donc les **réinjecter explicitement** côté amont :

```nginx
proxy_http_version 1.1;                              # HTTP/1.0 ne connaît pas Upgrade
proxy_set_header Upgrade    $http_upgrade;           # recopie la demande du client
proxy_set_header Connection $connection_upgrade;     # ← le map
```

Pourquoi pas `Connection "upgrade"` en dur ? Parce que ce bloc `location /` sert
**toutes** les requêtes, pas seulement les WebSockets. Une page HTML classique
annoncerait alors un upgrade que personne n'a demandé, ce qui casse le keep-alive et
perturbe certains backends. Le `map` rend l'en-tête conditionnel :

| `$http_upgrade` reçu | `$connection_upgrade` envoyé |
|---|---|
| `websocket` | `upgrade` |
| vide (requête normale) | `close` |

> **Alternative** : si les WebSockets tiennent dans un seul préfixe d'URL, on peut
> se passer du `map` en mettant `Connection "upgrade"` en dur dans une `location`
> dédiée. C'est ce que fait déjà `bpm-web.conf` avec son `location /ws/`.
> Pour authentik, le `map` est plus sûr : il reste correct même si les chemins
> WebSocket changent d'une version à l'autre.

> `X-Forwarded-Proto $scheme` est obligatoire : sans lui authentik se croit en HTTP
> et fabrique des `redirect_uri` en `http://`, que Google refuse. C'est la cause
> n°1 des boucles de redirection derrière un proxy.

Activer + certificat :

```bash
sudo ln -s /etc/nginx/sites-available/authentik.conf /etc/nginx/sites-enabled/
sudo nginx -t                      # valider AVANT de recharger
sudo systemctl reload nginx

sudo certbot --nginx -d auth.bpmclubsono.com
sudo nginx -t && sudo systemctl reload nginx
```

**Certificat — confirmé** : la VM utilise certbot **par domaine**
(`/etc/letsencrypt/live/bpmclubsono.com/`), il n'y a pas de wildcard, et Cloudflare
est en DNS-only. La commande `certbot --nginx -d auth.bpmclubsono.com` ci-dessus
fonctionne donc telle quelle (HTTP-01), et certbot réécrit lui-même le bloc `listen 80`.

Ajouter aussi les mêmes lignes que `bpm-web.conf` pour hériter des réglages TLS :

```nginx
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
```

> **À considérer : un wildcard `*.bpmclubsono.com` en DNS-01.** Le DNS est déjà chez
> Cloudflare, donc `certbot --dns-cloudflare` avec un token API (permission
> *Zone:DNS:Edit*) délivre un cert unique couvrant **toutes** les apps futures.
> Chaque nouvelle app (§13) n'aurait alors plus aucune étape certificat — juste un
> `server` block qui pointe sur le même cert.
> Compromis : un token Cloudflare à stocker sur la VM (`/etc/letsencrypt/cf.ini`,
> `chmod 600`), et un cert unique dont la compromission touche tous les sous-domaines.
> Avec ~5 apps prévues, ça vaut le coup ; avec 2, `certbot --nginx` par app suffit.
> **Recommandation : rester en HTTP-01 par sous-domaine pour l'instant**, migrer vers
> le wildcard le jour de la 3ᵉ app.

### 3.4 Compte admin initial

Ouvrir **https://auth.bpmclubsono.com/if/flow/initial-setup/**

Créer le compte `akadmin` avec un mot de passe fort. Le stocker dans un gestionnaire
de mots de passe : c'est le compte de secours si Google tombe ou si une policy te
verrouille dehors.

> ⚠️ Cette URL de setup n'est active que tant qu'aucun admin n'existe. Y aller
> immédiatement après le démarrage — ne pas laisser l'instance exposée sans admin.

---

## 4. Créer le client OAuth côté Google

Dans **Google Cloud Console** (https://console.cloud.google.com) :

1. Créer un projet (ex. `bpm-sso`).
2. **APIs & Services → OAuth consent screen**
   - Type : **External**. *Internal* n'existe que pour un Google Workspace ; le club
     n'a qu'une simple adresse Gmail, donc *Internal* est indisponible et **aucune
     restriction de domaine n'est possible côté Google**. Le filtrage se fait
     entièrement dans authentik (§6) — c'est la seule barrière, la soigner.
   - Scopes : `openid`, `email`, `profile`. Rien d'autre — pas de scope sensible,
     pas de validation Google nécessaire.
   - Deux modes possibles :
     - *Testing* : seuls les emails listés dans « Test users » peuvent se connecter
       (100 max). Double filtrage (Google + authentik), mais chaque nouveau membre
       demande une modif dans la console Google.
     - *Production* : n'importe quel compte Google atteint l'écran de login
       authentik ; c'est authentik qui accepte ou refuse. Publication immédiate,
       pas de validation Google pour ces 3 scopes.

   **Recommandé : *Production***, et tout le contrôle d'accès dans authentik.
   Un seul endroit à gérer pour toutes les apps, au lieu d'une liste Google par app.
3. **Credentials → Create credentials → OAuth client ID**
   - Type : *Web application*
   - Name : libre (`bpm-auth` par exemple). Ce nom est purement cosmétique côté
     console Google, il n'apparaît nulle part dans le protocole et n'a **aucun lien**
     avec le slug de la source authentik.
   - **Authorized redirect URI** :
     ```
     https://auth.bpmclubsono.com/source/oauth/callback/google/
     ```
     Le slash final est obligatoire. Une erreur ici → `redirect_uri_mismatch`.
     Le `google` de l'URL est le **slug de la source authentik** (§5), pas le nom du
     client Google : il doit rester `google` quel que soit le nom choisi ci-dessus.
4. Noter **Client ID** et **Client Secret**.

---

## 5. Brancher Google dans authentik

> ⚠️ **Ne pas passer par « Applications → Créer avec un assistant ».** Cet assistant
> crée une *Application* + un *Provider*, c'est-à-dire une app **qui utilise
> authentik pour se connecter** (le §7, pour bpm-log). Ce n'est **pas** le chemin
> pour brancher Google.
>
> | Ce que tu veux | Objet authentik | Menu |
> |---|---|---|
> | Se connecter **avec** Google | **Source** | `Directory → Federation & Social login` |
> | Faire qu'une app utilise authentik | **Provider** + **Application** | `Applications → Providers` (§7) |
>
> Repère : si l'écran demande un *Authorization Flow*, un *Client Type* ou un
> *Client ID généré*, tu es dans un **Provider** → mauvais écran pour Google.
> L'écran d'une **Source** Google demande un *Consumer key* / *Consumer secret*,
> ceux que tu as copiés depuis la console Google au §4.

Admin interface → **Directory → Federation & Social login → Create → Google OAuth Source**

| Champ | Valeur |
|---|---|
| Name | `Google` |
| Slug | `google` ← doit correspondre à l'URL de callback ci-dessus |
| Consumer key | Client ID Google |
| Consumer secret | Client Secret Google |
| User matching mode | `Link to a user with identical email address` |
| Enrollment flow | **laisser vide** — voir §6.1 |

Le *user matching mode* rattache un membre déjà créé dans authentik (avec le bon
email) à son compte Google, au lieu de créer un doublon. L'*enrollment flow* vide
empêche tout compte Google inconnu de s'inscrire : c'est la barrière principale
puisque Google ne peut rien filtrer (pas de Workspace).

Puis rendre la source visible sur l'écran de login :
**Flows & Stages → Flows → `default-authentication-flow`** → vérifier que le stage
`default-authentication-identification` a bien `Google` dans *Sources*.

Tester : ouvrir une fenêtre privée sur https://auth.bpmclubsono.com → un bouton
Google doit apparaître.

---

## 6. Restreindre l'accès

Le club n'a pas de Google Workspace : les membres arrivent avec des adresses
`@gmail.com` personnelles, indiscernables de n'importe quel compte Google du monde.
**Toute la sécurité d'accès repose sur authentik.** Deux couches, à mettre toutes
les deux.

### 6.1 Interdire l'auto-inscription (couche décisive)

Le réglage le plus important, et le plus simple : **une connexion Google ne doit
jamais pouvoir créer un compte.** Elle ne doit que *rattacher* un compte que tu as
créé toi-même.

Sur la source Google (**Directory → Federation & Social login → Google**) :

| Champ | Valeur |
|---|---|
| User matching mode | `Link to a user with identical email address` |
| Enrollment flow | **vide** (aucun flow sélectionné) |

Sans enrollment flow, un compte Google inconnu obtient une erreur au lieu d'un
nouveau compte. Le processus d'ajout d'un membre devient :

1. **Directory → Users → Create** dans authentik, avec **exactement** l'adresse
   Gmail que le membre utilisera. Pas de mot de passe à définir.
2. Le membre clique « Google », authentik reconnaît l'email, rattache, laisse entrer.

> ⚠️ `Link to a user with identical email address` fait confiance au claim `email`
> de Google. C'est sûr **parce que la source est Google** (qui vérifie ses propres
> adresses). Ne jamais activer ce mode sur une source dont les emails ne sont pas
> vérifiés — ce serait une prise de contrôle de compte triviale.

### 6.2 Filtrer par application (groupe)

La 6.1 dit qui entre dans authentik. Cette couche dit **quelles apps** chaque membre
voit — c'est elle qui sert quand il y aura plusieurs apps (§13).

> ⚠️ **Il n'existe pas de « Group Membership Policy »** dans la liste des types de
> policies (`Customisation → Policies → Create` propose Event Matcher, Expression,
> GeoIP, Password…, Reputation — rien sur les groupes). Restreindre une app à un
> groupe **n'est pas une policy** : c'est une **liaison** posée directement sur
> l'application. Pas de policy à créer ici.

1. **Directory → Groups → Create** → nom `bpm-log-users`. Rien d'autre à remplir.
2. Ouvrir l'application : **Applications → Applications → `BPM Log`** (créée au §7).
3. Onglet **Policy / Group / User Bindings** → bouton **Bind existing Group/User**
   (et non *Bind existing policy*).
4. Choisir le groupe `bpm-log-users`, valider.

Le principe de l'autorisation applicative dans authentik : tant qu'une application
n'a **aucune liaison**, elle est ouverte à tous les utilisateurs authentifiés. Dès
qu'il y en a au moins une, l'accès est refusé par défaut et seules les liaisons
laissent passer. Une liaison peut être un **groupe**, un **utilisateur** précis, ou
une **policy** (pour une condition calculée).

Un membre hors du groupe se connecte à authentik mais ne voit pas l'app et reçoit
`403` sur bpm-log. Retirer quelqu'un d'une app = le sortir du groupe. Aucun
déploiement, aucune modification de code.

> **Si tu as besoin d'une condition plus fine** (ex. « membre du groupe **et**
> connecté depuis moins de 12 h »), c'est là qu'une **Expression Policy** entre en
> jeu, avec la fonction intégrée :
> ```python
> return ak_is_group_member(request.user, name="bpm-log-users")
> ```
> Inutile ici : la liaison de groupe directe fait exactement la même chose sans code.

### 6.3 Optionnel : allowlist d'emails en filet

Si tu préfères garder l'auto-inscription active (moins de gestes manuels), remplace
la 6.1 par une **Expression Policy** (`Customisation → Policies → Create`) bindée
sur le flow d'enrollment de la source :

```python
email = (request.context.get("prompt_data", {}).get("email") or "").lower()

ALLOWED_EMAILS = (
    "jonathan005h@gmail.com",
    # ... un email Google par membre
)

if email in ALLOWED_EMAILS:
    return True

ak_message("Ce compte Google n'est pas autorisé.")
return False
```

> Moins bien que la 6.1 : la liste vit dans une policy, il faut l'éditer à chaque
> nouveau membre, et une faute de frappe ouvre ou ferme la porte silencieusement.
> Utile surtout le jour où le club aura un Workspace :
> `if email.endswith("@bpmclubsono.com"): return True`.

---

## 7. Créer le provider OIDC pour bpm-log

**Applications → Providers → Create → OAuth2/OpenID Provider**

| Champ | Valeur |
|---|---|
| Name | `bpm-log` |
| Authorization flow | `default-provider-authorization-implicit-consent` (pas d'écran de consentement pour une app interne) |
| Client type | **Public** |
| Client ID | *généré* — `V78lyn7AFPkq3pTZ0aTHcUxDoBYMQVoPH8aqu8r5` (pas un secret : il transite dans l'URL du navigateur à chaque login) |
| **Grant Types** | **`Authorization Code` + `Refresh token`, rien d'autre** — décocher les 6 restants |
| Redirect URIs | `https://log.bpmclubsono.com/auth/callback` |
| Signing Key | `authentik Self-signed Certificate` |
| Scopes | `openid`, `email`, `profile` |
| Subject mode | `Based on the User's Email` |

#### Les champs qui posent question

**Grant Types — n'en garder que deux**

authentik coche presque tout par défaut, par compatibilité. Chaque *grant type* est
une **manière différente de demander un token** : en laisser un actif, c'est laisser
une porte ouverte, même si ton app ne l'emprunte jamais. On ne garde donc que ce
qu'on utilise réellement.

| Grant type | Garder ? | Pourquoi |
|---|---|---|
| **Authorization Code** | ✅ | le flux du §0bis (code → `POST /token` → `id_token`). C'est celui-là qu'on utilise |
| **Refresh token** | ✅ | permet à `automaticSilentRenew` de renouveler l'`id_token` de 5 min sans redemander Google |
| Implicit | ❌ | ancêtre du code+PKCE : renvoie le token **dans l'URL**, donc dans l'historique, le `Referer` et les logs. Déconseillé par OAuth 2.1 |
| Hybrid | ❌ | mélange code + implicit, hérite du même problème d'URL |
| Client credentials | ❌ | authentification **machine-à-machine**, sans utilisateur. bpm-log agit toujours pour un membre |
| Password | ❌ | voir ci-dessous — le plus dangereux des huit |
| Device-code | ❌ | pour les appareils sans navigateur (TV, CLI). Pas notre cas |
| Token exchange | ❌ | délégation entre services (RFC 8693). Pas notre cas — déjà décoché par défaut |

**Pourquoi `Password` est le plus important à décocher.**

Ce grant (*Resource Owner Password Credentials*) permet à un client d'envoyer
directement un identifiant et un mot de passe au endpoint `/token`, sans jamais
passer par la page de login. Conséquence sur ton montage :

- il **court-circuite les flows** d'authentik — donc la source Google, les stages MFA
  et les policies du §6 ne s'exécutent pas ;
- tu as décidé au §6.1 que l'accès passe **uniquement** par Google ; ce grant
  rouvrirait une entrée par mot de passe local ;
- le client étant **public**, il n'y a pas de `client_secret` pour le protéger :
  connaître le `client_id` — qui circule dans l'URL à chaque login — suffirait à
  tester des mots de passe contre le endpoint, en contournant le rate-limiting de la
  page de login.

Il est retiré d'OAuth 2.1 pour ces raisons.

> Règle générale : **un grant type activé mais inutilisé n'apporte rien et ajoute une
> surface d'attaque.** Deux cases suffisent ici, et ce sera pareil pour chaque app du
> §13 (sauf une app machine-à-machine, qui prendra `Client credentials` et **elle
> seule**).

**Authorization Flow — `explicit` ou `implicit consent` ?**

C'est l'écran « **Authorize Application** — cette application demande accès à votre
profil / email », celui que tu connais quand tu te connectes à un service tiers avec
Google.

| Flow | Comportement | Pour qui |
|---|---|---|
| `…-explicit-consent` | affiche l'écran de consentement à la 1ʳᵉ connexion, mémorise le choix | apps **tierces**, que tu ne contrôles pas |
| `…-implicit-consent` | aucun écran, redirection directe | apps **maison**, que tu héberges toi-même |

Le consentement OAuth existe pour un cas précis : *« ce service extérieur veut lire
tes données chez moi, es-tu d'accord ? »*. bpm-log est ton app, sur ton domaine,
alimentée par ta base — il n'y a pas de tiers à qui donner ou refuser un accès.
Demander à un membre du club s'il autorise le club à lire son email n'a pas de sens,
et le clic supplémentaire à chaque nouvelle app casse l'intérêt du SSO (§0bis :
« redirection instantanée »).

→ **`default-provider-authorization-implicit-consent`** pour toutes les apps BPM.
Garder `explicit` si un jour une app extérieure au club se branche sur l'IdP.

**Client Type — `Confidentiel` ou `Public` ?**

La question est : *cette app peut-elle garder un secret ?*

| | Confidentiel | Public |
|---|---|---|
| Le code tourne | sur un serveur | dans le navigateur |
| Un `client_secret` est | invisible du public | lisible par tous (F12) |
| Preuve d'identité | `client_secret` | **PKCE** (§0bis, étapes 1 et 9) |
| Exemples | backend Django, Next.js server | **SPA React**, app mobile |

authentik propose *Confidentiel* par défaut — c'est le bon choix dans le cas général,
mais **pas ici**. Le front de bpm-log est une SPA React : tout son JavaScript est
téléchargé par le navigateur, donc un `client_secret` qu'on y placerait serait
lisible par n'importe quel visiteur. Un secret public n'est plus un secret.

PKCE remplace ce secret par une preuve à usage unique, générée à chaque connexion et
jamais stockée dans le code (§0bis).

→ **`Public`** pour bpm-log.

> Le choix se fait par app, pas une fois pour toutes : une future app BPM avec un
> vrai backend prendra `Confidentiel` (§13).

Puis **Applications → Applications → Create** :

| Champ | Valeur |
|---|---|
| Name | `BPM Log` |
| Slug | `bpm-log` |
| Provider | `bpm-log` |

Vérifier les URLs générées :

```bash
curl -s https://auth.bpmclubsono.com/application/o/bpm-log/.well-known/openid-configuration | jq
```

Retenir `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `issuer`.

#### Vérifier que les grant types sont bien restreints

⚠️ **Le champ `grant_types_supported` du document de découverte ne prouve rien** : il
décrit ce que l'implémentation OAuth2 d'authentik sait faire en général, pas ce que
*ce* provider autorise. Il liste `password`, `implicit`, `client_credentials` même
après les avoir décochés. Pour savoir ce qui est réellement actif, interroger le
endpoint :

```bash
CID=<client_id du provider>
curl -s -X POST https://auth.bpmclubsono.com/application/o/token/ \
  -d "grant_type=password&client_id=$CID&username=nobody-test&password=x" | jq -r .error
```

| Réponse | Signification |
|---|---|
| `unsupported_grant_type` | ✅ le grant est bien désactivé |
| `invalid_grant` | ⚠️ le grant est **actif** — authentik a accepté la méthode et n'a rejeté que les identifiants |

Même test avec `grant_type=client_credentials`. Les identifiants bidons sont sans
risque : on ne teste que le **code d'erreur**, pas un compte réel.

> `code_challenge_methods_supported` annonce `plain` **et** `S256`. `plain` envoie le
> vérificateur PKCE en clair, ce qui annule l'intérêt de PKCE. `oidc-client-ts`
> utilise `S256` par défaut (§9) — ne jamais forcer `plain`.

> `token_endpoint_auth_methods_supported` sans `none` est un indice que le provider
> est encore en **Confidentiel**. Un client public s'authentifie sans secret, donc
> `none` doit apparaître. À recroiser avec le champ *Client Type* dans l'UI.

---

## 8. Backend — vérifier les tokens authentik

### 8.1 Config

`backend/app/config.py`, ajouter :

```python
    # OIDC (authentik)
    oidc_issuer: str = "https://auth.bpmclubsono.com/application/o/bpm-log/"
    oidc_client_id: str = ""
    oidc_jwks_url: str = "https://auth.bpmclubsono.com/application/o/bpm-log/jwks/"
```

et dans `.env` de prod :

```dotenv
OIDC_ISSUER=https://auth.bpmclubsono.com/application/o/bpm-log/
OIDC_CLIENT_ID=<client id du provider>
OIDC_JWKS_URL=https://auth.bpmclubsono.com/application/o/bpm-log/jwks/
```

### 8.2 Vérification JWKS

`httpx` est aujourd'hui dans `[project.optional-dependencies] dev` de
`backend/pyproject.toml` — le déplacer dans `dependencies`, il devient nécessaire
en production. `python-jose[cryptography]` est déjà là et gère RS256 + JWKS.

Nouveau `backend/app/security/oidc.py` :

```python
"""Vérification des id_token OIDC émis par authentik (RS256, clés via JWKS)."""

import time
from typing import Any

import httpx
from jose import JWTError, jwt

from app.config import settings

_jwks_cache: dict[str, Any] = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600.0


async def _get_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_fetched_at
    if _jwks_cache and time.monotonic() - _jwks_fetched_at < _JWKS_TTL:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(settings.oidc_jwks_url)
        response.raise_for_status()
    _jwks_cache = response.json()
    _jwks_fetched_at = time.monotonic()
    return _jwks_cache


async def decode_oidc_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(
            token,
            await _get_jwks(),
            algorithms=["RS256"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer,
        )
    except (JWTError, httpx.HTTPError):
        return None
```

> Le cache TTL évite un appel HTTP à chaque requête API. En cas de rotation de clé
> chez authentik, la propagation prend au pire une heure — acceptable. Pour faire
> mieux : vider le cache sur un échec de signature et réessayer une fois.

### 8.3 `deps.py`

Remplacer le corps de `get_current_user` : le token n'est plus décodé avec le
secret HS256 mais via `decode_oidc_token`, et l'identité vient de l'email.

```python
    payload = await decode_oidc_token(credentials.credentials)
    if payload is None:
        raise invalid

    email = payload.get("email")
    if not email:
        raise invalid

    membre = await db.scalar(select(Membre).where(Membre.email == email))
    if membre is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte Google non rattaché à un membre.",
        )
    return membre
```

Conséquences :

- `sub` n'est plus l'id du membre → l'appariement se fait sur `email`. Donc
  `Membre.email` doit être **unique** et **non nul** (vérifier la contrainte en base).
- Le rôle ne vient plus du token. Deux choix :
  - le lire depuis `Membre.role` en base (**recommandé** — la source de vérité reste
    ta base, pas authentik) ;
  - ou mapper les groupes authentik (`payload["groups"]`) sur les rôles, si tu veux
    piloter les rôles depuis authentik.
- `UserAuth.is_active` : garder le contrôle, il permet de désactiver un membre côté
  app sans toucher à authentik.

### 8.4 Routes à supprimer

- `POST /auth/login` (mot de passe) → supprimer.
- `POST /auth/refresh` → supprimer ; c'est authentik qui gère le refresh.
- `GET /auth/me` → garder tel quel.
- `app/security/passwords.py` et la table `user_auth.password_hash` → supprimer
  **après** la bascule confirmée (voir §10).
- `app/routers/webauthn.py` → à supprimer aussi : WebAuthn se reconfigure côté
  authentik (Flows & Stages → `default-authenticator-webauthn-setup`) et devient
  un second facteur de l'IdP, pas de l'app. Meilleur endroit pour lui.

---

## 9. Frontend — flow PKCE

```bash
npm i oidc-client-ts
```

`frontend/src/lib/oidc.ts` :

```ts
import { UserManager, WebStorageStateStore } from "oidc-client-ts";

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
```

`oidc-client-ts` active PKCE par défaut pour `response_type: "code"`.

Changements à faire :

| Fichier | Changement |
|---|---|
| `src/features/auth/LoginPage.tsx` | Le formulaire email/mdp devient un bouton unique → `userManager.signinRedirect()` |
| nouvelle route `/auth/callback` | appelle `userManager.signinRedirectCallback()` puis redirige vers `/` |
| `src/app/AuthContext.tsx` | l'état vient de `userManager.getUser()` au lieu du `tokenStore` |
| `src/lib/tokenStore.ts` | supprimé — `oidc-client-ts` gère le stockage et le renouvellement |
| `src/lib/api.ts` | `Authorization: Bearer ${user.id_token}` |
| `src/lib/webauthn.ts` | supprimé |
| `src/app/ProtectedRoute.tsx` | inchangé si l'API du contexte reste la même |

> Envoyer l'`id_token` (et non l'`access_token`) : c'est lui qui porte le claim
> `email` et dont l'`aud` vaut ton client_id. L'access_token authentik cible
> l'API d'authentik, pas la tienne.

Variables dans `frontend/.env.production` :

```dotenv
VITE_OIDC_ISSUER=https://auth.bpmclubsono.com/application/o/bpm-log/
VITE_OIDC_CLIENT_ID=<client id>
```

CORS backend : `CORS_ORIGINS=https://log.bpmclubsono.com`. Aucun appel navigateur
direct vers authentik autre que les redirections → pas de CORS à configurer côté
authentik.

---

## 10. Ordre de bascule (sans se verrouiller dehors)

1. Déployer authentik (§3–§7) **sans toucher à bpm-log**. Vérifier un login Google
   sur https://auth.bpmclubsono.com.
2. Créer dans authentik un compte par membre existant, avec **le même email** que
   dans la table `membre`. Les ajouter au groupe `bpm-log-users`.
   ```sql
   SELECT email FROM membre ORDER BY email;
   ```
   Comparer avec la liste des comptes authentik avant de basculer — un email absent
   = un membre bloqué dehors.
3. Brancher backend + frontend (§8–§9) sur une branche, tester en local contre
   l'authentik de prod (ajouter `http://localhost:5173/auth/callback` aux redirect
   URIs du provider le temps du test, **puis le retirer**).
4. Déployer. Garder pendant quelques jours :
   - la colonne `password_hash` en base (non lue, mais présente),
   - le compte `akadmin`.
5. Une fois confirmé : migration Alembic pour supprimer `password_hash` et les
   tables WebAuthn, et supprimer `app/security/passwords.py` + `jwt.py`.

### Protéger Adminer au passage

Adminer n'a pas de port publié en prod, mais si tu l'exposes un jour — et le
wildcard DNS fait que `adminer.bpmclubsono.com` résout déjà :

1. **Applications → Providers → Create → Proxy Provider**, mode *Forward auth
   (single application)*, External host `https://adminer.bpmclubsono.com`.
2. Créer l'application liée, puis onglet **Policy / Group / User Bindings** →
   *Bind existing Group/User* → groupe `bpm-admins` (§6.2).
3. Publier Adminer sur `127.0.0.1:8081` dans le compose.

Chez nginx l'équivalent de `forward_auth` s'appelle **`auth_request`** — même idée,
syntaxe plus verbeuse. `/etc/nginx/sites-available/adminer.conf` :

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name adminer.bpmclubsono.com;

    ssl_certificate     /etc/letsencrypt/live/adminer.bpmclubsono.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/adminer.bpmclubsono.com/privkey.pem;

    # Sous-requête vers authentik : 2xx = autorisé, 401 = rediriger vers le login.
    location / {
        auth_request     /outpost.goauthentik.io/auth/nginx;
        error_page       401 = @goauthentik_proxy_signin;
        auth_request_set $auth_cookie $upstream_http_set_cookie;
        add_header       Set-Cookie $auth_cookie;

        auth_request_set $authentik_email    $upstream_http_x_authentik_email;
        auth_request_set $authentik_username $upstream_http_x_authentik_username;
        auth_request_set $authentik_groups   $upstream_http_x_authentik_groups;
        proxy_set_header X-authentik-email    $authentik_email;
        proxy_set_header X-authentik-username $authentik_username;
        proxy_set_header X-authentik-groups   $authentik_groups;

        proxy_pass http://127.0.0.1:8081;
    }

    # Endpoints de l'outpost authentik.
    location /outpost.goauthentik.io {
        proxy_pass              http://127.0.0.1:9000/outpost.goauthentik.io;
        proxy_set_header        Host $host;
        proxy_set_header        X-Original-URL $scheme://$http_host$request_uri;
        proxy_pass_request_body off;
        proxy_set_header        Content-Length "";
        auth_request_set        $auth_cookie $upstream_http_set_cookie;
        add_header              Set-Cookie $auth_cookie;
    }

    location @goauthentik_proxy_signin {
        internal;
        add_header Set-Cookie $auth_cookie;
        return 302 /outpost.goauthentik.io/start?rd=$request_uri;
    }
}
```

> Le module `auth_request` est compilé dans `nginx-full` / le paquet Debian standard.
> Vérifier : `nginx -V 2>&1 | grep -o with-http_auth_request_module`. S'il manque,
> installer `nginx-extras`.

⚠️ Ce montage protège Adminer **uniquement via nginx**. Adminer lui-même reste sans
mot de passe. Si le port 8081 fuit sur `0.0.0.0`, la protection est contournée — d'où
le `127.0.0.1:` obligatoire du §3.1.

---

## 11. Sauvegardes et récupération

authentik devient un point de défaillance unique : s'il tombe, **personne** ne peut
se connecter à bpm-log.

- Sauvegarder le volume postgres d'authentik au même rythme que celui de bpm-log :
  ```bash
  docker compose -f /opt/authentik/docker-compose.yml exec postgresql \
    pg_dump -U authentik authentik | gzip > authentik-$(date +%F).sql.gz
  ```
- Sauvegarder `/opt/authentik/.env` (le `AUTHENTIK_SECRET_KEY` est nécessaire pour
  relire les secrets chiffrés en base — sans lui, le dump est inexploitable).
- Garder `akadmin` + son mot de passe hors ligne.
- Prévoir le cas « Google indisponible » : authentik permet un login mot de passe
  local en secours pour les comptes qui en ont un.

---

## 12. Vérifications

```bash
# authentik répond en TLS
curl -sI https://auth.bpmclubsono.com | head -1

# la config OIDC est publiée
curl -s https://auth.bpmclubsono.com/application/o/bpm-log/.well-known/openid-configuration | jq .issuer

# les clés publiques sont là
curl -s https://auth.bpmclubsono.com/application/o/bpm-log/jwks/ | jq '.keys[0].kid'

# l'API refuse bien un token bidon
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer abc' https://log.bpmclubsono.com/api/auth/me   # → 401
```

## 13. Ajouter les apps suivantes

authentik est monté une fois ; chaque app suivante coûte ~15 min de clics.

### La règle : une application = un provider = un `client_id`

Ne **jamais** réutiliser le `client_id` de bpm-log pour une autre app. C'est le
`aud` du token qui isole les apps entre elles : un token émis pour `bpm-log` est
rejeté par `app-2` parce que `aud` ne correspond pas. Un `client_id` partagé
supprime cette frontière — une app compromise donne accès aux autres.

### Recette pour chaque nouvelle app

1. DNS : **rien à faire**, le wildcard `*.bpmclubsono.com` couvre déjà le sous-domaine.
2. nginx : un fichier `sites-available/<app>.conf` de plus (copier celui du §3.3,
   changer `server_name` et le port loopback), puis `certbot --nginx -d <app>.bpmclubsono.com`.
3. authentik → **Providers → Create** : OAuth2/OIDC, *Public* + PKCE si SPA,
   *Confidential* si l'app a un backend qui peut cacher un secret.
4. authentik → **Applications → Create**, liée au provider.
5. **Groups** : créer `<app>-users`, puis le binder sur l'app via
   *Policy / Group / User Bindings → Bind existing Group/User* (§6.2).
6. Côté app : `authority` = `https://auth.bpmclubsono.com/application/o/<slug>/`,
   `client_id` = celui du provider. Le reste du code est identique à bpm-log.

Les utilisateurs, eux, ne sont créés **qu'une fois** (§6.1). Une nouvelle app ne
demande aucune re-création de comptes ni de mots de passe.

### Choisir le type de provider

| Cas | Provider | Pourquoi |
|---|---|---|
| SPA React / PWA | **OAuth2/OIDC, client public + PKCE** | pas de secret dans le JS |
| App avec backend (Django, Rails, Next server) | **OAuth2/OIDC, confidential** | le secret reste serveur |
| Outil tiers qu'on ne peut pas modifier (Adminer, Grafana sans plugin, Uptime Kuma, un `.html` statique) | **Proxy Provider** + `auth_request` nginx | zéro ligne de code |
| Outil qui parle déjà LDAP ou SAML | **LDAP / SAML Provider** | authentik les expose aussi |

C'est le vrai intérêt du montage : le Proxy Provider protège en 5 minutes des outils
qui n'ont aucune notion d'authentification. Adminer (§10) est le premier exemple.

### Modéliser les groupes

Deux axes à ne pas mélanger :

- **Accès** : `bpm-log-users`, `app2-users` → *qui voit quelle app*. Bindés sur les
  applications.
- **Rôle** : `bpm-bureau`, `bpm-admins` → *quoi faire dans l'app*. Exposés dans le
  claim `groups`, lus par l'app.

Pour bpm-log spécifiquement : **garder les rôles en base** (`Membre.role`), pas dans
authentik. La base reste la source de vérité métier ; authentik ne répond qu'à
« qui es-tu ». Le jour où un rôle doit être partagé entre deux apps, le déplacer
vers un groupe authentik.

### Coût marginal

RAM et CPU d'authentik ne bougent pas avec le nombre d'apps — seul le nombre
d'utilisateurs actifs compte, et un club se compte en dizaines. Les 7 Go libres de
la VM couvrent authentik + bpm-log + plusieurs apps.

---

## Pannes courantes

| Symptôme | Cause |
|---|---|
| `redirect_uri_mismatch` chez Google | slash final manquant dans l'URI Google, ou slug de source ≠ `google` |
| Boucle de redirection infinie | horloge de la VM désynchronisée → `iat`/`exp` invalides. `timedatectl set-ntp true` |
| 401 sur toutes les requêtes API | `aud` du token ≠ `OIDC_CLIENT_ID`, ou envoi de l'`access_token` au lieu de l'`id_token` |
| certbot échoue pour `auth.` | port 80 fermé au firewall, ou le `server` block écoute mal (`nginx -t`) |
| `[emerg] cannot load certificate … No such file` | bloc `ssl_certificate` écrit **avant** d'avoir lancé certbot → impasse : nginx ne charge pas, donc certbot ne peut pas tourner. Repasser le fichier en HTTP seul (§3.3 étape 1), recharger, puis certbot |
| `[warn] "listen ... http2" is deprecated` | syntaxe d'avant nginx 1.25 ; remplacer `listen 443 ssl http2;` par `listen 443 ssl;` + `http2 on;` |
| `[emerg] "ssl_session_timeout" is duplicate in options-ssl-nginx.conf` | `include /etc/letsencrypt/options-ssl-nginx.conf;` présent **deux fois** dans le même `server` — certbot l'a déjà ajouté. Supprimer la ligne rajoutée à la main (celle sans `# managed by Certbot`) |
| nginx renvoie 502 sur `auth.` | conteneur non publié sur `127.0.0.1:9000` (`sudo ss -tlnp \| grep 9000`) |
| Boucle de redirection après Google | `X-Forwarded-Proto $scheme` absent du bloc nginx |
| `upstream sent too big header` | augmenter `proxy_buffer_size` / `proxy_buffers` (§3.3) |
