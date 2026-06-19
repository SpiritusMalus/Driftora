"""Snapshot sync — opaque, byte-identical, last-writer-wins, auth-gated.

Proves: a stored snapshot is returned byte-for-byte unchanged and is opaque; the
stored bytes equal exactly what was uploaded (the server never transforms or reads
it); push→pull moves the blob between devices; last-writer-wins by updated_at; and
both endpoints require a valid session.
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.snapshot import Snapshot
from tests.helpers import new_keypair, register_and_login

# A realistic opaque payload: random bytes standing in for `buildBackupFile`
# ciphertext. The server must treat it as opaque — it never decodes its meaning.
CIPHERTEXT = os.urandom(2048)
BLOB_B64 = base64.b64encode(CIPHERTEXT).decode()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_snapshot_round_trip_is_byte_identical(client, db_session):
    """Upload then download returns exactly the uploaded ciphertext, and the row
    stored in the DB equals those bytes (no server transform)."""
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)

    updated = datetime(2026, 6, 19, 10, 0, tzinfo=timezone.utc)
    put = await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": BLOB_B64,
            "updated_at": updated.isoformat(),
            "size": len(CIPHERTEXT),
            "device_id": "iphone-1",
        },
        headers=_auth(token),
    )
    assert put.status_code == 200, put.text

    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    assert got.status_code == 200, got.text
    body = got.json()
    # Byte-identical: the returned base64 decodes to exactly the uploaded bytes.
    assert base64.b64decode(body["blob"]) == CIPHERTEXT
    assert body["device_id"] == "iphone-1"
    assert body["size"] == len(CIPHERTEXT)

    # And the DB stored the raw ciphertext verbatim — the server never read it.
    row = (await db_session.execute(select(Snapshot))).scalar_one()
    assert row.blob == CIPHERTEXT


async def test_get_snapshot_404_when_absent(client, db_session):
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)
    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    assert got.status_code == 404


async def test_snapshot_requires_auth(client):
    """Both endpoints reject an unauthenticated request."""
    put = await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": BLOB_B64,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "size": len(CIPHERTEXT),
            "device_id": "x",
        },
    )
    assert put.status_code in (401, 403)
    got = await client.get("/v1/sync/snapshot")
    assert got.status_code in (401, 403)


async def test_last_writer_wins_newer_replaces(client, db_session):
    """A newer snapshot replaces an older one; a stale push is ignored."""
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)

    old_bytes = os.urandom(64)
    new_bytes = os.urandom(64)
    t_old = datetime(2026, 6, 19, 8, 0, tzinfo=timezone.utc)
    t_new = t_old + timedelta(hours=2)

    async def push(blob: bytes, when: datetime, device: str):
        return await client.put(
            "/v1/sync/snapshot",
            json={
                "blob": base64.b64encode(blob).decode(),
                "updated_at": when.isoformat(),
                "size": len(blob),
                "device_id": device,
            },
            headers=_auth(token),
        )

    assert (await push(old_bytes, t_old, "phone-a")).status_code == 200
    assert (await push(new_bytes, t_new, "phone-b")).status_code == 200

    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    assert base64.b64decode(got.json()["blob"]) == new_bytes
    assert got.json()["device_id"] == "phone-b"


async def test_last_writer_wins_stale_push_ignored(client, db_session):
    """Pushing an OLDER snapshot after a newer one keeps the newer (no clobber)."""
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)

    new_bytes = os.urandom(64)
    old_bytes = os.urandom(64)
    t_new = datetime(2026, 6, 19, 12, 0, tzinfo=timezone.utc)
    t_old = t_new - timedelta(hours=5)

    async def push(blob: bytes, when: datetime, device: str):
        return await client.put(
            "/v1/sync/snapshot",
            json={
                "blob": base64.b64encode(blob).decode(),
                "updated_at": when.isoformat(),
                "size": len(blob),
                "device_id": device,
            },
            headers=_auth(token),
        )

    assert (await push(new_bytes, t_new, "phone-new")).status_code == 200
    # Stale push still returns 200 (accepted/converged) but must NOT overwrite.
    assert (await push(old_bytes, t_old, "phone-old")).status_code == 200

    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    assert base64.b64decode(got.json()["blob"]) == new_bytes
    assert got.json()["device_id"] == "phone-new"


async def test_push_pull_across_two_devices(client, db_session):
    """Device A pushes; device B (same key/account) pulls the same blob — the
    multi-device convergence the feature exists for, server-side."""
    priv, pub = new_keypair()
    token_a = await register_and_login(client, priv, pub)
    token_b = await register_and_login(client, priv, pub)  # second device, same key

    payload = os.urandom(512)
    await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": base64.b64encode(payload).decode(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "size": len(payload),
            "device_id": "device-a",
        },
        headers=_auth(token_a),
    )

    got = await client.get("/v1/sync/snapshot", headers=_auth(token_b))
    assert got.status_code == 200
    assert base64.b64decode(got.json()["blob"]) == payload


async def test_blob_rejected_when_not_base64(client, db_session):
    """A malformed transport wrapper is a 400 — and notably the server reaches this
    by failing to BASE64-decode, never by trying to decrypt."""
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)
    resp = await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": "!!!not base64!!!",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "size": 3,
            "device_id": "x",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 400
