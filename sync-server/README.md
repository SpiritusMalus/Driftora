# Driftora E2E Sync Server

> ## ⚠️ DEPRECATED — off the product path (ADR-2026-06-23)
>
> This operator server is **no longer the way Driftora syncs.** Per
> **ADR-2026-06-23 (platform-native E2E sync)**, multi-device sync now rides the
> **user's own platform account** — **CloudKit** (iOS) and the **Google Drive App
> Data folder** (Android) — so there is **no operator server on the product path**.
> Its only unique value was cross-ecosystem sync, which is now out of scope
> (recovery phrase covers that rare case).
>
> **Why it stays in the repo:** reference + a **developer-only fallback**. The
> client reaches it only through `serverDataSyncProvider` (default **OFF**;
> `getDataSyncProvider` selects it only when explicitly allowed → **never in
> production**). It is **un-deployable by intent**: nothing wires it into EAS,
> `app.json`, CI, or any container/systemd unit. **Do NOT deploy it** and do not
> add deploy wiring. Dropping the operator server also removes the РКН/152-ФЗ
> "health data on our server, even as ciphertext" question entirely.
>
> Code + tests are kept (not deleted) so the E2E challenge-auth design remains
> documented. Everything below describes that retained dev-only implementation.

A thin, **end-to-end-encrypted** sync service for Driftora. It lets a user
push an **encrypted full-DB snapshot** from one device and pull it on another,
authenticated by **proving possession of their E2E private key** (no password as
the encryption secret). Last-writer-wins by `updated_at`.

> **Status: deprecated; code + tests only.** Not deployed, not a production
> service, and not intended to be — see the deprecation banner above. SQLite is
> **dev/test only**.

## The non-negotiable invariant

The server stores and returns **only ciphertext + wrapped keys + metadata**. It is
**incapable of decrypting** user data:

- The snapshot `blob` is the client's `buildBackupFile` output — ciphertext sealed
  to the user's master **public** key. The server stores the raw bytes verbatim and
  echoes them byte-for-byte. It never decodes their meaning.
- An account is identified by its X25519 **public** key. The optional
  `wrapped_private_key` is encrypted **on the client** (under the recovery phrase)
  and is opaque to the server.
- **Account login is separate from the encryption key.** Login proves you hold the
  private key (challenge-response); the resulting session token cannot decrypt
  anything.
- There is **no private key on the server** and **no decrypt code path** (asserted
  by `tests/test_e2e_invariant.py`).

## Lifted from LawDocs vs. new

- **Lifted** (the LawDocs FastAPI E2E backend, trimmed of all legal-docs/order code):
  the **key-challenge / key-login** passwordless flow (`app/services/auth_service.py`,
  the `AuthChallenge` model), the `encrypt_for_public_key` box helper
  (`app/core/e2ee_box.py`, from `e2ee_file.py`), the JWT/nonce-hash security helpers
  (`app/core/security.py`), the async SQLAlchemy `Base`/session (`app/core/database.py`),
  and the test patterns (`tests/`).
- **New**: the `Account` model (collapses LawDocs `User`+`UserKey`), the `Snapshot`
  model + `app/services/sync_service.py` (opaque blob, last-writer-wins), the
  `/v1/sync/snapshot` surface, and a **SQLite** test harness (LawDocs used Postgres
  testcontainers).

## API

| Method | Path                  | Auth | Purpose                                                        |
| ------ | --------------------- | ---- | ------------------------------------------------------------- |
| POST   | `/v1/account`         | no   | Register: store the public key (+ optional opaque wrapped key) |
| GET    | `/v1/auth/challenge`  | no   | Key-challenge: returns a nonce encrypted to `?public_key=`     |
| POST   | `/v1/auth/login`      | no   | Key-login: verify the decrypted nonce, issue a session token   |
| PUT    | `/v1/sync/snapshot`   | yes  | Upload the opaque encrypted blob + metadata (last-writer-wins) |
| GET    | `/v1/sync/snapshot`   | yes  | Return the latest blob + metadata (byte-identical), or 404     |
| GET    | `/health`             | no   | Liveness                                                       |

### Key-challenge / key-login flow

1. `GET /v1/auth/challenge?public_key=<b64>` → the server makes a random nonce,
   encrypts it to that public key (anonymous box), stores only its SHA-256 hash +
   a 120 s TTL, and returns the encrypted nonce. (Issued even with no account, so
   the response can't enumerate accounts.)
2. The client decrypts the nonce with its **private** key (`e2ee.solveChallenge`)
   and returns the plaintext nonce (base64).
3. `POST /v1/auth/login` → the server re-hashes the nonce, compares, burns the
   challenge (single-use), finds the account by public key, and issues a session
   JWT. The private key never leaves the device.

## Run locally

```bash
cd sync-server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# OpenAPI docs at http://127.0.0.1:8000/docs
```

### Environment

| Var                           | Default                              | Notes                                            |
| ----------------------------- | ------------------------------------ | ------------------------------------------------ |
| `DATABASE_URL`                | `sqlite+aiosqlite:///./sync_dev.db`  | **SQLite is dev-only.** Use a server DB for prod. |
| `SECRET_KEY`                  | insecure dev default                 | HS256 secret for the **session** token only (NOT a data key). Override in any deployment. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 days)                     | Session lifetime.                                |
| `APP_ENV`                     | `development`                        | `development` turns on SQL echo.                 |

On startup the tables are auto-created (dev convenience). Production should use
real migrations instead.

## Tests

```bash
cd sync-server
pip install -r requirements.txt
python -m pytest -q
```

Coverage: `test_auth.py` (login-by-key: valid key logs in, wrong key fails, replay
/expiry, no-account 401, key-not-password), `test_snapshot.py` (byte-identical
opaque round-trip, last-writer-wins both directions, auth required, 404,
push→pull across devices), `test_e2e_invariant.py` (no decrypt code path, no
server-side private key, no plaintext leak, a real sealed blob is server-inaccessible).

## Before go-live (OWNER + lawyer — NOT in this codebase)

> **Superseded by ADR-2026-06-23 — retained for reference only.** The decision is
> **not to deploy this server**; the checklist below is what *would* have been
> required and is kept to document the trade-off, not as a live plan.

1. **Pick a host & jurisdiction.** RU vs abroad has 152-ФЗ / РКН localization and
   trans-border implications **even though only ciphertext is stored** — confirm with
   the lawyer.
2. **Provision a real database** (SQLite here is dev/test only); add backups.
3. **TLS** in front of the service.
4. **152-ФЗ review** by the IT lawyer (special-category health data, even as ciphertext).
5. **Privacy Policy / store data-safety** update describing encrypted sync and that
   the server cannot read the data.
6. Rate limiting / abuse protection and a snapshot size cap for production.
