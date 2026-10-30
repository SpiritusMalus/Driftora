---
name: "Driftora — Лента дня"
description: "Native visual system for Driftora's existing daily tracking flows."
colors:
  action-light: "#2449D8"
  on-action-light: "#FFFFFF"
  canvas-light: "#F2F3EB"
  ink-light: "#17302A"
  secondary-ink-light: "#59685E"
  rule-light: "#CDD5C8"
  control-fill-light: "#E7EBDD"
  action-fill-light: "#E0E6F5"
  action-dark: "#A4B8FF"
  on-action-dark: "#142A66"
  canvas-dark: "#19231F"
  ink-dark: "#F0F1E7"
  secondary-ink-dark: "#ADBBAE"
  rule-dark: "#425246"
  control-fill-dark: "#27392E"
  action-fill-dark: "#283B58"
typography:
  display:
    fontFamily: "GolosText_500Medium"
    fontSize: "49px"
    fontWeight: 500
    lineHeight: "54px"
    letterSpacing: "-1.8px"
  headline:
    fontFamily: "GolosText_500Medium"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: "44px"
    letterSpacing: "-1.1px"
  title:
    fontFamily: "GolosText_500Medium"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "24px"
    letterSpacing: "-0.25px"
  body:
    fontFamily: "GolosText_400Regular"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  label:
    fontFamily: "GolosText_600SemiBold"
    fontSize: "16px"
    fontWeight: 600
rounded:
  section: "0px"
  food-dock: "3px"
  inline-add: "4px"
  control: "6px"
  contained: "10px"
spacing:
  row-gap: "8px"
  inline-gap: "12px"
  contained-padding: "16px"
  section-padding: "18px"
  home-gutter-ios: "22px"
  home-gutter-android: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-light}"
    textColor: "{colors.on-action-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "15px 0px"
  button-primary-dark:
    backgroundColor: "{colors.action-dark}"
    textColor: "{colors.on-action-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "15px 0px"
  chip-small:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  chip-small-selected:
    backgroundColor: "{colors.action-light}"
    textColor: "{colors.on-action-light}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  text-field-android:
    backgroundColor: "{colors.control-fill-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    padding: "12px"
  contained-card:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.contained}"
    padding: "{spacing.contained-padding}"
  open-section:
    backgroundColor: "transparent"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.section}"
    padding: "18px 0px"
  food-dock:
    backgroundColor: "{colors.action-light}"
    textColor: "{colors.on-action-light}"
    rounded: "{rounded.food-dock}"
  day-navigation:
    backgroundColor: "{colors.control-fill-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    padding: "3px"
---

# Design System: Driftora — Лента дня

## Overview

**Selected direction: «Лента дня» (Day Ribbon).** This records the implemented native interface and the direction already chosen by the owner. Use it when extending existing screens; retain their routes, controls, defaults, data states and product copy.

The interface places daily records on one flat canvas. Large day figures, thin rules and open rows establish hierarchy; blue marks actions, selection and food timeline nodes. Golos Text carries both Russian text and figures. Routine actions stay directly available, including the separate inline add controls and the shared food composer.

**Key Characteristics:**

- One light or dark canvas across ordinary page sections.
- Large daily figures followed by compact labels and real records.
- Open list rows, thin separators and restrained corner radii.
- Blue actions and selections with scheme-specific foreground colors.
- Existing native navigation, input behavior and accessibility scaling.

Sources: `lib/theme/{colors,iosSurfaces,typography,theme,motion}.ts`, `components/ui/`, `components/home/`, `app/index.tsx`, `app/food/index.tsx` and `app/food/log.tsx`. The frontmatter extracts reused source measurements; it does not add a runtime token API. Its `px` values represent React Native logical layout units, before device density and text scaling. Components resolve the matching scheme at runtime; unsuffixed component examples above show light mode.

The selected reference and Android Home, food-day, mood and sections captures were reviewed during this documentation pass. This is a visual-system record, not a complete native QA receipt. iOS export success does not establish native iOS visual or interaction verification. The sidecar's HTML/CSS snippets are browser previews of native components; their keyboard-focus adapters do not define native hover or focus behavior.

