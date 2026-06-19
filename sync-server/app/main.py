"""FastAPI application factory + entrypoint for the HealthRoutine E2E sync server.

Run locally:
    uvicorn app.main:app --reload

On startup (dev convenience) the tables are created from the ORM metadata if they
don't exist — fine for SQLite dev. A real deployment would use migrations instead
(an OWNER decision, §G). Tests create the schema themselves (see tests/conftest.py)
and do NOT rely on this hook.

The models are imported below purely to register them with `Base.metadata` before
`create_all` runs.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.core.database import Base, engine

# Import models so they're registered on Base.metadata (needed for create_all).
from app.models.account import Account  # noqa: F401
from app.models.auth_challenge import AuthChallenge  # noqa: F401
from app.models.snapshot import Snapshot  # noqa: F401


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Dev convenience: ensure tables exist. Production uses migrations (§G).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="HealthRoutine E2E Sync",
    version="1.0.0",
    description=(
        "Thin end-to-end-encrypted sync. Stores only ciphertext, wrapped keys and "
        "metadata; it cannot decrypt user data."
    ),
    lifespan=lifespan,
)

app.include_router(router)
