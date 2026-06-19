"""The encrypted full-DB snapshot — newly written for HealthRoutine Phase-3 v1.

E2E INVARIANT (non-negotiable): every column here is either OPAQUE CIPHERTEXT or
non-sensitive METADATA. `blob` is the client-side `buildBackupFile` output —
ciphertext sealed to the account's master public key. The server stores it
verbatim, returns it verbatim, and has NO code path and NO key to decrypt it. The
plaintext health data never exists server-side.

One row per account (last-writer-wins): a `PUT` upserts by `account_id`; the
upload's `updated_at` decides whether it replaces the stored row. No per-record
sync, no history — that's v2.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # One snapshot per account (unique) — the latest wins.
    account_id: Mapped[str] = mapped_column(
        String, ForeignKey("accounts.id"), nullable=False, unique=True, index=True
    )
    # OPAQUE CIPHERTEXT — the encrypted backup file bytes. Stored/returned as-is.
    blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # METADATA (client-asserted): when the client snapshot was taken — drives
    # last-writer-wins. Size in bytes (sanity/quota). Device id (which device
    # pushed it) — an opaque client string, not PII the server interprets.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)

    # Server-side bookkeeping (when the row was last written here).
    stored_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
