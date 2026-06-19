"""The sync account = a user's E2E identity.

Replaces LawDocs `User` + `UserKey` (keyring), collapsed to exactly what Phase-3
v1 needs: the user is identified by their X25519 PUBLIC key (base64). There is no
email/password as the login secret — auth is "prove you hold the private key"
(see `app/services/auth_service.py`).

`wrapped_private_key` is OPTIONAL and OPAQUE: if the client chooses to back up its
private key for cross-device recovery, it sends the key already wrapped (e.g.
scrypt + secretbox under the recovery phrase) — the server stores the blob and
CANNOT unwrap it (it has no phrase). This mirrors the LawDocs keyring's
`wrapped_private_key` contract. No plaintext key ever lands here.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # The X25519 public key (base64) — the account's identity AND the key a
    # challenge is encrypted to. Unique: one account per key.
    public_key: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    # OPTIONAL, OPAQUE: the private key wrapped on the CLIENT under the recovery
    # phrase. Server stores it verbatim and cannot decrypt it. Null when the user
    # keeps the key only on-device / in their own cloud.
    wrapped_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # UX label for the key ("iPhone 15") — informational only.
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
