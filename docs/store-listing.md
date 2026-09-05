# Витрина Google Play / RuStore

Готовые материалы для консоли. Ассеты рядом: `docs/store/icon-512.png` (иконка
магазина), `docs/store/feature-graphic.png` (баннер 1024×500). Скриншоты
снимаются с эмулятора/устройства перед загрузкой (минимум 2, телефонные).

Имя приложения — от «drift», дрейф: к своей форме не маршируют, а дрейфуют —
маленькими шагами, по течению, без насилия над собой. Тексты держат этот тон:
никакого «сожги жир к лету», никаких обещаний.

---

## Короткое описание (до 80 знаков)

**RU:** Спокойный дневник еды и веса: дрейфуй к своей форме без строгих диет.

**EN:** A calm food and weight diary: drift toward your shape, no strict diets.

## Полное описание (до 4000 знаков)

**RU:**

Driftora — от слова drift, «дрейф». К своей форме можно не маршировать, а
дрейфовать: маленькими шагами, без подвигов, срывов и чувства вины. Приложение
для тех, кого выматывают строгие диеты и приложения-надзиратели.

Что умеет:

• Дневник еды без ручного ввода таблиц: напишите «борщ и два куска хлеба»,
скажите голосом или сфотографируйте тарелку — Driftora разберёт блюда, вес и
посчитает калории и БЖУ по проверенным базам продуктов (российская таблица,
USDA, Open Food Facts). Распознавание через ИИ включается только с вашего
явного согласия — и всегда можно ввести еду руками.

• Честные цифры. Все оценки помечены знаком «≈», у каждого продукта видно, из
какой базы взяты цифры, и всё можно поправить. Мы не делаем вид, что знаем вес
вашей порции точнее вас.

• Бюджет дня, который растёт от движения. База — ваш обмен в покое, а шаги и
тренировки добавляют калорий к еде прямо в течение дня. Больше двигаетесь —
больше едите, честная арифметика вместо наказаний.

• Расчёт нормы по науке: формулы Миффлина–Сан-Жеора и Катча–МакАрдла, учёт
состава тела по талии, а после пары недель дневника — ваш реальный расход,
измеренный по тренду веса и еде, без формул вовсе.

• Вес — трендом, а не паникой из-за каждого взвешивания. Настроение, сон и
шаги — рядом, чтобы видеть связи. Маленькие победы — отдельным экраном.

• Никакой ленты, рекламы и соревнований. Ничего не стыдит и не подгоняет.

Приватность:

• Все данные — дневник, вес, настроение — хранятся только на вашем телефоне.
Аккаунт не нужен. • Фото, голос и текст еды отправляются на сервер только при
включённом распознавании через ИИ и не сохраняются на нём. • Калории можно
скрыть одной кнопкой, если цифры давят.

Driftora — не медицинское приложение: оно не ставит диагнозы и не заменяет
врача. При расстройствах пищевого поведения обратитесь к специалисту.

**EN:**

Driftora comes from “drift”: you don’t have to march toward your shape — you
can drift there, in small steps, without heroics, breakdowns or guilt. Built
for people worn out by strict diets and drill-sergeant apps.

What it does:

• A food diary without spreadsheet typing: write “borscht and two slices of
bread”, say it out loud, or photograph your plate — Driftora identifies the
dishes, estimates weights and counts calories and macros using trusted food
databases (USDA, Open Food Facts, a Russian reference table). AI recognition
runs only with your explicit consent — manual entry always works.

• Honest numbers. Every estimate is marked “≈”, every food shows which
database its numbers came from, and everything can be corrected. We don’t
pretend to know your portion better than you do.

• A daily budget that grows with movement. The base is your resting
metabolism; steps and workouts add food calories during the day. Move more —
eat more. Honest arithmetic instead of punishment.

• Science-based targets: Mifflin–St Jeor and Katch–McArdle formulas, body
composition from a waist measurement, and after a couple of weeks of logging —
your real expenditure, measured from your own weight trend and food log.

• Weight as a trend, not a panic over every weigh-in. Mood, sleep and steps
nearby, so you can see connections. Small wins get their own screen.

• No feed, no ads, no competitions. Nothing shames you or pushes you.

Privacy:

• Everything — diary, weight, mood — stays on your phone. No account needed.
• Food photos, voice and text are sent to our server only when AI recognition
is on, and are not stored there. • Calories can be hidden with one tap.

Driftora is not a medical app: it does not diagnose and does not replace a
doctor. If you struggle with disordered eating, please talk to a specialist.

---

## Анкета Data safety (черновик ответов)

Общие: данные шифруются при передаче (HTTPS) — да; удаление данных — данные
живут на устройстве, удаляются вместе с приложением; аккаунтов нет.

Собирается и передаётся (только при включённом ИИ-распознавании, opt-in):

| Тип в анкете | Что | Обработка |
|---|---|---|
| Photos | фото еды | отправляется на наш сервер → OpenRouter (США) для распознавания; не хранится; не для рекламы; опционально |
| Voice or sound recordings | голосовая заметка о еде | то же |
| Other user-generated content | текст описания еды | то же |
| Device or other IDs | случайный install id (не рекламный, не аппаратный) | квота запросов к ИИ; не связывается с личностью |

НЕ собирается (живёт только на устройстве): вес, шаги, тренировки, сон,
настроение, дневник еды, параметры тела. Health & fitness в анкете — «not
collected» (данные не покидают устройство; сбор в терминах Google = передача
с устройства).

Google Sign-In появляется только при активной подписке (сейчас биллинг
выключен) — при включении добавить «Personal info → Email» с целью «привязка
покупки».

## Анкета возрастного рейтинга

