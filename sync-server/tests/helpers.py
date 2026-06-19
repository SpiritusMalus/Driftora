"""Client-side crypto helpers for the tests — mirrors what the app does.

A test plays the role of a device: it has an X25519 keypair (nacl.box, exactly the
client `lib/core/crypto/e2ee.ts` model) and can solve a key-challenge by
decrypting the server's nonce with its PRIVATE key — the same operation as
`e2ee.solveChallenge`. The server only ever sees the PUBLIC key and the decrypted
nonce; the private key never leaves the test, mirroring the real device.
"""

from __future__ import annotations

import base64

from nacl.public import Box, PrivateKey, PublicKey


def new_keypair() -> tuple[PrivateKey, str]:
    """Returns (private key object, base64 public key) — the client keypair."""
    priv = PrivateKey.generate()
    pub_b64 = base64.b64encode(bytes(priv.public_key)).decode()
    return priv, pub_b64


def solve_challenge(encrypted_challenge_b64: str, priv: PrivateKey) -> str:
    """Decrypts the server's encrypted nonce with the private key → base64 nonce.

    Parses the key_blob layout the server produced (nonce[24] | eph_pub[32] | box),
    opens the box, and returns the plaintext nonce base64-encoded — the proof the
    server's /v1/auth/login expects. This is the Python twin of the TS
    `e2ee.solveChallenge`.
    """
    blob = base64.b64decode(encrypted_challenge_b64)
    nonce, eph_pub, box_ct = blob[:24], blob[24:56], blob[56:]
    opened = Box(priv, PublicKey(eph_pub)).decrypt(box_ct, nonce)
    return base64.b64encode(opened).decode()


async def register_and_login(client, priv: PrivateKey, pub_b64: str) -> str:
    """Registers an account for `pub_b64` and logs in by key. Returns the session
    token (Bearer). A convenience used by the snapshot tests."""
    resp = await client.post("/v1/account", json={"public_key": pub_b64})
    assert resp.status_code == 200, resp.text

    ch = await client.get("/v1/auth/challenge", params={"public_key": pub_b64})
    assert ch.status_code == 200, ch.text
    nonce = solve_challenge(ch.json()["encrypted_challenge"], priv)

    login = await client.post(
        "/v1/auth/login", json={"challenge_id": ch.json()["challenge_id"], "nonce": nonce}
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]
