"""SQLAlchemy async engine, session factory and declarative Base.

Lifted from LawDocs `app/core/database.py` and trimmed: same async pattern, but
the default URL is SQLite (aiosqlite) per the Phase-3 brief (dev/tests). The
engine is created lazily from `settings.DATABASE_URL`, so tests can point it at
an isolated SQLite file before the app imports anything domain-specific.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# `pool_pre_ping` is a no-op for SQLite but harmless and correct for a future
# server-grade DB. `echo` is OFF unless explicitly opted in via SQL_ECHO — it was
# previously tied to APP_ENV, whose default is "development", so a default run
# logged every SQL statement WITH bound parameters (public keys, wrapped private
# keys, snapshot blob bytes) to stdout. Never key it on the environment name.
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "").lower() in ("1", "true", "yes"),
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base for every ORM model in the sync server."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
