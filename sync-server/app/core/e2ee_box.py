"""Anonymous-box encryption of a short payload to a user's PUBLIC key.

Lifted from LawDocs `app/services/e2ee_file.py` (the `encrypt_for_public_key`
path only — the file/AES envelope is NOT needed here). Used by the key-challenge
flow: the server encrypts a random nonce to the account's public key, and ONLY
the holder of the matching private key can decrypt and return it.

IMPORTANT (E2E invariant): this module encrypts TO a public key. The server has
no private key here, so it can never decrypt a snapshot or a challenge it issued —
it only proves possession on the client side. The wire format matches the client
`lib/core/crypto/e2ee.ts` key_blob layout:

    blob = box_nonce[24] | ephemeral_pub[32] | nacl_box(payload)[len+16]
"""

from __future__ import annotations

import base64

import nacl.utils
from nacl.public import Box, PrivateKey, PublicKey

_NONCE_LEN = 24  # nacl.box nonce length


def encrypt_for_public_key(plaintext: bytes, public_key_b64: str) -> str:
    """Encrypts `plaintext` to a base64 X25519 public key, returning base64.

    A fresh ephemeral sender keypair is used per call (anonymous box), so no
    sender identity is embedded and the same plaintext encrypts differently each
    time. Raises if the public key is malformed (caller maps that to a 400).
    """
    pub_bytes = base64.b64decode(public_key_b64)
    recipient_pub = PublicKey(pub_bytes)  # raises on wrong length

    ephemeral_priv = PrivateKey.generate()
    box = Box(ephemeral_priv, recipient_pub)

    nonce = nacl.utils.random(_NONCE_LEN)
    # EncryptedMessage.ciphertext excludes the nonce; we prepend it ourselves so
    # the layout exactly matches the client's key_blob (nonce | eph_pub | box).
    box_ciphertext = box.encrypt(plaintext, nonce).ciphertext

    blob = nonce + bytes(ephemeral_priv.public_key) + box_ciphertext
    return base64.b64encode(blob).decode()
