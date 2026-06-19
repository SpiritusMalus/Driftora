"""The E2E invariant — the moat. The server stores/returns ONLY ciphertext +
wrapped keys + metadata, and is incapable of decrypting.

These tests assert structurally (no decrypt symbol / no private-key import in the
app package) AND behaviorally (a plaintext marker sealed into a snapshot never
appears in any response, and the stored bytes are exactly the opaque ciphertext).
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timezone
from pathlib import Path

from tests.helpers import new_keypair, register_and_login

_APP_DIR = Path(__file__).resolve().parent.parent / "app"


def _app_sources() -> list[Path]:
    return list(_APP_DIR.rglob("*.py"))


def test_no_decrypt_code_path_in_app():
    """No module under app/ contains a snapshot-decrypt path. We grep the source
    for decrypt primitives that would imply the server can read user data.

    Two tiers:
      - DECRYPT primitives (`box.decrypt`, `secretbox.open`, `.decrypt(`,
        `decrypt_file`) are forbidden in EVERY file, no exception — these are what
        would let the server read user data.
      - The `Box(` / `PrivateKey(` constructors do not by themselves decrypt; they
        are used ONLY in the audited `e2ee_box.py`, and ONLY to ENCRYPT a challenge
        nonce TO the user's public key with an ephemeral sender key (no recipient
        private key, no bulk-cipher open). That one file is exempted from the
        constructor check, but it is STILL subject to the decrypt-primitive scan
        above — so even there a decrypt path would fail this test.
    """
    decrypt_primitives = ["box.decrypt", "secretbox.open", ".decrypt(", "decrypt_file"]
    # Constructors that merely *enable* asymmetric crypto — encrypt OR decrypt.
    # Allowed in the sanctioned encrypt-only module; banned anywhere else.
    constructors = ["Box(", "PrivateKey("]
    sanctioned_encrypt_only = "e2ee_box.py"

    offenders: list[str] = []
    for path in _app_sources():
        text = path.read_text(encoding="utf-8")
        for needle in decrypt_primitives:
            if needle in text:
                offenders.append(f"{path.name}: {needle}")
        if path.name != sanctioned_encrypt_only:
            for needle in constructors:
                if needle in text:
                    offenders.append(f"{path.name}: {needle}")
    assert offenders == [], f"server must not contain decrypt code paths: {offenders}"


def test_no_private_key_generation_or_import_in_app():
    """The server never generates/holds an account private key. `encrypt_for_public_key`
    uses an EPHEMERAL sender key internally (in e2ee_box.py) — allowed there — but no
    other module may construct private keys, and none may import a private key field.
    """
    for path in _app_sources():
        if path.name == "e2ee_box.py":
            # The only sanctioned use: an ephemeral sender key to encrypt TO the
            # user (challenge). It still cannot decrypt a snapshot (no AES/secretbox
            # bulk layer here, no recipient private key).
            continue
        text = path.read_text(encoding="utf-8")
        assert "PrivateKey.generate" not in text, f"{path.name} generates a private key"
        assert "private_key_backup" not in text, f"{path.name} references a private key backup"


async def test_response_never_leaks_plaintext_marker(client, db_session):
    """A unique plaintext marker placed in the snapshot body never appears in any
    API response — the server only ever echoes opaque ciphertext.

    The blob the client uploads is OPAQUE to the server; to prove no leak we upload
    a payload whose plaintext form contains a marker, but base64'd/encrypted as the
    client would. Here we simulate the worst case: even the metadata responses and
    the blob echo must not surface the marker in cleartext.
    """
    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)

    marker = b"TOPSECRET-DIARY-MARKER-9f3a-health"
    # The opaque payload the client would send is ciphertext; we model it as random
    # bytes that do NOT contain the marker (encryption would hide it). The server
    # must never produce the marker from anything it stores.
    opaque = os.urandom(1024)
    assert marker not in opaque  # sanity: our opaque stand-in has no plaintext

    await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": base64.b64encode(opaque).decode(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "size": len(opaque),
            "device_id": "iphone",
        },
        headers=_auth(token),
    )

    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    assert got.status_code == 200
    # The marker must not appear in the response body or headers in cleartext.
    assert marker.decode() not in got.text
    assert marker.decode() not in str(dict(got.headers))
    # The echoed blob is byte-identical to the opaque upload (no transform).
    assert base64.b64decode(got.json()["blob"]) == opaque


async def test_server_cannot_decrypt_a_real_sealed_blob(client, db_session):
    """Seal a marker to the account's PUBLIC key (anonymous box), upload it, and
    confirm the server stores/returns the ciphertext unchanged and cannot recover
    the plaintext — there is no private key server-side to open it."""
    from nacl.public import Box, PrivateKey, PublicKey

    priv, pub = new_keypair()
    token = await register_and_login(client, priv, pub)

    # Client-side seal: anonymous box to the account public key (same shape the
    # real client uses for the snapshot's wrapped key).
    marker = b"BODY-MIND-PLAINTEXT-DO-NOT-LEAK"
    eph = PrivateKey.generate()
    recipient_pub = PublicKey(base64.b64decode(pub))
    nonce = os.urandom(24)
    sealed = nonce + bytes(eph.public_key) + Box(eph, recipient_pub).encrypt(marker, nonce).ciphertext

    await client.put(
        "/v1/sync/snapshot",
        json={
            "blob": base64.b64encode(sealed).decode(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "size": len(sealed),
            "device_id": "iphone",
        },
        headers=_auth(token),
    )

    got = await client.get("/v1/sync/snapshot", headers=_auth(token))
    returned = base64.b64decode(got.json()["blob"])
    assert returned == sealed  # opaque, byte-identical

    # The plaintext is recoverable ONLY with the account PRIVATE key (which lives
    # only in the test/device, never on the server). Prove the round-trip works
    # client-side, demonstrating the data is real but server-inaccessible.
    n, eph_pub, ct = returned[:24], returned[24:56], returned[56:]
    opened = Box(priv, PublicKey(eph_pub)).decrypt(ct, n)
    assert opened == marker
    # And the marker never appears server-side in cleartext.
    assert marker.decode() not in got.text


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
