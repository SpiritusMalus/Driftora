# Driftora

Local-first personal health app that pairs **Body** (nutrition, weight, food-photo logging) and
**Mind** (mood, diary, wins) in one place. Built with Expo / React Native / TypeScript; all data
lives on-device in encrypted SQLite, with optional end-to-end-encrypted backup to your own cloud.

This is a small monorepo with three parts:

| Part | What | Stack | Deployed? |
|---|---|---|---|
| root | the mobile app | Expo SDK 54 · RN 0.81.5 · React 19.1 · TypeScript · expo-router | ships to stores |
| `server/` | food-parse proxy | Node · Express · TypeScript | yes (VPS, `:8787`) |
| `sync-server/` | E2E backup/sync API | Python · FastAPI · SQLAlchemy (async) | **no — dev only** |

## Repository layout

```
app/                expo-router screens (diary, food, mood, weight, wins, review, settings, more)
lib/                core logic (insights, services), i18n, legal, theme
components/          shared UI
modules/            local native module(s) — platform-key-store
drizzle/            Drizzle schema + migrations  (drizzle.config.ts)
assets/             fonts, images
android/            prebuilt native Android project
legal/              legal text canon (PRIVACY_POLICY.md, TERMS_OF_USE.md)
                    (public page hosted centrally at family-pie.ru/driftora/legal)
server/             food-parse proxy (LLM identify via OpenRouter + nutrition numbers)
sync-server/        FastAPI E2E backup/sync (dev only, not deployed)
```

## The app

### Requirements
- Node 18+ and the Expo toolchain (`npx expo`).
- A **custom dev client** — this app uses native modules (op-sqlite, secure-store, local-auth,
  speech-recognition), so **Expo Go will not run it**.
- Android Studio / Xcode for local native builds, or an Expo (EAS) account for cloud builds.

### Run (development)
```bash
npm install
# build & install a dev client once (cloud build):
npx eas build --profile development        # or: npx expo run:android  (local)
npm start                                  # start Metro, open in the dev client
```

Other scripts:
```bash
npm run android   # start + open Android
npm run ios       # start + open iOS
npm run web       # web target
npm test          # jest
npm run typecheck # tsc --noEmit
npm run db:generate  # regenerate Drizzle artifacts after a schema change
```

Metro runs on **:8081** (the Expo SDK 54 default).

### CI

`.github/workflows/ci.yml` runs on every push and pull request: typecheck plus tests for the app
(jest) and for `server/` (`node --test`), and a `server/` build. `uptime.yml` probes the production
`/health` every ~15 min and `slo.yml` checks the production `/metrics` against the thresholds in
`docs/operations.md` hourly; `android-apk.yml` builds a preview APK on demand.

## Food-parse proxy (`server/`)

A small service: it identifies a food from a photo, text, or voice note with an LLM via
**OpenRouter** (identification only), then resolves nutrition numbers from authoritative tables (USDA FoodData Central for the US;
a regional table for RU, plus OpenFoodFacts) with an optional paid API-Ninjas fallback. **API keys
live only on the server and are never bundled into the app.**

The one thing it stores is the **shared food base** (`COMMUNITY_FOODS_PATH`, off unless set): the
local dishes no composition table carries — шаурма, хачапури, домашние сырники — contributed by
people who typed the numbers themselves, served back as the median of every confirmation and
labeled `community` so a crowd figure never reads as a measurement. A row is a food name, a region
and per-100 g macros; no install id, address or time is written, so it cannot be traced back to
whoever contributed it. Sharing is opt-in in the app (Settings → «Делиться блюдами с общей базой»,
default off); searching the base is not.

```bash
cd server
npm install
cp .env.example .env        # set OPENROUTER_API_KEY (required), USDA_API_KEY for nutrition numbers
npm run dev                 # tsx watch on :8787   (prod: npm run build && npm start)
npm test                    # node:test
npm run typecheck           # tsc over src/, eval/ and scripts/
npm run eval                # measure the parse chain against server/eval/cases.json
```

Or run it as a container — a reproducible build instead of «compile on the VPS and rsync `dist/`»:

```bash
cd server
docker compose up --build -d   # reads secrets from a local .env, publishes 127.0.0.1:8787
curl localhost:8787/health
```

`server/openapi.yaml` is the contract between the app and this service;
`test/openapiContract.test.ts` fails if a route is added, renamed or removed without it.
`server/eval/` measures what the parse chain actually returns — see its README for what the
numbers do and don't mean. Operating it (SLOs, alerts, runbook, rollback) is `docs/operations.md`.

Key env (`server/.env.example`): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default
`google/gemini-3.5-flash`), `USDA_API_KEY`, `DEFAULT_REGION` (US|RU), `PORT` (default **8787**),
optional `APP_TOKEN`, `ALLOWED_ORIGIN`, `COMMUNITY_FOODS_PATH` (shared food base; off when unset). The app points at the proxy via the
`EXPO_PUBLIC_FOOD_API_URL` env var; when the server enforces `APP_TOKEN`, the app sends it from
`EXPO_PUBLIC_FOOD_API_TOKEN` as a Bearer header — set it in a local `.env` (dev) and in EAS
environment variables (cloud builds), never in `eas.json`: this repo is public.

## Sync server (`sync-server/`) — dev only

FastAPI service for **end-to-end-encrypted** backup/restore: the device holds the keys
(key-challenge auth, PyNaCl), so the server stores ciphertext it cannot read. **Not deployed** —
SQLite via aiosqlite for local dev/tests; a production datastore is an owner decision.

```bash
cd sync-server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload        # defaults to :8000
pytest
```

> Note: the sync server (`:8000`) and Metro (`:8081`) collide with the `relo_dojo` backend/Metro if
> both projects run at once — start the second on another port (`uvicorn --port 8001`, `expo start --port 8082`).

## Privacy & architecture

Local-first: your data stays on the device in encrypted SQLite (SQLCipher). The optional cloud
backup is **end-to-end encrypted** (TweetNaCl / X25519) to a destination you control; the food proxy
is identity-free — it keeps no request logs and mints no user records, and the one thing it does
store (the shared food base above) holds foods rather than people. Legal text canon lives in
`legal/`; the public pages are hosted at `family-pie.ru/driftora/legal`.

---
Planning, briefs and decisions live in the Obsidian vault: `../obsidian-vault/Driftora/`.
Claude Code: read `CLAUDE.md` first.
