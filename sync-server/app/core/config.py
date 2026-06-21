"""Runtime configuration for the HealthRoutine E2E sync server.

Settings are read from the environment (12-factor); a `.env` file is loaded for
local dev via pydantic-settings. SQLite is the default for dev/tests — see
`DATABASE_URL`. NOTHING here is an encryption secret for user data: `SECRET_KEY`
only signs the SESSION token (account auth), which is SEPARATE from the E2E key
that protects the snapshots. The server holds no key able to read a snapshot.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

# The insecure dev default for SECRET_KEY. Defined as a constant so the startup
# guard below can reject it outright in a production deployment.
_INSECURE_SECRET_KEY = "dev-insecure-change-me-in-production-please-0000000000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Async SQLAlchemy URL. SQLite (aiosqlite) is the dev/test default; production
    # is an OWNER decision (Postgres etc.) gated by the §G hosting/legal review.
    DATABASE_URL: str = "sqlite+aiosqlite:///./sync_dev.db"

    # HS256 secret for the SESSION JWT (account auth only — NOT a data key).
    # Must be overridden in any real deployment (enforced below for production).
    SECRET_KEY: str = _INSECURE_SECRET_KEY

    # Session token lifetime. A device re-proves key possession after this.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    APP_ENV: str = "development"

    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() in {"production", "prod"}


settings = Settings()

# Fail closed: a production deployment MUST override the session secret with a
# strong value. Leaving the public dev default in place would let anyone forge a
# session JWT for any account (and read/overwrite that account's — still
# encrypted — snapshot). Dev/test keep the convenient default.
if settings.is_production() and (
    settings.SECRET_KEY == _INSECURE_SECRET_KEY or len(settings.SECRET_KEY) < 32
):
    raise RuntimeError(
        "SECRET_KEY must be set to a strong (>=32 char) value when APP_ENV is "
        "production — refusing to start with the insecure default."
    )
