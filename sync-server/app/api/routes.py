"""HTTP surface for the E2E sync server.

Endpoints (all under /v1 except /health):
  POST /v1/account           — register: store the public key (+ optional opaque
                               wrapped private key). No password.
  GET  /v1/auth/challenge     — passwordless key-challenge (issues an encrypted nonce)
  POST /v1/auth/login         — passwordless key-login (verifies the solved nonce)
  PUT  /v1/sync/snapshot      — upload the opaque encrypted snapshot + metadata (auth)
  GET  /v1/sync/snapshot      — fetch the latest snapshot + metadata (auth)
  GET  /health                — liveness

The challenge uses GET-with-query (per the brief), the rest take JSON bodies. The
snapshot endpoints require a valid session (Depends(get_current_account)); the
account they read/write is derived from the token, never from the request body.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_account
from app.core.database import get_db
from app.models.account import Account
from app.schemas.sync import (
    AccountCreateRequest,
    AccountCreateResponse,
    KeyChallengeResponse,
    KeyLoginRequest,
    KeyLoginResponse,
    SnapshotDownloadResponse,
    SnapshotUploadRequest,
    SnapshotUploadResponse,
)
from app.services import auth_service, sync_service

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Account + passwordless key-login ─────────────────────────────────────────


@router.post("/v1/account", response_model=AccountCreateResponse)
async def register_account(
    body: AccountCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> AccountCreateResponse:
    return await auth_service.register_account(body, db)


@router.get("/v1/auth/challenge", response_model=KeyChallengeResponse)
async def auth_challenge(
    public_key: str,
    db: AsyncSession = Depends(get_db),
) -> KeyChallengeResponse:
    """Issues a key-challenge for `public_key` (query param). Always succeeds for a
    well-formed key (no account enumeration); a malformed key is a 400."""
    return await auth_service.issue_key_challenge(public_key, db)


@router.post("/v1/auth/login", response_model=KeyLoginResponse)
async def auth_login(
    body: KeyLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> KeyLoginResponse:
    return await auth_service.key_login(body.challenge_id, body.nonce, db)


# ── Encrypted snapshot sync (auth required) ──────────────────────────────────


@router.put("/v1/sync/snapshot", response_model=SnapshotUploadResponse)
async def put_snapshot(
    body: SnapshotUploadRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
) -> SnapshotUploadResponse:
    """Uploads the opaque encrypted snapshot for the authenticated account
    (last-writer-wins). The blob is stored verbatim — never decrypted."""
    return await sync_service.upsert_snapshot(account.id, body, db)


@router.get(
    "/v1/sync/snapshot",
    response_model=SnapshotDownloadResponse,
    responses={status.HTTP_404_NOT_FOUND: {"description": "No snapshot for this account"}},
)
async def get_snapshot(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
) -> SnapshotDownloadResponse:
    """Returns the latest snapshot for the authenticated account, byte-identical to
    what was uploaded, or 404 if none exists."""
    return await sync_service.get_snapshot(account.id, db)
