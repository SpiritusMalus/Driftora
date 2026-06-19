"""Auth/session helpers — lifted from LawDocs `app/core/security.py`, trimmed.

Kept: the HS256 SESSION token (issued after a device proves possession of its E2E
private key) and the challenge-nonce hash for the passwordless key-login. Dropped:
magic-link and account-password helpers — v1 sync auth is key-only, and the SESSION
secret here is NOT a data key (it cannot decrypt any snapshot).

Stdlib only for hashing — no extra dependency.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = "HS256"


def create_access_token(account_id: str) -> str:
    """Issues the session JWT for an authenticated account (sub = account id)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": account_id, "exp": expire},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> str | None:
    """Returns the account id from a valid token, or None if it's bad/expired."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        account_id = payload.get("sub")
        exp = payload.get("exp")
        if not account_id or not exp:
            return None
        return account_id
    except JWTError:
        return None


def hash_challenge_nonce(nonce: bytes) -> str:
    """SHA-256 of a login challenge nonce — stored instead of the raw nonce so the
    server can verify the returned value without ever persisting the secret."""
    return hashlib.sha256(nonce).hexdigest()
