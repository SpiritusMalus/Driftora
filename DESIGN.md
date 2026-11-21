---
name: "Driftora — Личный дневник питания"
description: "Shared native visual system for the approved nutrition direction."
colors:
  canvas-dark: "#151D20"
  surface-dark: "#202A2E"
  surface-raised-dark: "#2A363B"
  ink-dark: "#F5F0E8"
  secondary-ink-dark: "#B0BDBF"
  action-dark: "#EBD49B"
  on-action-dark: "#30291A"
  rule-dark: "#354246"
  canvas-light: "#F8F5ED"
  surface-light: "#EEEBE2"
  surface-raised-light: "#E3E0D7"
  ink-light: "#263336"
  secondary-ink-light: "#526165"
  action-light: "#4F655A"
  on-action-light: "#FFFDF5"
  rule-light: "#D6D7CE"
---

# Driftora — личный дневник питания

Mode: **Operate**. The owner approved the nutrition proposal inspired by Cal AI's clear figures and meal photography, with a distinct flat composition. This replaces the former blue “Лента дня” visual direction. Existing routes, native controls, data semantics and capture methods remain authoritative.

## Composition and identity

The signature is consistent **Съедено / Осталось** alignment: two unboxed calorie columns, a single linear goal bar, and unified protein/fat/carbohydrate balances. Photographic meal records follow the figures. Color is supporting information; labels and values carry meaning without it.

The same graphite/ivory surfaces, Golos type, muted rules and comfortable controls extend through food, weight, activity, mood, diary, history, plan and settings. Avoid decorative card grids, four nutrition rings, glowing surfaces and gradients. A contained card is appropriate for a real grouped task or meal record; ordinary sections use open space and separators.

## Runtime palette

Use `useTheme()` / `resolveTheme()` rather than copied hex values. The existing device color-scheme behavior is retained; both schemes are first-class.

| Semantic role | Dark | Light |
| --- | --- | --- |
| `background` | #151D20 | #F8F5ED |
| `surface`, `card` | #202A2E | #EEEBE2 |
| `surface2`, `fill` | #2A363B | #E3E0D7 |
| `text`, `heroText` | #F5F0E8 | #263336 |
| `subtle`, `icon`, `tertiary` | #B0BDBF | #526165 |
| `primary`, `heroAccent` | #EBD49B | #4F655A |
| `onPrimary` | #30291A | #FFFDF5 |
| `separator` | #354246 | #D6D7CE |
| `protein` | #E1AA9E | #954B40 |
| `fat` | #E0C899 | #7D5B27 |
| `carb` | #A4C3D1 | #42677A |

`primarySoft` is #393B31 dark / #E0E6DB light. `accent` remains secondary ink for backward compatibility. The existing `primaryGradient` and `bodyMindGradient` have equal stops; `glow` remains transparent. iOS uses the same semantic palette while retaining native navigation materials and grouping.

The stronger light secondary and nutrient colors are intentional: compact labels must remain legible on all three surfaces. Nutrition colors should identify a nutrient, not turn over-goal values into alarms. Show excess explicitly in words. Food calories mean energy eaten; activity expenditure is a separate quantity.

## Typography and scaling

Golos Text 400 / 500 / 600 / 700 is loaded from the existing Expo font package. Existing `theme.font` roles remain supported. `displayHeavy` and `bodyBold` now use 700, `heading` and `bodySemiBold` use 600, `display` and `bodyMedium` use 500, and `body` uses 400.

New reusable `theme.type` presets (React Native logical points):

| Preset | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `title` | 28 / 35 | 600 | Route/display title |
| `section` | 21 / 28 | 500 | Major section |
| `body` | 17 / 25 | 400 | Reading copy |
| `label` | 16 / 22 | 500 | Controls, data labels |
| `caption` | 13 / 19 | 400 | Supporting metadata |
| `calorie` | 50 / 58 | 500 | Main daily values |
| `macro` | 24 / 31 | 500 | Protein/fat/carbohydrate values |

Calorie tracking is −1.8pt, macro −0.5pt. Numeric presets use tabular figures. These are shared defaults, not a reason to squeeze long localized content. Keep default native font scaling, wrap labels, and stack data at large text sizes. Do not introduce a global maximum-font-scale cap.

## Shared geometry

`theme.spacing` supplies `page:22`, `section:28`, `row:16`, `inline:10`. The shared scrolling `Screen` uses 18pt horizontal gutters below 360pt width and 22pt otherwise. Its existing safe-area, Android IME compensation, iOS keyboard inset and drag-dismiss behavior are unchanged.

`theme.radius` supplies `card:14`, `control:13`, `input:12`.

- `PrimaryButton`: flat action fill, radius13, minimum52pt height, centered16/22 label, room for scaled text. Preserve existing handlers and disabled/pressed states.
- `TextField`: native input, radius12, minimum50pt height,17pt text, semantic placeholder and selection tint. Native keyboard, multiline and focus behavior remain intact.
- `Chip`: radius12, minimum44pt iOS /48pt Android; selected and disabled accessibility state preserved. Small15/21, large17/24, block16/22 type.
- `Card`: a quiet surface fill and radius14 without ornamental shadow or outline. `variant="section"` stays transparent with a bottom hairline. Protected consent/error flows retain their explicit boundaries.
- `ListGroup`: open rows, minimum64pt,16pt vertical padding,17/24 titles and14/20 subtitles. Full row remains the tap target; semantic button role is explicit.
- `DayNav`: familiar previous / return-to-today / next behavior,48pt arrows,16/22 label, radius12 surface. Existing day limits remain intact.
- `SectionHeader`:21/28 semibold,28pt above and14pt below.

Existing capture/composer methods, status/error handling and native navigation remain in their established routes. `FoodBar` continues to resolve shared action colors; its separate text and microphone targets preserve their API. Do not replace routine direct actions with a dropdown or invent fake photo history.

## Platform behavior and motion

Retain the existing iOS navigation stack, native large-title/material treatment, edge-swipe back and safe-area layout. Android retains its app bar, system Back and edge-to-edge/keyboard handling. Native Switch, input, picker, sheet and alert behavior takes precedence over browser-prototype mechanics.

Shared transitions retain the existing `DUR`, `EASE_OUT` and reduced-motion support. Do not animate nutrition counts through false intermediate values. Press feedback is restrained and reversible.

## Implementation and evidence boundary

This file describes native source tokens and shared component geometry. The approved browser prototype is a design reference; its screenshots do not verify native rendering. Verify native Android/iOS, large type, both schemes, keyboard and critical flows before claiming platform QA. Test and delivery evidence belongs in the current task receipt and authoritative project journal.

New theme fields are additive: `surface`, `surface2`, `protein`, `fat`, `carb`, `type`, `spacing`, `radius`. All previous `Theme`, font, component props and native route APIs remain available.
