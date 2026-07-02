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

## Food-parse proxy (`server/`)

A small stateless service: it identifies a food from a photo, text, or voice note with an LLM via
**OpenRouter** (identification only), then resolves nutrition numbers from authoritative tables (USDA FoodData Central for the US;
a regional table for RU, plus OpenFoodFacts) with an optional paid API-Ninjas fallback. **API keys
live only on the server and are never bundled into the app.**

```bash
cd server
npm install
cp .env.example .env        # set OPENROUTER_API_KEY (required), USDA_API_KEY for nutrition numbers
npm run dev                 # tsx watch on :8787   (prod: npm run build && npm start)
npm test                    # node:test
```

Key env (`server/.env.example`): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default
`google/gemini-3.5-flash`), `USDA_API_KEY`, `DEFAULT_REGION` (US|RU), `PORT` (default **8787**),
optional `APP_TOKEN`, `ALLOWED_ORIGIN`. The app points at the proxy via the
`EXPO_PUBLIC_FOOD_API_URL` env var.

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
is stateless and identity-free. Legal text canon lives in `legal/`; the public pages are hosted at
`family-pie.ru/driftora/legal`.

---
Planning, briefs and decisions live in the Obsidian vault: `../obsidian-vault/Driftora/`.
Claude Code: read `CLAUDE.md` first.