Категория: Health / Fitness. Насилие, секс, наркотики, азартные игры,
шок-контент — нет. Обмен пользовательским контентом между людьми — нет.
Точная геолокация — нет. Покупки цифровых товаров — «нет», пока биллинг
выключен конфигом (при включении — пересдать анкету). Ожидаемый рейтинг:
3+/Everyone.

## Чеклист публикации

1. Аккаунт разработчика: play.google.com/console, $25 разово, зарубежная
   карта, верификация личности документом.
2. Создать приложение → заполнить витрину (тексты выше, иконка, баннер,
   2+ скриншота).
3. Анкеты: Data safety + рейтинг (ответы выше). Privacy policy URL:
   https://family-pie.ru/driftora/privacy (НЕ `/terms` — это оферта)
4. Сборка: `gh workflow run android-apk.yml --ref master -f variant=bundleRelease`
   → артефакт `driftora-android-aab`. При первой загрузке согласиться на Play
   App Signing (наш ключ становится upload key — это норма).
5. Каждая следующая загрузка — новый run: `versionCode` бандла = номер запуска
   workflow (#232), руками ничего не поднимать.
6. Закрытое тестирование: трек Closed testing, email-список 12+ тестеров,
   14 дней непрерывно, потом заявка на продакшен.
7. RuStore (параллельно, без ожидания): обычный подписанный APK из
   `assembleRelease`, ЮKassa разрешена, закрытый тест не требуется.

⚠️ Пока биллинг включён не будет: в Play-сборке НЕ светить кнопку оплаты
внутри приложения (политика Play Billing). Легальный путь для Play — покупка
на сайте + активация ключа в приложении.

---

## Что заявлено в консоли Play (05.09.2026, карточка `com.driftora.app`)

Карточка заполнена целиком; ниже — ответы, которые придётся повторять при
пересдаче анкет или новых правах в манифесте.

- **Privacy policy:** `https://family-pie.ru/driftora/privacy`.
- **Content rating** (IARC, категория «All other app types»): везде «нет» —
  нет обмена контентом между пользователями, нет онлайн-контента, нет покупок
  цифровых товаров, нет геолокации, не браузер, не новости → Everyone / 3+.
  ⚠️ «да» на UGC / онлайн-контент / покупки даёт Teen 14+ с дескриптором
  «Inappropriate Language» и запрет аудитории младше 13.
- **Target audience:** только 18+.
- **Sign in details:** нет ограничений (бесплатная квота ИИ доступна ревьюеру).
  Ads — нет. Advertising ID — нет. Government — нет. Financial — нет.
- **Data safety** (всё «collected», ничего «shared» — OpenRouter = процессор):
  Photos, Voice or sound recordings, Other user-generated content — эфемерно,
  по желанию, App functionality; Device or other IDs (install id) — не
  эфемерно, по желанию, App functionality + Fraud prevention; App interactions
  (маячок `/funnel/paywall`) — Analytics. Шифрование в транзите — да; аккаунтов
  нет; запрос удаления — да, ссылка на политику. Health & fitness — не
  собирается (живёт на устройстве). Эфемерное Play тоже требует раскрыть,
  в витрине его не показывает.
- **Health apps:** Activity and fitness, Nutrition and weight management,
  Sleep management, Stress management; региональных требований нет.
- **Health data permissions** — с первым бандлом Play потребовал текст на
  каждое из 11 прав `android.permission.health.*` (по-английски):
  - `READ_STEPS` — Daily step count is read from Health Connect (with the
    user's explicit permission) to show today's steps on the Home and Activity
    screens and to add step-based calories to the daily food budget. On-device
    only, local encrypted database, never sent to our servers or third parties.
  - `READ_EXERCISE` — Workout sessions are imported only if the user enables
    device import in settings, to list them on the Workouts screen and count
    their calories in the daily budget without double counting step-based
    estimates. On-device only.
  - `READ_ACTIVE_CALORIES_BURNED` — Imported after the user enables device
    import; shown on the Activity screen as an alternative estimate of daily
    energy expenditure and used on-device to calibrate the food budget.
  - `READ_WEIGHT` / `READ_BODY_FAT` — Smart-scale weigh-ins and body fat are
    imported only after the user taps «Connect» on the Weight screen; shown on
    the Weight screen, used on-device for the weight trend, the measured
    expenditure estimate and RMR (Katch–McArdle). Stored locally only.
  - `READ_SLEEP` — Sleep duration is shown next to steps and mood on the «Body
    and mood» screen. On-device only.
  - `READ_VO2_MAX`, `READ_HEART_RATE_VARIABILITY`, `READ_OXYGEN_SATURATION`,
    `READ_RESPIRATORY_RATE`, `READ_RESTING_HEART_RATE` — imported only when the
    user enables extended import (`app_settings.health_import_extended`);
    displayed as daily recovery/wellbeing indicators on the Activity and «Body
    and mood» screens. Display only, never used for calculations, never
    uploaded.
- **Store settings:** категория Health & Fitness, e-mail
  tihonenkoeugene@gmail.com, сайт `https://family-pie.ru/` (страницы
  `/driftora` без хвоста нет — 404).
- **Скриншоты витрины:** `docs/store/screenshots/*.png` (1080×1920, рамка с
  подписью, экран эмулятора 1080×2400 внутри). Генератор —
  `xcrun swift docs/store/screenshots/compose.swift <папка с 01_main.png …>`;
  подписи и порядок в нём же.
- **Треки:** internal — opt-in
  `https://play.google.com/apps/internaltest/4700659331729457931`; closed
  «Alpha» — `https://play.google.com/apps/testing/com.driftora.app`; список
  тестеров «Driftora internal» общий для обоих. Для продакшена: 12 тестеров
  подключены одновременно 14 дней подряд, затем «Apply for production».
