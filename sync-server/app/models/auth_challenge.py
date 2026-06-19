"""One-time challenge for passwordless login-by-key — lifted from LawDocs
`app/models/auth_challenge.py` unchanged.

The server encrypts a random nonce to the account's public key and stores here
only its SHA-256 hash + the public key + a short TTL. The holder of the private
key decrypts the nonce and returns it; the server re-hashes and compares, then
marks the challenge used (single-use). The private key is never seen by the
server.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuthChallenge(Base):
    __tablename__ = "auth_challenges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # Public key the nonce was encrypted to — used to find the account on verify.
    public_key: Mapped[str] = mapped_column(String, nullable=False)
    # SHA-256 of the nonce: the raw nonce is never stored, only compared by hash.
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Set on successful verify → replay is impossible (single-use).
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
