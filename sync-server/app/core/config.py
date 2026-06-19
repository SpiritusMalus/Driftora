"""Runtime configuration for the HealthRoutine E2E sync server.

Settings are read from the environment (12-factor); a `.env` file is loaded for
local dev via pydantic-settings. SQLite is the default for dev/tests — see
`DATABASE_URL`. NOTHING here is an encryption secret for user data: `SECRET_KEY`
only signs the SESSION token (account auth), which is SEPARATE from the E2E key
that protects the snapshots. The server holds no key able to read a snapshot.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Async SQLAlchemy URL. SQLite (aiosqlite) is the dev/test default; production
    # is an OWNER decision (Postgres etc.) gated by the §G hosting/legal review.
    DATABASE_URL: str = "sqlite+aiosqlite:///./sync_dev.db"

    # HS256 secret for the SESSION JWT (account auth only — NOT a data key).
    # Must be overridden in any real deployment.
    SECRET_KEY: str = "dev-insecure-change-me-in-production-please-0000000000"

    # Session token lifetime. A device re-proves key possession after this.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    APP_ENV: str = "development"


settings = Settings()
