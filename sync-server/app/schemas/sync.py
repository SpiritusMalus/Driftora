"""Wire schemas for the sync API.

Account registration + passwordless key-login schemas are adapted from LawDocs
`app/schemas/auth.py` (the key-challenge / key-login pair). The snapshot schemas
are new: the encrypted blob travels as base64 in JSON, kept OPAQUE end-to-end.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── Account registration ────────────────────────────────────────────────────


class AccountCreateRequest(BaseModel):
    # The X25519 public key (base64) — the account identity. No password.
    public_key: str
    # OPTIONAL, OPAQUE wrapped private key (client-encrypted under the recovery
    # phrase). Server stores it verbatim; it can never unwrap it.
    wrapped_private_key: str | None = None
    label: str | None = None


class AccountCreateResponse(BaseModel):
    account_id: str
    public_key: str


# ── Login by key (challenge-response) — lifted from LawDocs ──────────────────


class KeyChallengeRequest(BaseModel):
    public_key: str  # base64 public key the client wants to authenticate as


class KeyChallengeResponse(BaseModel):
    challenge_id: str
    # A nonce encrypted to the public key — only the private-key holder can read
    # it. Format matches the client `e2ee.solveChallenge` input.
    encrypted_challenge: str


class KeyLoginRequest(BaseModel):
    challenge_id: str
    nonce: str  # base64 of the DECRYPTED nonce — the proof of key possession


class KeyLoginResponse(BaseModel):
    access_token: str  # session JWT (account auth, NOT a data key)
    account_id: str


# ── Snapshot upload / download (the blob stays opaque) ───────────────────────


class SnapshotUploadRequest(BaseModel):
    # Base64 of the encrypted backup-file bytes (client `buildBackupFile` output).
    # OPAQUE — the server never base64-decodes it to inspect contents; it only
    # stores the bytes. min_length guards against an empty upload.
    blob: str = Field(min_length=1)
    # When the client snapshot was taken (drives last-writer-wins).
    updated_at: datetime
    # Plaintext size in bytes (client-asserted, sanity only).
    size: int = Field(ge=0)
    # Opaque device identifier (which device pushed this).
    device_id: str = Field(min_length=1, max_length=128)


class SnapshotMetaResponse(BaseModel):
    updated_at: datetime
    size: int
    device_id: str


class SnapshotUploadResponse(BaseModel):
    status: str
    meta: SnapshotMetaResponse


class SnapshotDownloadResponse(BaseModel):
    # Base64 of the stored ciphertext — byte-identical to what was uploaded.
    blob: str
    updated_at: datetime
    size: int
    device_id: str
