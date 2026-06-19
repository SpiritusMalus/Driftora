"""Snapshot storage — upsert (last-writer-wins) + fetch. Newly written.

E2E INVARIANT enforced here: the blob is handled ONLY as opaque bytes. We base64
-decode the transport wrapper to get the raw ciphertext bytes and store them
verbatim in `Snapshot.blob`; on read we base64-encode the same bytes back. The
server NEVER decrypts, parses, or transforms the ciphertext — there is no key on
the server able to do so. `decode/encode` here is transport framing (base64 in
JSON), not decryption.

Last-writer-wins: one row per account. A `PUT` whose `updated_at` is newer than
(or equal to) the stored snapshot replaces it; a strictly older upload is
ignored (the stored, newer snapshot is kept). Equal timestamps replace so a
re-push of the same moment is not rejected.
"""

from __future__ import annotations

import base64
import logging
from datetime import timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.snapshot import Snapshot
from app.schemas.sync import (
    SnapshotDownloadResponse,
    SnapshotMetaResponse,
    SnapshotUploadRequest,
    SnapshotUploadResponse,
)

logger = logging.getLogger(__name__)


def _as_utc(dt):
    """Normalizes a (possibly naive, SQLite-roundtripped) datetime to aware UTC so
    last-writer-wins comparisons never raise on naive-vs-aware."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def upsert_snapshot(
    account_id: str, body: SnapshotUploadRequest, db: AsyncSession
) -> SnapshotUploadResponse:
    """Stores the latest snapshot for an account (last-writer-wins by updated_at).

    The blob is decoded from base64 to raw ciphertext bytes and stored as-is — the
    server treats it as an opaque payload. A malformed base64 wrapper is a 400
    (transport error), NOT a decrypt attempt.
    """
    try:
        raw = base64.b64decode(body.blob, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="blob is not valid base64",
        ) from exc

    new_updated = _as_utc(body.updated_at)

    result = await db.execute(select(Snapshot).where(Snapshot.account_id == account_id))
    existing = result.scalar_one_or_none()

    if existing is None:
        snapshot = Snapshot(
            account_id=account_id,
            blob=raw,
            updated_at=new_updated,
            size=body.size,
            device_id=body.device_id,
        )
        db.add(snapshot)
        stored = snapshot
    elif new_updated >= _as_utc(existing.updated_at):
        # Newer (or same-moment) upload wins — replace verbatim.
        existing.blob = raw
        existing.updated_at = new_updated
        existing.size = body.size
        existing.device_id = body.device_id
        stored = existing
    else:
        # Stored snapshot is newer — keep it, ignore this stale push (still 200 so
        # the client can treat the push as accepted/converged).
        stored = existing

    await db.commit()
    await db.refresh(stored)

    logger.info(
        "snapshot_upserted",
        extra={"action": "upsert_snapshot", "account_id": account_id, "size": stored.size},
    )
    return SnapshotUploadResponse(
        status="ok",
        meta=SnapshotMetaResponse(
            updated_at=stored.updated_at, size=stored.size, device_id=stored.device_id
        ),
    )


async def get_snapshot(account_id: str, db: AsyncSession) -> SnapshotDownloadResponse:
    """Returns the latest stored snapshot for an account, base64-encoded.

    The returned blob is byte-identical to what was uploaded — the server only
    re-applies the base64 transport framing. 404 when the account has no snapshot.
    """
    result = await db.execute(select(Snapshot).where(Snapshot.account_id == account_id))
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No snapshot")

    return SnapshotDownloadResponse(
        blob=base64.b64encode(snapshot.blob).decode(),
        updated_at=_as_utc(snapshot.updated_at),
        size=snapshot.size,
        device_id=snapshot.device_id,
    )
