# HealthRoutine

A personal, **local-first** cross-platform (iOS + Android) app that automates a
health routine and celebrates progress. One user, privacy by default: health and
therapy data stay on-device in an **encrypted** database; the only external
network call is short food strings sent to an LLM for macro parsing.

Three thin features + a home dashboard:

1. **Food log (voice-first)** — dictate/type what you ate in Russian → LLM parses
   it into items with kcal + БЖУ → confirm/edit → save → today's totals vs targets.
2. **Steps + meaning** — read daily steps from the OS health store and show one
   honest, sourced sentence about what the count means (no "10,000 steps" myth).
3. **СМЭР diary (CBT)** — structured thought records (Ситуация → Мысли → Эмоции →
   Реакция → Доводы за/против → Сбалансированный пересмотр).

Plus a win log, gentle local reminders, and a home dashboard. UI is **Russian by
default**.

## Stack

**Expo (SDK 56) / React Native / TypeScript** · **Expo Router** (file-based) ·
**Drizzle ORM + op-sqlite (SQLCipher)** encrypted at rest, key in
`expo-secure-store` · `react-native-health` / `react-native-health-connect`
(steps) · `@react-native-voice/voice` (ru-RU STT) · `expo-notifications` ·
**i18next** (ru default) · Anthropic Claude for food parsing.

## Status — M1 (food log, offline stub) ✅

- **M0:** encrypted DB schema + all tables, Russian Home dashboard, calm theme.
- **M1:** text → **offline stub parser** → editable БЖУ confirm sheet → save →
  Home shows today's totals vs targets. The real Anthropic parser
  (`claude-haiku-4-5`, tool use / structured output) is interface-ready but
  **not wired** — live LLM calls are intentionally off for now.

`tsc` clean · `expo-doctor` 21/21 · 14 Jest tests green · Metro bundle builds.
Next: voice input, then M2 (steps) → M3 (diary) → M4 (wins/reminders).

## Setup & run

Requires Node ≥ 20 (built with Node 26) and the Expo CLI (via `npx`).

```bash
npm install
npm run typecheck      # tsc --noEmit
npm test               # jest (logic + DB via better-sqlite3)
```

The food-parsing API key is **never committed** — read at runtime from an env
var (wired in M1), e.g. via `app.config` + `expo-constants` or EAS secrets.

### Running on a device

The app uses native modules (op-sqlite/SQLCipher, HealthKit/Health Connect,
voice) that are **not in Expo Go**, so you need a **dev build**:

- **Local:** `npx expo run:ios` / `npx expo run:android` — needs Xcode + CocoaPods
  (iOS) or the Android SDK. `npx expo-doctor` reports what's missing.
- **Cloud (no local Xcode):** `eas build --profile development` builds in the
  cloud; install the resulting dev build on your phone.

> The encrypted on-device DB path (`lib/core/db/client.ts`) is wired per current
> op-sqlite/SQLCipher docs but **not yet verified on a real device** — validate on
> the first dev build. Host tests exercise the schema via better-sqlite3.

## Layout

```
app/                 Expo Router routes
  _layout.tsx        root: i18n, theme, DatabaseProvider
  index.tsx          Home dashboard (today's macro totals vs targets)
  food/log.tsx       text → stub parse → editable БЖУ → save
components/          shared UI (SectionCard)
lib/
  core/
    db/              drizzle schema, encrypted op-sqlite client, key store,
                     DatabaseProvider, settings + food queries
    services/        food parser (interface + offline stub); health, speech,
                     notifications (interfaces)
    insights/        honest steps→meaning rules (sourced)
  i18n/              i18next setup + ru/en locales
  theme/             calm color palette
__tests__/           stepInsight, db, stubFoodParser, food (better-sqlite3)
```