## Colors

### Primary

Use **action-light** or **action-dark** for primary buttons, active chips, links, timeline nodes and progress fills. Always pair a filled action with its **on-action** foreground; dark mode uses dark blue text on the light blue fill.

The **action-fill** colors are the existing soft action wells exposed by `theme.primarySoft`. They are supporting fills, not another accent family.

### Neutral

**Canvas** supplies `background`, `surface` and `card` in each scheme. Their equal values are intentional: ordinary sections do not need a contrasting card fill. **Ink** supplies primary content and daily figures. **Secondary ink** supplies supporting text, units and neutral icons. **Rule** supplies separators and retained outlines. **Control fill** supplies inactive controls, input wells and mood tracks.

Use the semantic theme roles rather than hard-coding a light value in a screen. `primaryGradient` and `bodyMindGradient` retain compatibility with existing components but use equal stops for flat fills. `glow` is transparent.

## Typography

Golos Text is loaded in regular, medium and semibold weights (400, 500, 600). Native styles select the loaded family names through `theme.font`; do not substitute the older installed font packages simply because they remain dependencies.

| Role | Use |
| --- | --- |
| Display | Home calorie figure. Food-day figures use the same size and line height with their existing slightly different tracking. |
| Headline | The large tappable Home day title. |
| Title | Section headings and food-day headings. Timeline entry titles use the smaller existing medium style. |
| Body | Explanations and empty states; secondary rows retain their compact source sizes. |
| Label | Primary action labels; chips retain their existing size variants. |

`displayHeavy`, `bodySemiBold` and `bodyBold` resolve to the semibold asset; `display`, `heading` and `bodyMedium` resolve to medium. Display figures and timeline times use tabular numerals where set in source. Preserve units, approximation marks, targets and missing-data dashes with their numbers.

Honor system text scaling. Do not add a global font-size multiplier cap. Existing single-line hero figures and composer method labels use local fit-to-width behavior; this does not replace the responsive layouts described below.

## Layout

Use one vertical scrolling column. Home has its own brand/sections row and day/date heading, then the unboxed food summary, chronological food ribbon, weight, steps and workout rows. Preserve the existing history entry point, mood swipe/page-dot navigation and other conditionally rendered sections. Other screens keep their native headers and their current semantic order.

Home uses the scheme-independent platform gutters extracted above. The shared `Screen` container retains narrower horizontal insets (Android 18; iOS 16). Open `Card` sections use vertical padding only; `ListGroup` rows use a minimum height of 56, vertical padding of 14 and a gap of 12. These are component measurements, not a new universal grid.

Home's food dock sits outside the scroll view and includes the bottom safe inset. Keep it reachable with the keyboard and system navigation area present. The text target and microphone target remain distinct controls. Other input screens retain the shared keyboard-space and scrolling behavior.

When `fontScale > 1.5`, Home and food-day macro summaries stack vertically. Food-day entry headings also reflow instead of squeezing the title beside the amount. Timeline time columns grow with text scale: Home uses `ceil(44 × max(1, fontScale))`, food-day uses `ceil(36 × max(1, fontScale))`. Preserve wrapping and flexible content widths; do not fix overflow by disabling font scaling.

## Elevation & Depth

Ordinary content is flat. Use spacing, hairline rules and the existing control fills to separate content. Do not add decorative shadows, gradients or glow to the day canvas. `Card variant="section"` is transparent with a bottom hairline; the default contained `Card` remains a different component treatment.

Keep genuine consent, error, recovery and protected-focus surfaces contained where their existing flow requires it. `ConsentModal`, for example, uses a centered outlined panel on the existing black scrim, a maximum width of 440 and internal padding of 22. A page-section refresh is not a reason to flatten or weaken these boundaries.

Motion uses the shared `DUR` values and `EASE_OUT`: short press, selection, fade, layout and entry transitions. These values live in the sidecar because the frontmatter schema has no motion group. Retain reduced-motion behavior: shared animated transitions become immediate while existing haptic behavior stays. Do not add bounce or animate a reported nutrition amount through intermediate values.

