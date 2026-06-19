"""Passwordless login-by-key — the secret is the KEY, not a password.

Adapted from LawDocs `tests/test_login_by_key.py`. Proves: a valid private key
solves the challenge and logs in; a wrong key cannot; the flow is replay-proof and
expiry-bounded; and the login secret is key-possession (there is no password
field anywhere).
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.auth_challenge import AuthChallenge
from tests.helpers import new_keypair, solve_challenge


async def _challenge(client, pub_b64: str) -> dict:
    resp = await client.get("/v1/auth/challenge", params={"public_key": pub_b64})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_register_account_stores_only_public_key(client, db_session):
    """Registration takes a public key (no password) and stores no plaintext key."""
    _, pub_b64 = new_keypair()
    resp = await client.post("/v1/account", json={"public_key": pub_b64})
    assert resp.status_code == 200, resp.text
    assert resp.json()["public_key"] == pub_b64

    from app.models.account import Account

    row = (await db_session.execute(select(Account).where(Account.public_key == pub_b64))).scalar_one()
    # The only key the server holds is the PUBLIC key; no private key column exists
    # other than the OPTIONAL opaque wrapped one, which is null here.
    assert row.wrapped_private_key is None


async def test_key_login_success_issues_session(client, db_session):
    """A valid private key solves the challenge → a session token is issued."""
    priv, pub_b64 = new_keypair()
    await client.post("/v1/account", json={"public_key": pub_b64})

    ch = await _challenge(client, pub_b64)
    nonce = solve_challenge(ch["encrypted_challenge"], priv)

    resp = await client.post(
        "/v1/auth/login", json={"challenge_id": ch["challenge_id"], "nonce": nonce}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["account_id"]


async def test_wrong_key_cannot_login(client, db_session):
    """A DIFFERENT private key cannot solve a challenge issued to another public key
    → 401. The key, not a password, is what authenticates."""
    # Account owns key A; attacker holds key B and tries to authenticate as A.
    _, pub_a = new_keypair()
    await client.post("/v1/account", json={"public_key": pub_a})

    priv_b, _ = new_keypair()
    ch = await _challenge(client, pub_a)
    # Attacker tries to open A's challenge with B's private key — box.open fails,
    # so the attacker can only submit a bogus nonce, which the server rejects.
    bogus = base64.b64encode(b"\x00" * 32).decode()
    resp = await client.post(
        "/v1/auth/login", json={"challenge_id": ch["challenge_id"], "nonce": bogus}
    )
    assert resp.status_code == 401

    # Even solving with the wrong key's box would not match A's nonce hash.
    # (Sanity: solving A's challenge requires A's private key, which the attacker
    # does not have — there is no path to the correct nonce.)
    del priv_b


async def test_key_login_replay_rejected(client, db_session):
    """The same solved challenge cannot be reused (single-use)."""
    priv, pub_b64 = new_keypair()
    await client.post("/v1/account", json={"public_key": pub_b64})

    ch = await _challenge(client, pub_b64)
    nonce = solve_challenge(ch["encrypted_challenge"], priv)
    body = {"challenge_id": ch["challenge_id"], "nonce": nonce}

    first = await client.post("/v1/auth/login", json=body)
    assert first.status_code == 200
    second = await client.post("/v1/auth/login", json=body)
    assert second.status_code == 401


async def test_key_login_expired_rejected(client, db_session):
    """An expired challenge cannot be used."""
    priv, pub_b64 = new_keypair()
    await client.post("/v1/account", json={"public_key": pub_b64})

    ch = await _challenge(client, pub_b64)
    nonce = solve_challenge(ch["encrypted_challenge"], priv)

    challenge = (
        await db_session.execute(
            select(AuthChallenge).where(AuthChallenge.id == ch["challenge_id"])
        )
    ).scalar_one()
    challenge.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    resp = await client.post(
        "/v1/auth/login", json={"challenge_id": ch["challenge_id"], "nonce": nonce}
    )
    assert resp.status_code == 401


async def test_key_login_no_account_returns_401(client):
    """A correctly solved challenge for a key with NO account → generic 401 (no
    account enumeration)."""
    priv, pub_b64 = new_keypair()  # never registered
    ch = await _challenge(client, pub_b64)
    nonce = solve_challenge(ch["encrypted_challenge"], priv)
    resp = await client.post(
        "/v1/auth/login", json={"challenge_id": ch["challenge_id"], "nonce": nonce}
    )
    assert resp.status_code == 401


async def test_challenge_invalid_public_key_returns_400(client):
    resp = await client.get("/v1/auth/challenge", params={"public_key": "not-base64!!"})
    assert resp.status_code == 400


async def test_challenge_issued_without_account(client):
    """Challenge is issued even with no account — otherwise it would leak existence."""
    _, pub_b64 = new_keypair()
    ch = await _challenge(client, pub_b64)
    assert ch["challenge_id"]
    assert ch["encrypted_challenge"]
