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
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
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

    # Atomic last-writer-wins. A single INSERT ... ON CONFLICT DO UPDATE replaces
    # the previous SELECT-then-write, which had a read-modify-write race: two
    # devices pushing at once could let a strictly-older snapshot overwrite a newer
    # one, or both take the INSERT branch and collide on the unique account_id
    # (IntegrityError → 500). The conditional WHERE keeps the invariant "a strictly
    # older snapshot never wins"; a stale push becomes a no-op (the stored, newer
    # row is kept). `size` is taken from the actual decoded bytes, never the
    # client-asserted value.
    stmt = sqlite_insert(Snapshot).values(
        account_id=account_id,
        blob=raw,
        updated_at=new_updated,
        size=len(raw),
        device_id=body.device_id,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Snapshot.account_id],
        set_={
            "blob": stmt.excluded.blob,
            "updated_at": stmt.excluded.updated_at,
            "size": stmt.excluded.size,
            "device_id": stmt.excluded.device_id,
        },
        where=stmt.excluded.updated_at >= Snapshot.updated_at,
    )
    await db.execute(stmt)
    await db.commit()

    # Read back the authoritative row (this push, or a newer one that legitimately
    # won the conditional update).
    result = await db.execute(select(Snapshot).where(Snapshot.account_id == account_id))
    stored = result.scalar_one()

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
