"""Shared test fixtures — SQLite test DB + ASGI client.

Mirrors the LawDocs `tests/conftest.py` pattern (set env before importing the app,
create the schema once, override get_db, ASGI httpx client), but swaps Postgres
testcontainers for an on-disk SQLite file per the Phase-3 brief. A file (not
`:memory:`) is used so the same database is visible across the multiple async
connections a single test opens.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio

# Env must be set BEFORE importing the app — settings/engine read DATABASE_URL and
# SECRET_KEY at import time.
_DB_DIR = Path(tempfile.mkdtemp(prefix="hr_sync_test_"))
_DB_PATH = _DB_DIR / "test.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_PATH}"
os.environ["SECRET_KEY"] = "test-secret-" + "a" * 48
os.environ["APP_ENV"] = "test"

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import AsyncSessionLocal, Base, engine, get_db  # noqa: E402
from app.main import app  # noqa: E402

# Import models so they register on Base.metadata before create_all.
from app.models.account import Account  # noqa: E402,F401
from app.models.auth_challenge import AuthChallenge  # noqa: E402,F401
from app.models.snapshot import Snapshot  # noqa: E402,F401

# Tables we wipe between tests to keep them isolated (children before parents).
_CLEAN_ORDER = ["snapshots", "auth_challenges", "accounts"]


@pytest_asyncio.fixture(autouse=True)
async def _schema() -> AsyncGenerator[None, None]:
    """Create the schema before each test and clean rows after, so every test runs
    against a fresh, isolated database."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        for table in _CLEAN_ORDER:
            await conn.execute(text(f'DELETE FROM "{table}"'))


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """ASGI httpx client. Uses the same session factory as the app (no override
    needed — both point at the one SQLite test file), so writes a request makes are
    visible to `db_session` and vice versa."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with AsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)