## Shapes

Open sections have square edges. Small corner radii identify controls; the food dock is slightly straighter than the primary button. Inline plus controls retain their outlined square shape. Contained panels retain their larger radius. Progress tracks and timeline nodes keep their existing small rounded geometry.

Use full-width rules for ordinary grouped rows. Do not restore icon tiles behind the open `ListGroup` icons. Retain component-specific borders for inputs, chips, add controls and contained prompts.

## Components

### Buttons and chips

`PrimaryButton` uses a flat action fill, centered semibold label and the control radius. Pressed opacity is 0.85; disabled opacity is 0.4. No app-wide hover treatment is defined by the native component.

`Chip` is outlined while inactive and action-filled while selected. The small, large and block geometries remain distinct; wrapping rows retain their gap. Pressed opacity is 0.7 and disabled opacity is 0.4. Keep selected and disabled accessibility state. Mood's grid retains all values from 0 through 10 as direct controls with the selected action fill.

### Open sections and contained panels

Use `Card variant="section"` for the ordinary open page sections already migrated to that treatment. Use `ListGroup` for open icon/title/subtitle rows with a trailing chevron, value or switch. Keep the whole row's existing tap handler.

The default `Card` remains contained: shared canvas fill, retained radius, standard internal padding and an Android hairline outline; iOS omits that default outline. Consent and other protected surfaces may apply their own explicit border and spacing. Choose the variant for the existing component's role rather than applying one treatment to every surface.

### Inputs and food composer

`TextField` uses a control well, primary ink and secondary placeholder text. Android keeps a hairline outline; iOS keeps its existing inset geometry. Multiline fields retain their minimum height, top alignment and keyboard behavior. The shared component does not define a custom focus-color animation.

Food text, voice, photo and barcode belong to the existing single composer. Available methods stay together in its method row, subject to the existing device capability checks. Preserve the shared draft and current switching behavior, actual parse/review/error states, and direct controls. Do not split methods into unrelated flows or introduce a dropdown for routine actions.

### Navigation and food dock

The Home day title opens history; the sections control opens the existing sections screen. Day navigation keeps previous/next arrows and a central return-to-today action, with the existing future-day and history limits. The mood pane remains reachable by the existing swipe and tappable page dots.

`FoodBar` has two direct targets: text opens the food composer, and the microphone opens it for voice. Its minimum height is 57; the microphone target has the same width. The text label may grow vertically with system type. Preserve handlers and the dock's safe-area placement.

### Day ribbon

`DayRibbonTimeline` renders the existing day's food entries in ascending timestamp order using a sorted copy. Each row has a time, a small blue node, meal title/detail and an optional right-aligned calorie amount. It opens the existing entry route; pending or failed parsing opens the food-day screen. Keep loading, empty, unconfirmed, parsing, failed and hidden-calorie states truthful. Do not add sample meals, estimated events or decorative records to fill the timeline.

## Do's and Don'ts

### Do:

- **Do** use the matching light or dark theme roles for every surface and action foreground.
- **Do** preserve existing routes, direct controls, inline plus handlers and the single shared food composer.
- **Do** build ordinary sections from open rows, real content and thin rules.
- **Do** retain contained consent, error, recovery and protected-focus boundaries where the existing flow requires them.
- **Do** preserve system text scaling, large-type reflow, keyboard clearance and safe-area dock placement.
- **Do** check native rendering and interactions on the target platform before claiming native QA.

### Don't:

- **Don't** reduce this direction to a palette and font replacement; retain the implemented day composition and chronological ribbon.
- **Don't** add slogans, motivational filler, invented events or replacement product copy.
- **Don't** turn routine actions into dropdown forms or separate the food capture methods into unrelated composers.
- **Don't** add decorative card stacks, icon tiles, shadows, glow or unequal gradient stops to ordinary day sections.
- **Don't** suppress system font scaling to make a dense row fit.
- **Don't** treat browser previews or a successful iOS export as native iOS visual verification.
