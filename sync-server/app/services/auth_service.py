"""Account registration + passwordless login-by-key.

The key-challenge / key-login logic is lifted from LawDocs
`app/services/auth_service.py` (`issue_key_challenge` + `key_login`) and trimmed
to the sync account: no orders, no magic-link, no keyring-under-password. Account
registration replaces LawDocs `setup_e2ee`, storing only the public key (+ an
OPTIONAL, OPAQUE wrapped private key).

How login-by-key works (proves possession of the private key, issues a session):
  1. Client calls GET /v1/auth/challenge?public_key=... → server generates a
     random nonce, encrypts it TO that public key (anonymous box) and stores only
     the nonce's SHA-256 hash + a 120s TTL. The encrypted nonce goes to the client.
  2. Only the holder of the matching PRIVATE key can decrypt the nonce
     (client `e2ee.solveChallenge`). It returns the plaintext nonce (base64).
  3. Server re-hashes the returned nonce, compares to the stored hash, marks the
     challenge used (single-use), finds the account by public key, and issues a
     session JWT. The private key never leaves the device; the server holds no key
     able to decrypt the snapshot the session then syncs.
"""

from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.e2ee_box import encrypt_for_public_key
from app.core.security import create_access_token, hash_challenge_nonce
from app.models.account import Account
from app.models.auth_challenge import AuthChallenge
from app.schemas.sync import (
    AccountCreateRequest,
    AccountCreateResponse,
    KeyChallengeResponse,
    KeyLoginResponse,
)

logger = logging.getLogger(__name__)

# Short-lived challenge: long enough to decrypt on-device, too short for an
# offline brute force / replay window. Single-use is enforced via used_at.
_KEY_CHALLENGE_TTL_SECONDS = 120
_CHALLENGE_NONCE_LEN = 32


async def register_account(body: AccountCreateRequest, db: AsyncSession) -> AccountCreateResponse:
    """Registers (or idempotently re-affirms) an account by its public key.

    Re-registering the same public key updates the OPAQUE wrapped key / label
    rather than erroring, so a client that re-runs setup isn't blocked. The public
    key must be valid base64 of a 32-byte X25519 key (checked by encrypting a probe
    to it) — a malformed key is a 400 before anything is stored.
    """
    # Validate the public key shape by attempting an encryption to it. Cheap, and
    # rejects garbage before we persist an unusable account.
    try:
        encrypt_for_public_key(b"probe", body.public_key)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid public key",
        ) from exc

    result = await db.execute(select(Account).where(Account.public_key == body.public_key))
    account = result.scalar_one_or_none()
    if account is None:
        account = Account(
            public_key=body.public_key,
            wrapped_private_key=body.wrapped_private_key,
            label=body.label,
        )
        db.add(account)
    else:
        # Idempotent re-register: refresh the opaque wrapped key / label if given.
        if body.wrapped_private_key is not None:
            account.wrapped_private_key = body.wrapped_private_key
        if body.label is not None:
            account.label = body.label

    await db.commit()
    await db.refresh(account)

    logger.info("account_registered", extra={"action": "register_account", "account_id": account.id})
    return AccountCreateResponse(account_id=account.id, public_key=account.public_key)


async def issue_key_challenge(public_key: str, db: AsyncSession) -> KeyChallengeResponse:
    """Issues a challenge: a random nonce encrypted to `public_key`.

    The challenge is issued ALWAYS (even with no account under this key) so the
    response can't be used to enumerate accounts — existence is only revealed by a
    generic 401 on login.
    """
    try:
        nonce = os.urandom(_CHALLENGE_NONCE_LEN)
        encrypted_challenge = encrypt_for_public_key(nonce, public_key)
    except Exception as exc:
        # Malformed/invalid public key — a 400, not our error.
        logger.warning("key_challenge_bad_pubkey", extra={"action": "key_challenge"})
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid public key",
        ) from exc

    challenge = AuthChallenge(
        public_key=public_key,
        nonce_hash=hash_challenge_nonce(nonce),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=_KEY_CHALLENGE_TTL_SECONDS),
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)

    logger.info("key_challenge_issued", extra={"action": "key_challenge", "challenge_id": challenge.id})
    return KeyChallengeResponse(challenge_id=challenge.id, encrypted_challenge=encrypted_challenge)


async def key_login(challenge_id: str, nonce_b64: str, db: AsyncSession) -> KeyLoginResponse:
    """Verifies a solved challenge and issues a session token for the account.

    Single-use: on a correct solve the challenge is burned (even if no account
    exists under the key). A missing account, a wrong nonce, an expired or reused
    challenge are all indistinguishable to the client — a generic 401.
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not log in by key"
    )

    result = await db.execute(select(AuthChallenge).where(AuthChallenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None or challenge.used_at is not None:
        raise invalid

    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise invalid

    try:
        presented = base64.b64decode(nonce_b64, validate=True)
    except Exception as exc:
        raise invalid from exc
    if hash_challenge_nonce(presented) != challenge.nonce_hash:
        raise invalid

    # Correct solve — burn the challenge (even if the account doesn't exist).
    challenge.used_at = datetime.now(timezone.utc)

    account_result = await db.execute(
        select(Account).where(Account.public_key == challenge.public_key)
    )
    account = account_result.scalars().first()
    if account is None:
        await db.commit()
        logger.warning("key_login_no_account", extra={"action": "key_login"})
        raise invalid

    await db.commit()
    logger.info("key_login_success", extra={"action": "key_login", "account_id": account.id})

    access_token = create_access_token(account.id)
    return KeyLoginResponse(access_token=access_token, account_id=account.id)
