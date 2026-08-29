"""Tests fumée : l'app démarre, les routes santé répondent, l'auth protège l'API.

Ces tests ne touchent pas la base (sauf /health/db), ils valident le câblage
FastAPI + le boundary de sécurité. asyncio_mode=auto (cf. pyproject) marque
automatiquement les tests/fixtures async.
"""


async def test_health_ok(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


async def test_docs_exposed_in_debug(client):
    # DEBUG=true en test → /openapi.json doit être disponible.
    res = await client.get("/openapi.json")
    assert res.status_code == 200
    assert res.json()["info"]["title"] == "BPM Log API"


async def test_protected_route_requires_auth(client):
    # Sans jeton, l'API doit refuser (401 ou 403 selon le mécanisme bearer).
    res = await client.get("/api/equipments")
    assert res.status_code in (401, 403)


async def test_api_issues_no_token(client):
    # L'authentification appartient à authentik : l'API n'expose plus de login.
    res = await client.post(
        "/api/auth/login",
        json={"email": "nope@bpm.fr", "password": "wrong"},
    )
    assert res.status_code == 404


async def test_forged_token_is_rejected(client):
    # Un jeton qui n'est pas signé par authentik ne doit jamais passer.
    res = await client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer pas.un.vrai.token"},
    )
    assert res.status_code == 401
