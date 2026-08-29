# 0002 — Authentification déléguée à authentik (OIDC)

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Remplace** : la ligne « Auth » de [0001](0001-stack-choice.md) (JWT access + refresh, WebAuthn/Passkey, mot de passe Argon2)
- **Contexte** : les membres du club ont tous un compte Google personnel. Le club n'a pas de Google Workspace.

## Décision

L'API n'émet plus aucun token et ne vérifie plus aucun mot de passe.
authentik, hébergé sur la VM de l'association (`auth.bpmclubsono.com`), est le
seul fournisseur d'identité. Il est lui-même client OAuth de Google.

| Point | Choix |
|---|---|
| Protocole | OIDC, Authorization Code + PKCE (client **public**, aucun secret dans la SPA) |
| Jeton envoyé à l'API | l'**`id_token`** — c'est lui qui porte `email` et vise notre `client_id` |
| Vérification côté API | signature RS256 via le JWKS d'authentik (caché 1 h), plus `iss`, `aud`, `exp` |
| Identité métier | le claim `email`, rapproché de `membres.email` |
| Compte inconnu | provisionné automatiquement en `Staff` |
| Contrôle d'accès | groupe `bpm-log-users` côté authentik, plus `users_auth.is_active` côté base |

Détail opérationnel (conf des sources, providers, ajout d'un membre) :
[../authentik-sso.md](../authentik-sso.md).

## Raisons

- Le login par mot de passe imposait de stocker et faire tourner des secrets pour
  une trentaine de personnes qui ont déjà un compte Google.
- WebAuthn en propre représentait un flux à maintenir (enregistrement,
  révocation, perte d'appareil) pour le même service qu'authentik rend déjà.
- authentik centralise l'accès de toutes les applications du club, avec ses
  flows et policies. Un login maison les contournait.

## Conséquences

- `POST /auth/login`, `POST /auth/refresh` et le router WebAuthn ont disparu.
  Seul `GET /auth/me` subsiste.
- `aud` n'est pas optionnel : toutes les applications d'un même authentik sont
  signées par la même clé avec le même `iss`. Sans lui, un token émis pour une
  autre application serait accepté.
- Une désynchronisation du `client_id` entre front et back donne un login qui
  réussit puis **401 sur tous les appels API** — la vérification `aud` échoue
  sans message explicite.
- Aucun Admin ne peut naître tout seul (le provisioning donne `Staff`) :
  `python -m app.seed` crée le premier, la promotion suivante est un geste
  explicite en base.
- Le rôle reste la seule chose que la base sait et qu'authentik ignore.
