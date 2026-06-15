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

Flutter (stable) · Riverpod · go_router · **Drift (SQLite) + SQLCipher** (encrypted,
key in `flutter_secure_storage`) · `health` (HealthKit / Health Connect) ·
`speech_to_text` (ru-RU) · `flutter_local_notifications` · `fl_chart` · Anthropic
Claude for food parsing.

## Status — M0 (scaffold) ✅

App boots to an empty Russian Home dashboard; encrypted DB schema + all tables in
place; `flutter analyze` clean; tests green. Features land in M1–M4 (food → steps →
diary → wins/reminders).

## Setup & run

Requires the Flutter SDK (this repo was built with Flutter 3.44 / Dart 3.12).

```bash
flutter pub get
flutter gen-l10n                                            # ru/en localizations
dart run build_runner build --delete-conflicting-outputs   # drift code
flutter analyze
flutter test
```

The LLM API key is **never committed**. It's read from `--dart-define` at run time
(wired up in M1):

```bash
flutter run --dart-define=ANTHROPIC_API_KEY=sk-ant-...
```

### Toolchain notes

- **Encryption:** SQLCipher is provided by the `sqlite3` v3 build hook in
  `pubspec.yaml` (`hooks: user_defines: sqlite3: source: sqlcipher`). The old
  `sqlcipher_flutter_libs` package is discontinued (now a no-op). The encrypted
  on-device open lives in `lib/core/db/connection.dart` and is **not yet verified
  on a real device** — validate it on the first iOS/Android build.
- **To build on a device** you still need: iOS → full Xcode + CocoaPods
  (`sudo gem install cocoapods`); Android → the Android SDK (Android Studio).
  `flutter doctor` lists what's missing. Unit/widget tests run without either.

## Layout

```
lib/
  app/       theme, go_router, root app (ru l10n)
  core/
    db/       drift schema, encrypted connection, key store, provider
    services/ health, speech, llm food parser, notifications (interfaces)
    insights/ honest steps→meaning rules (sourced)
  features/   food · activity · diary · wins · home · settings
  shared/     reusable widgets
  l10n/       app_ru.arb (template) · app_en.arb
test/         unit (insights, db) + widget (home) tests
```
