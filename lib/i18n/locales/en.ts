export const en = {
  // Shown by the top-level crash net when a screen throws during render.
  errorBoundary: {
    title: 'Something went wrong',
    body: 'Something broke on this screen. Your data is safe. Try again.',
    retry: 'Try again',
  },
  // First-launch offer gate (GENERAL consent: Terms + Privacy). Kept separate
  // from the AI cross-border consent below — Russian law bans bundled consent.
  legal: {
    gate: {
      heroText: 'Your entries stay on your phone.',
      heroLead: 'In an encrypted database — yours alone.',
      body: 'There’s no account or server holding them: we can’t see or read them.',
      acceptHint: 'By tapping “Accept”, you agree to the Terms of Use and the Privacy Policy.',
      accept: 'Accept',
    },
    terms: 'Terms of Use',
    privacy: 'Privacy Policy',
    viewOnline: 'View online',
    close: 'Close',
  },
  // Just-in-time, opt-in consent for the cross-border food→AI transfer.
  consent: {
    ai: {
      title: 'Send this meal for recognition?',
      body: 'Your food description — text, photo or voice — goes for recognition to OpenRouter (OpenRouter, Inc., USA) via our server. Calories and macros come from the food database; when a food is in no database, a rough AI estimate marked “≈” fills in. Your diary, mood and weight are never sent. Write about the food only — no extra personal details. This is a cross-border data transfer; you can withdraw consent in Settings.',
      accept: 'Send',
      decline: 'Don’t send',
      declineCaption: 'Text is counted from the built-in table — rougher. Photos and voice can’t be parsed without AI.',
    },
    photo: {
      title: 'This photo goes to OpenRouter (USA)',
      body: 'Send the plate only. A face, people or documents in the frame may count as personal data. The photo is downscaled and stripped of geotags before sending.',
      confirm: 'Send photo',
      cancel: 'Cancel',
    },
    workout: {
      title: 'Parse this workout with AI?',
      body: 'Your workout description — text, voice or a screenshot — goes to OpenRouter (OpenRouter, Inc., USA) via our server to identify the activity type and duration. Calories are computed by the app from your weight; for a tracker screenshot, the printed figure is logged. Your diary, mood and weight are never sent. Write about the workout only. This is a cross-border data transfer; you can withdraw consent in Settings.',
      accept: 'Parse',
      decline: 'Don’t send',
      declineCaption: 'You can still add a workout with the buttons — they work offline.',
    },
  },
  home: {
    title: 'Today',
    inlineAdd: 'Log it',
    steps: {
      placeholder: 'Steps today',
      // Empty state: an invitation (the field unfolds via «+») — the old
      // "Coming soon" read as "doesn't work".
      noneYet: 'nothing logged yet',
      earnedEstimate: '≈ {{kcal}} kcal above resting from steps',
    },
    // Compare today to the user's own normal (personal step baseline). Tone is
    // curious and supportive — never a target, never "you're behind".
    baseline: {
      above: 'Above your usual today',
      typical: 'A typical day for you',
      below: 'Quieter than usual today — and that’s okay',
      forming: 'Still learning your rhythm',
    },
    bodyMind: { basis: 'Based on {{days}} days with mood + {{signal}}' },
    hero: {
      eyebrow: 'Body & mind',
      // The one-tap inputs that build the insight, shown while it is still forming.
      buildingOne: 'Your body↔mind link is forming — {{days}} more day with a mood and {{signal}}.',
      buildingFew: 'Your body↔mind link is forming — {{days}} more days with a mood and {{signal}}.',
      buildingMany: 'Your body↔mind link is forming — {{days}} more days with a mood and {{signal}}.',
      buildingCaption: 'A check-in today and a few more, and the pattern shows up here.',
      // Reused for both the link and no-link states.
      caption: 'An association, not a cause — never a reason to push yourself.',
      // The body signal noun for the "…with a mood and {{signal}}" phrasing.
      signalNoun: { steps: 'a steps reading', sleep: 'a sleep reading', protein: 'a protein reading' },
    },
    sleep: {
      meaning: {
        unknown: 'no sleep data yet',
        very_short: 'under 6 hours — a short night; one won’t undo you',
        short: 'close to the range; nearer 7 hours often feels easier by day',
        ample: 'within the recommended 7–9 hours',
        long: 'over 9 hours — sometimes a sign your body is catching up',
      },
    },
    daySummary: {
      empty: 'A new day. Check in your mood or take a few steps, and a summary shows up here.',
      steps: '{{steps}} {{stepsWord}} already today. A good start.',
      mood: 'Mood today — {{mood}}/10. Thanks for checking in.',
      win: 'There’s already a small win today — that counts.',
      stepsMood: '{{steps}} {{stepsWord}} and a mood of {{mood}}/10 today.',
      stepsWin: '{{steps}} {{stepsWord}} today — and already a win.',
      moodWin: 'Mood {{mood}}/10 and a win in the bag. Good day.',
      stepsMoodWin: '{{steps}} {{stepsWord}}, mood {{mood}}/10 — and already a win today.',
      returning1: 'Good to see you back. Returning is itself a kind of care.',
      returning2: 'Welcome back. Any day is a good day to pick this up again.',
      returning3: 'You’re here again — and that’s the habit. Start small whenever you’re ready.',
      returning4: 'Back together. No need to catch up — just note how you are right now.',
    },
    feeders: {
      steps: 'Steps today',
      // Workouts as their own Home row (they used to be a subline inside the
      // activity widget). Opens the workouts screen.
      workouts: 'Workouts',
      workoutsCta: 'Log a workout',
      workoutsToday: '≈{{kcal}} kcal to today’s budget',
      sleep: 'Last night’s sleep',
      diary: 'Thought diary',
      diaryCount: '{{count}} entries',
      diaryCta: 'Walk a worrying thought through steps',
      weight: 'Weight',
      weightCta: 'Once a week is enough',
      weightToday: '{{kg}} kg — today',
      weightYesterday: '{{kg}} kg — yesterday',
      weightDaysAgo: '{{kg}} kg — {{days}} d ago',
    },
    moreLink: 'Sections',
    // The mind side opens by a left swipe (the Home mood row retired
    // 2026-07-12): a one-time interactive coach + a fading caption until the
    // gesture sticks.
    swipeCoach: {
      title: 'Mood & diary — swipe left',
      body: 'Swipe left anywhere on the Home screen to open mood and the thought diary.',
      try: 'Try it right now',
      later: 'Later',
    },
    swipeHint: 'Mood & diary — swipe left',
    // Mirror gesture on the Mind screen: a right swipe returns to body/food.
    // Serves as the page-dots accessibility label there.
    swipeHintBack: 'Food & activity — swipe right',
    bodyMindCol: {
      bodySignal: { steps: 'Body · steps', sleep: 'Body · sleep', protein: 'Body · protein' },
      mind: 'Mind · mood',
    },
    foodBar: { placeholder: 'Log food' },
    food: {
      title: 'Food today',
      movementHint: 'Before activity — steps & workouts raise the budget',
    },
    weight: {
      placeholder: 'Weight today',
      save: 'Save',
      saving: 'Saving…',
    },
    northStar: 'Streak: {{weeks}} weeks running.',
    paused: {
      title: 'You are on a break',
      body: 'Goals and auto-wins are off. Your data is safe — pick it back up whenever you are ready.',
      resume: 'Resume goals',
    },
    // The "what do I do first?" card: shown while the day budget can't be
    // computed yet (empty body profile / no weigh-in), pointing at the wizard.
    setup: {
      title: 'Set up your body',
      body: 'A few quick questions — and we compute your daily calorie and macro targets.',
      cta: 'Set up',
    },
  },
  onboarding: {
    next: 'Next',
    start: 'Get started',
    skip: 'Skip',
    hero: {
      title: 'Body and mind, together',
      body: 'Driftora looks for one honest link: how moving, sleep and food shape how you feel. An association, not a cause.',
    },
    feed: {
      title: 'A minute a day is enough',
      body: 'Log food by text, voice or photo. Mood is one tap — the screen opens with a left swipe from Home. Steps and sleep come in on their own once you allow access to health data.',
    },
  },
  // Body-setup wizard: one question per screen, everything saved by the single
  // «Compute my daily target» tap, then the result with its breakdown.
  bodySetup: {
    title: 'Body setup',
    progress: 'Step {{i}} of {{n}}',
    back: 'Back',
    next: 'Next',
    calc: 'Compute my daily target',
    save: 'Save and recompute',
    birthYear: {
      title: 'Birth year',
      hint: 'Age is part of the energy-expenditure formula.',
      placeholder: 'e.g. 1990',
      invalid: 'Enter a real year — e.g. 1990.',
    },
    sex: {
      title: 'Sex',
      hint: 'Resting-energy formulas differ for men and women.',
      male: 'Male',
      female: 'Female',
    },
    height: {
      title: 'Height',
      placeholder: 'e.g. 175',
      invalid: 'Height in centimeters: 100 to 250.',
    },
    weight: {
      title: 'Current weight',
      hint: 'We will log this as today’s weigh-in.',
      placeholder: 'e.g. 80',
      invalid: 'Weight in kilograms: 20 to 400.',
    },
    bodyFat: {
      title: 'Body fat %',
      hint: 'If you know it from a measurement — impedance scale, calipers, DEXA. If not, skip: the next step estimates it from your waist.',
      placeholder: 'e.g. 25',
      invalid: 'Realistic range: 3–70%. Leave empty if unsure.',
      skip: 'No measurement — skip',
      fromDevice: 'Prefilled from your scale’s measurement of {{date}} — feel free to correct it.',
    },
    waist: {
      title: 'Waist circumference',
      hint: 'With a tape at navel level. From your height and waist we estimate composition — the target gets sharper, no device needed.',
      placeholder: 'e.g. 85',
      invalid: 'Realistic range: 40–200 cm.',
      skip: 'Skip',
      haveFat: 'Body fat % is already set — it’s more accurate, so waist isn’t needed.',
    },
    goal: {
      title: 'Your goal',
      lose: 'Lose weight',
      loseDesc: 'A calorie deficit — weight gently down.',
      maintain: 'Maintain weight',
      maintainDesc: 'Eat to your needs and hold steady.',
      gain: 'Build muscle',
      gainDesc: 'A surplus + strength training — muscle grows.',
    },
    goalWeight: {
      title: 'Goal weight',
      hint: 'Optional — the plan works without it, you just won’t see the "time to goal" line.',
      placeholder: 'e.g. 90',
      directionLose: 'To lose weight, the goal must be below your current weight.',
      directionGain: 'To gain, the goal must be above your current weight.',
    },
    tempo: {
      titleLose: 'Weight-loss pace',
      titleGain: 'Gain pace',
      lose: {
        soft: 'Soft',
        softDesc: '−10% of maintenance — the gentlest.',
        standard: 'Moderate',
        standardDesc: '−15% (−20% at BMI ≥ 30) — recommended.',
        fast: 'Fast',
        fastDesc: '−25% — assertive. We still never go below the healthy minimum.',
      },
      gain: {
        soft: 'Lean',
        softDesc: '+5% — a clean bulk, minimal fat.',
        standard: 'Standard',
        standardDesc: '+10% — recommended.',
        fast: 'Fast',
        fastDesc: '+15% — quicker, but a visible share of the gain will be fat.',
      },
    },
    result: {
      title: 'Your daily target',
      perDay: 'kcal a day',
      howTitle: 'Where the number comes from',
      howTeaser: 'Resting metabolism, your goal, and how to raise it',
      bmr: 'Resting metabolism ≈ {{kcal}} kcal — expenditure at complete rest ({{method}}).',
      overestimate:
        'At your weight the formula overestimates burn by 10–15%. Tap here and add your waist — it gets sharper.',
      willRefine: 'This is a starting point. After 2–3 weeks of logging the app measures your real burn and sharpens it on its own.',
      method: {
        katch: 'from body composition, Katch–McArdle',
        'katch-rfm': 'from body composition, estimated from waist',
        mifflin: 'Mifflin–St Jeor formula',
        measured: 'from your own data (weight trend + log)',
      },
      maintenance: 'A day with no sport and barely any walking ≈ {{kcal}} kcal.',
      delta: {
        lose: 'Minus {{pct}}% for weight loss → your base is {{kcal}} kcal.',
        gain: 'Plus {{pct}}% for gaining → your base is {{kcal}} kcal.',
        maintain: 'For maintenance the target equals that expenditure.',
      },
      boostTitle: 'How to raise the target',
      boost: 'The base is a day with no movement at all. Steps above ~3,000 and workouts add to the budget the same day: move more — eat more. You’ll see the “base · steps · workouts” line on Food.',
      gainNote: 'A surplus builds muscle only together with strength training. Without it, the extra calories become fat.',
      applied: 'Saved as your daily goal ✓ — progress shows on Food.',
      edit: 'You can change this anytime: Weight → Body parameters → Edit.',
      done: 'Done',
    },
  },
  // "How it works" — the honesty page: where every number comes from, its real
  // accuracy, and how to raise the daily budget. Mirrors the RU copy.
  howItWorks: {
    title: 'How it works',
    linkTitle: 'How the numbers work',
    // A hero statement instead of intro filler: the north-star of the honesty page.
    hero: 'Every number here is an estimate.',
    heroLead: 'The real instrument is your weight trend.',
    // teaser — the one line shown on a collapsed card; body opens on tap.
    norm: {
      title: 'Your daily target',
      teaser: 'Resting metabolism + your weight goal',
      body: 'The foundation is resting metabolism: what the body burns at complete rest. Accuracy climbs a ladder, and climbing it is optional:\n\n· nothing set — from sex, height, weight and age (Mifflin–St Jeor). A population average: at a high weight it overestimates by 10–15%, because it treats fat as active as muscle;\n· waist set — we estimate composition from height and waist and compute from lean mass (Katch–McArdle). A tape is all it takes;\n· measured body-fat % set — the same, only sharper than the estimate;\n· 2–3 weeks of logging — the app measures your real burn from the weight trend and your food, and uses that. Nothing to measure.\n\nThen the goal: losing — minus 10–25% of maintenance (you pick the pace), gaining — plus 5–15%, maintaining — no shift. The plan never drops below the healthy minimum.\n\nProtein — 1.6–1.8 g per kg (at a high BMI — from the goal weight), fat — about 30% of calories, carbs — the rest, fiber — 14 g per 1000 kcal.',
    },
    budget: {
      title: 'The day’s budget: base + steps + workouts',
      teaser: 'Resting + steps + workouts',
      body: 'The plan’s base is a day with no movement at all (and never below the healthy minimum). All movement adds on top the same day:\n\n· steps above ~3,000 — the first ~3,000 are already inside the sedentary base;\n· workouts — 75% of their burn (why not 100% — below).\n\nThe sum shows on Food as the “resting · steps · workouts” line. Move more — eat more: any movement raises the budget on top of the minimum right away.',
    },
    food: {
      title: 'Where food numbers come from',
      teaser: 'From the label, databases or an AI estimate',
      body: 'Where the numbers come from: a full nutrition label on a package photo (“from the label”) — the most exact; otherwise food databases (the Russian table, USDA, Open Food Facts, FatSecret); when no database has the food — a rough AI estimate marked “≈”.\n\nHonest accuracy: even with databases a real plate differs by ±10–20%; an AI estimate — up to ±30%. Wrong match — “not it?” and manual search are always one tap away.',
    },
    workouts: {
      title: 'Workouts and the afterburn',
      teaser: 'MET × weight × time, 75% into the budget',
      body: 'Burn = the activity’s “cost” (MET from a research compendium) × weight × time. For walking, running and cycling your pace refines it. Strength is logged in sets — ≈3 minutes per set, no stopwatch needed; and the effort you pick (light/moderate/hard) shifts the “cost” — heavy lifting burns more.\n\nStrength and HIIT get +10% for the afterburn: for a day or two after the session the body keeps spending on recovery. Tens of kcal, not hundreds.\n\nOnly 75% of the estimate enters the budget — formulas overstate, and undercounting is more honest. Have exact numbers from a watch? Enter the kcal by hand (“from tracker”) or via a screenshot — saved as-is, the budget takes the same 75%. Overall estimate accuracy ±20–25%.',
    },
    boost: {
      title: 'How to raise your target',
      teaser: 'The target is a base, not a ceiling',
      body: 'The target is a base, not a ceiling. Move more and the budget grows the same day (how it adds up — see “The day’s budget”).\n\nLong-term, muscle raises the target: it burns energy even at rest. Gaining muscle grows the base over time — the app picks that up through your body-fat %.',
    },
    honesty: {
      title: 'About accuracy — honestly',
      teaser: 'Estimates with “≈”, not the truth',
      body: 'So next to the numbers you get “≈”, a source and the assumptions — not a promise of precision.\n\nMeasuring burn from your log is exactly as honest as the log: the scale sees everything you ate, the maths only sees what you wrote down, so unlogged food lowers the burn. Workouts need no logging for this — their share already shows up in the weight. If the number lands below your resting rate, the app says so and won’t let you lean on it.\n\nWhat to do: if your weight moves the wrong way for 2–3 weeks, adjust the target by 5–10% and keep watching. The app is not medical advice.',
    },
  },
  more: {
    title: 'Sections',
    groups: {
      daily: 'Every day',
      progress: 'Progress',
      app: 'App',
    },
    sections: {
      food: 'Food today',
      steps: 'Steps',
      workouts: 'Workouts',
      weight: 'Weight',
      mind: 'Mood & diary',
      wins: 'Wins',
      review: 'Weekly review',
      settings: 'Settings',
      how: 'How it works',
    },
    subtitles: {
      food: 'The day’s entries and totals',
      steps: 'Steps — by hand or automatically',
      workouts: 'Log a workout — the calories join your budget',
      weight: 'Weigh-ins and your nutrition plan',
      mind: 'Mood scale and thought diary',
      wins: 'What has already gone well',
      review: 'This week compared with last',
      settings: 'Privacy, targets, break',
      how: 'Where the numbers come from and how accurate they are',
    },
  },
  history: {
    title: 'Days',
    today: 'Today',
    yesterday: 'Yesterday',
    empty: 'No entries yet — days will appear here as you log.',
    noFood: 'no food entries',
    foodSection: 'Food',
    foodEditHint: 'Tap an entry to edit or delete it',
    macrosLine: 'P {{prot}} · F {{fat}} · C {{carb}}',
    moodSection: 'Mood',
    otherSection: 'Body',
    weightRow: 'Weight',
    stepsRow: 'Steps',
    emptyDay: 'Nothing was logged on this day.',
    dbUnavailable: 'History is available in a device dev build.',
    m1: 'January',
    m2: 'February',
    m3: 'March',
    m4: 'April',
    m5: 'May',
    m6: 'June',
    m7: 'July',
    m8: 'August',
    m9: 'September',
    m10: 'October',
    m11: 'November',
    m12: 'December',
    w0: 'Sunday',
    w1: 'Monday',
    w2: 'Tuesday',
    w3: 'Wednesday',
    w4: 'Thursday',
    w5: 'Friday',
    w6: 'Saturday',
  },
  units: { kcal: 'kcal', g: 'g', h: 'h' },
  workouts: {
    // Header title for the standalone workouts screen.
    screenTitle: 'Workouts',
    title: 'Workouts today',
    summaryEmpty: 'none — add one',
    summary: '−{{kcal}} kcal · {{counted}} kcal into the budget',
    // Segmented control: one input path at a time instead of three open blocks.
    mode: { exact: 'Exact', tracker: 'From tracker', ai: 'Describe' },
    minutes: 'e.g. 30',
    min: 'min',
    kmh: 'km/h',
    speedHint: 'e.g. {{n}}',
    speedOptional: 'Pace is optional. Don’t know it? We’ll use an average.',
    // Strength is logged in sets — no stopwatch needed.
    setsPlaceholder: 'e.g. 12',
    setsUnit: 'sets',
    setsCount: '{{count}} sets',
    setsHint: 'No timing needed: we assume ≈3 min per set (work + rest) and add ≈10% — the body keeps burning after the effort too.',
    // Strength effort → MET (light 3.5 · moderate 5.0 · heavy 6.0). The flat 3.5
    // undershot heavy lifting (device feedback).
    intensity: {
      label: 'Effort',
      light: 'Light',
      moderate: 'Moderate',
      heavy: 'Hard',
    },
    // «By tracker» — the optional import: kcal straight off a watch/tracker, kept
    // verbatim (no MET, no afterburn), marked «by tracker».
    tracker: {
      head: 'Or enter kcal from your watch',
      kcalPlaceholder: 'e.g. 300',
      hint: 'A tracker number is kept as-is, with no recalculation.',
    },
    add: 'Add',
    remove: 'Remove',
    // Same confirm pattern as food and diary deletes: this reshapes the day budget.
    removeConfirmTitle: 'Remove this workout?',
    removeConfirmBody: 'The entry will be deleted and the day budget recalculated.',
    removeCancel: 'Keep it',
    exactHead: 'Enter exactly',
    aiHead: 'Or describe it — AI will parse',
    weightFallback: 'Estimated from {{kg}} kg — log your weight on the Weight screen for accuracy.',
    describeHint: 'e.g. 100 push-ups, then a 20-min run',
    describeAction: 'Parse',
    parsing: 'Parsing…',
    parseAdded: 'Added {{count}} entr(ies). Check the time and burn.',
    parseNone: 'Couldn’t parse that. Refine it, or use the buttons above.',
    parseDeclined: 'Free-text needs AI consent. The buttons above work offline.',
    // Voice note & fitness-tracker screenshot.
    voiceStart: 'Dictate the workout',
    voiceStop: 'Stop recording',
    voiceRecording: 'Recording — tap ■ to finish.',
    voiceFailed: 'Couldn’t record. Try again or type it instead.',
    voiceUnavailable: 'No microphone access. Allow it in your phone settings, or type it instead.',
    micBusy: 'Couldn’t start the microphone — another app may be using it. Try again or type it instead.',
    voiceSilent: 'The recording came out silent — the microphone delivered no sound. Check it in your phone settings and try again, or type it instead.',
    screenshot: 'Workout screenshot',
    photoFailed: 'Couldn’t open the image. Try another screenshot.',
    fromTracker: 'from tracker',
    // Auto-imported session tag + the honest line about its steps: they're in
    // the workout's kcal already, so the budget's step earnings exclude them.
    fromDevice: 'from watch',
    stepsInside: '{{steps}} steps inside — counted in the workout, not in steps',
    trackerAdded: 'Logged from your tracker: {{kcal}} kcal.',
    budgetAck: '✓ Workout logged: +{{kcal}} kcal added to today’s budget.',
    // The short line is always visible; the full math is a tap away («How we count»).
    noteShort: 'Only 75% enters the budget — formulas usually overstate.',
    noteToggle: 'How we count',
    // The 75% line lives in `noteShort`, which stays visible above this — no
    // point repeating it word for word one line lower.
    note: 'Burn is an estimate from type and duration; strength — from sets. Strength and interval work get ≈10% more: the body keeps burning above rest for a while after. A tracker number is saved as-is (“from tracker”). Details — in “How it works”.',
    type: {
      walk: 'Walking',
      run: 'Running',
      cycle: 'Cycling',
      swim: 'Swimming',
      strength: 'Strength',
      hiit: 'HIIT/circuit',
      elliptical: 'Elliptical',
      row: 'Rowing',
      sport: 'Team sport',
      dance: 'Dance',
      martial: 'Martial arts',
      yoga: 'Yoga/stretch',
      other: 'Other',
    },
  },
  // Full labels for axes/gauges; short P/F/C for dense list rows.
  macros: { protein: 'Protein', fat: 'Fat', carbs: 'Carbs', protShort: 'P', fatShort: 'F', carbShort: 'C' },
  bodyMind: {
    // Hero variants: the big sentence carries the direction; the "association,
    // not a cause" framing moves to the hero caption (home.hero.caption).
    hero: {
      accent: '+{{gap}}',
      // v2 — the hero speaks about the strongest honest signal (steps/sleep/protein).
      signal: {
        steps: {
          better: 'On the days you move more, your mood runs about {{gap}} higher out of 10.',
          worse: 'On the days you move less, your mood runs about {{gap}} higher out of 10.',
        },
        sleep: {
          better: 'After the nights you sleep more, your mood runs about {{gap}} higher out of 10.',
          worse: 'After the nights you sleep less, your mood runs about {{gap}} higher out of 10.',
        },
        protein: {
          better: 'On the days you eat more protein, your mood runs about {{gap}} higher out of 10.',
          worse: 'On the days you eat less protein, your mood runs about {{gap}} higher out of 10.',
        },
      },
      signalNoLink: {
        steps: 'No clear link between your steps and your mood yet — and that is honest.',
        sleep: 'No clear link between your sleep and your mood yet — and that is honest.',
        protein: 'No clear link between your protein and your mood yet — and that is honest.',
      },
    },
  },
  weight: {
    title: 'Weight',
    placeholder: 'Weight today',
    unit: 'kg',
    save: 'Save',
    saving: 'Saving…',
    rangeHint: 'Looks like a typo: weight should be between 20 and 400 kg.',
    empty: 'No weight entries yet. Weighing in is optional — no pressure.',
    note: 'Weight is just one signal, and it naturally fluctuates day to day.',
    dbUnavailable: 'Weight is available in a device dev build.',
    trend: {
      steady: 'Over {{days}} days your weight held steady (±{{abs}} kg).',
      down: 'Over {{days}} days your weight is down {{abs}} kg.',
      up: 'Over {{days}} days your weight is up {{abs}} kg.',
    },
    savedNow: '{{kg}} kg — logged ✓',
    savedDelta: '{{kg}} kg — logged ✓ · {{delta}} kg since last time',
    lastEntry: 'Last entry: {{kg}} kg · {{date}}',
    // Hero when there's no weight yet; the input sits right below.
    hero: { empty: 'No weigh-ins yet. Add a weight below — the number and trend appear here.' },
    height: 'Height',
    heightUnit: 'cm',
    plan: {
      title: 'Nutrition plan',
      mode: { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain' },
      // Pace — the one speed lever. 'Standard' is the BMI-aware default
      // (unchanged); 'Gentle'/'Fast' soften/steepen the deficit.
      tempo: {
        label: 'Weight-loss pace',
        soft: 'Gentle',
        standard: 'Standard',
        fast: 'Fast',
      },
      // The same lever for gain: lean +5% / standard +10% / fast +15%.
      tempoGain: {
        label: 'Gain pace',
        soft: 'Lean',
        standard: 'Standard',
        fast: 'Fast',
      },
      intro: {
        lose: 'You weigh {{kg}} kg. To lose about {{pace}} kg a week, you need:',
        maintain: 'You weigh {{kg}} kg. To hold this weight you need about:',
        gain: 'You weigh {{kg}} kg. To gain about {{pace}} kg a week, you need:',
      },
      kcalPerDay: '≈ {{kcal}} kcal a day',
      restNote: 'This is the base — a day with no movement at all. Your steps and workouts add to it on the Food screen.',
      goalWeight: 'Goal weight',
      // Transparency: which kilograms the protein was computed from. Adipose
      // tissue needs almost no protein — at high BMI total weight over-prescribes.
      protBasis: {
        goal: 'Protein is computed from your goal weight of {{kg}} kg: enough for muscle — fat mass needs none.',
        adjusted:
          'Protein is computed from a “working” weight of {{kg}} kg — a calculation basis, not your weight: fat mass barely needs protein. Set a goal weight to base it on that instead.',
      },
      bmrLine:
        'Resting metabolism ≈ {{kcal}} kcal — what your body burns at complete rest, {{method}}. The day’s base sits above it: even a sedentary day burns more.',
      bmrMethod: {
        katch: 'computed from body composition (Katch–McArdle, lean mass)',
        'katch-rfm': 'computed from body composition: fat estimated from waist',
        mifflin: 'computed with the Mifflin–St Jeor formula',
        measured: 'computed from your own data: weight trend and log',
      },
      maintenanceLine: 'Maintenance ≈ {{maintenance}} kcal — what it takes to hold your current weight. Not your target.',
      deltaLine: {
        lose: 'Your target {{kcal}} kcal is {{pct}}% below maintenance: a calm deficit to lose without stress.',
        gain: 'Your target {{kcal}} kcal is {{pct}}% above maintenance: a small surplus to gain.',
      },
      fiber: 'Fiber: ~{{g}} g a day (vegetables, legumes, whole grains) — the main weapon against deficit hunger.',
      etaWeeks: 'To your goal of {{goal}} kg ≈ {{n}} wk at this pace.',
      etaMonths: 'To your goal of {{goal}} kg ≈ {{n}} mo at this pace.',
      floored:
        'The target won’t drop below {{kcal}} kcal — the healthy minimum. Steps and workouts add on top.',
      apply: 'Make this my daily target',
      applied: 'Already your daily target ✓',
      // The save above is skipped without a database — no false «target ✓».
      notSaved: 'Database unavailable — the target was not saved.',
      appliedTick: 'Goal updated ✓',
      recalc: 'The plan recalculates itself after every new weigh-in.',
      needWeight: 'Log a weight above — the plan is computed from it.',
      needProfile: 'Run the quick body setup — height, sex, birth year — and the plan appears here.',
      setupCta: 'Set up my body',
      assumedAge: 'Age isn’t set — this plan is an estimate. Add your birth year in “Body parameters” below to firm up the numbers.',
      overestimateNudge:
        'At your weight the formula overestimates burn by 10–15%. Tap and add your waist — it gets sharper.',
      note:
        'Formulas estimate the “average” person — real needs differ. Start from these numbers and adjust by your weight trend and how you feel. The full math lives on the “How it works” page.',
      why: 'Why these numbers',
      whyHide: 'Hide explanation',
    },
    // Adaptive expenditure: measured from your own data, not a formula — the most
    // accurate "no device" option. Appears only once there's enough history.
    burn: {
      title: 'From your data · {{days}} days',
      value: '≈ {{kcal}} kcal',
      caption: 'your real daily burn',
      explain: 'You ate ≈{{intake}} kcal, weight {{dir}} {{trend}} kg/week. That’s where the burn comes from — measured, not a formula.',
      explainFlat: 'You ate ≈{{intake}} kcal and weight held steady. So that’s about what you burn.',
      dirDown: '↓',
      dirUp: '↑',
      early: 'Not enough data yet. The button appears once there is.',
      note: 'Computed from your log: unlogged food lowers the burn. Workouts need no logging — the scale already sees them. Weigh in under similar conditions.',
      underLogged: 'The burn came out below your resting rate, which isn’t possible. Most likely some food went unlogged. Log more consistently and this becomes usable.',
      apply: 'Use my own data',
      applied: 'Burn is computed from your data',
      appliedTick: 'Saved',
      reset: 'Back to the formula',
      resetTick: 'Formula restored',
    },
    micros: {
      title: 'Vitamins & minerals',
      summary: 'Daily norms',
      lead: 'How much you need per day. This is the requirement — not a count of what you ate.',
      needSex: 'Sex not set — some norms differ for men and women (♂ · ♀). Set it in “Body parameters” to show a single column.',
      groups: { vitamin: 'Vitamins', mineral: 'Minerals' },
      unit: { mg: 'mg', mcg: 'mcg' },
      limit: 'no more than {{limit}}',
      adequateNote: '* adequate-intake guide — there is no firm RDA for this nutrient.',
      source: 'Norms: US IOM / National Academies, adults 19–50; close to WHO guidance.',
      disclaimer:
        'Reference values for a healthy adult. Pregnancy, illness, medication and age change your needs — when in doubt, ask a doctor.',
      name: {
        a: 'Vitamin A',
        d: 'Vitamin D',
        e: 'Vitamin E',
        c: 'Vitamin C',
        b1: 'B1 (thiamin)',
        b2: 'B2 (riboflavin)',
        b6: 'B6 (pyridoxine)',
        b9: 'B9 (folate)',
        b12: 'B12 (cobalamin)',
        ca: 'Calcium',
        fe: 'Iron',
        mg: 'Magnesium',
        zn: 'Zinc',
        k: 'Potassium',
        na: 'Sodium',
        i: 'Iodine',
      },
    },
    sections: {
      body: {
        title: 'Body parameters',
        empty: 'Not filled in — needed for the plan and BMI',
        edit: 'Edit',
        fatUnset: 'not set',
        waistUnset: 'not set',
      },
      history: { title: 'History', count: 'Entries: {{count}}' },
      manual: { title: 'Manual targets', summary: '{{kcal}} kcal · P {{prot}} · F {{fat}} · C {{carb}}' },
    },
    bmi: {
      title: 'BMI',
      value: 'BMI {{value}} — {{category}}',
      summary: '{{value}} — {{category}}',
      needHeightShort: 'add height',
      needWeightShort: 'log a weight',
      current: 'From your latest weight {{kg}} kg and height {{cm}} cm.',
      category: {
        underweight: 'below the normal range',
        normal: 'within the normal range',
        overweight: 'above the normal range',
        obese1: 'obesity class I',
        obese2: 'obesity class II',
        obese3: 'obesity class III',
      },
      ranges: 'WHO bands: under 18.5 · 18.5–25 · 25–30 · 30+.',
      needHeight: 'Add your height under “Body parameters” — BMI is computed from height and the latest weight.',
      needWeight: 'Log a weight above — BMI is computed from height and the latest weight.',
      disclaimer:
        'BMI cannot tell muscle from fat and describes the “average” person, not you. A reference point, not a verdict.',
    },
    targets: {
      savedTick: 'Saved ✓',
      note: 'Saves itself. These targets show up on Food; hidden while you are on a break.',
    },
    formula: {
      sex: 'Sex',
      male: 'Male',
      female: 'Female',
      birthYear: 'Birth year',
      bodyFat: 'Body fat %',
      waist: 'Waist',
    },
    // History-row provenance: typed by hand vs smart scale (via Health /
    // Health Connect). Always visible — no silent magic.
    source: {
      manual: 'Entered by hand',
      device: 'From your device',
    },
    // Scale-measured body fat. NEVER feeds the calculation silently — only via
    // the explicit “Use in the calculation” tap.
    deviceFat: {
      line: '≈ {{pct}} % body fat — from your device, {{date}}',
      apply: 'Use in the calculation',
      applied: 'Used in the daily-target calculation ✓',
    },
  },
  // Connect card for the EXTENDED device import (weight & body fat from a smart
  // scale, workouts from a watch, night signals). One flag lights everything;
  // the degraded states mirror the automatic-steps card.
  device: {
    connect: 'Connect',
    connecting: 'Connecting…',
    connectedNow:
      'Device import is on. If data doesn’t appear, check access in Health / Health Connect.',
    installAction: 'Open Health Connect on Google Play',
    state: {
      denied:
        'Access not granted — import stays off. You can allow reading in Health / Health Connect.',
      unavailable: 'Health / Health Connect isn’t available on this device.',
      update_required: 'Health Connect needs an update before it can grant access.',
      unsupported: 'Device import isn’t available in this build.',
    },
    weightExplainer:
      'A smart scale can log weight and body fat % by itself — via Health (iPhone) or Health Connect (Android), where the scale’s app writes them. Read-only access; data stays on your device.',
    workoutExplainer:
      'Watch workouts can appear here by themselves — via Health / Health Connect. Kcal comes from your device, and steps inside a workout are never counted twice as steps. Read-only access; data stays on your device.',
  },
  // Night signals from the device (mood screen). Informational — they never
  // feed the calorie math. HRV is labeled with its method: iOS measures SDNN,
  // Android RMSSD — different quantities, never shown as one number.
  night: {
    title: 'Night — from your device',
    restingHr: 'Resting heart rate',
    bpm: 'bpm',
    hrv: {
      sdnn: 'Variability (SDNN)',
      rmssd: 'Variability (RMSSD)',
    },
    ms: 'ms',
    spo2: 'Oxygen SpO₂',
    respRate: 'Breathing',
    perMin: '/min',
    note: 'Informational, not medical data. Never part of the calorie math.',
  },
  steps: {
    placeholder: 'Steps today',
    unit: 'steps',
    // Declension next to a CONCRETE number (the bare `unit` stays the label
    // beside inputs); picked via [pluralKey] — en only branches on 1.
    unitOne: 'step',
    unitFew: 'steps',
    unitMany: 'steps',
    save: 'Save',
    saving: 'Saving…',
    note: 'A number you enter by hand always wins — the automatic count never overwrites it.',
    empty: 'No step entries yet. Enter a number by hand or connect automatic counting.',
    dbUnavailable: 'Steps are available in a device dev build.',
    auto: {
      title: 'Automatic count',
      explainer: 'Connect Health Connect (Apple Health on iPhone) and Driftora reads your daily step count for you. Read-only access to steps and sleep; the data stays on your device and is never sent anywhere.',
      connect: 'Connect',
      connecting: 'Connecting…',
      connected: 'Connected. Your daily steps will be counted automatically.',
      denied: 'Access not granted. Allow step reading in Health / Health Connect — or keep entering by hand.',
      unavailable: 'Health / Health Connect isn’t available on this device. Enter steps by hand.',
      update_required: 'Health Connect needs an update before it can grant access. Update it and try again.',
      unsupported: 'Automatic step counting isn’t available in this version of the app. Enter steps by hand.',
      installAction: 'Open Health Connect in Google Play',
    },
    source: {
      manual: 'Entered by hand',
      device: 'Automatic',
    },
  },
  // "Steps" screen: today's count is the hero, automatic counting (Health Connect)
  // is the primary path, manual entry is folded away as a fallback. Workouts have
  // their own screen now.
  activity: {
    title: 'Steps',
    // Follows the hero NUMBER, so it declines with it (via [pluralKey]).
    todayOne: 'step today',
    todayFew: 'steps today',
    todayMany: 'steps today',
    // Screen is open but there's no automatic or manual number for today yet.
    noneToday: 'No steps logged for today yet — connect automatic counting or enter them by hand.',
    // Honest «steps → budget» payoff, right on the screen that owns steps.
    earned: '≈ {{kcal}} kcal above resting from steps',
    inBase: 'The first ~3,000 are already in the base — the budget grows above that',
    // Steps inside imported workouts: the budget counts them as workout kcal,
    // so the step earnings exclude them.
    inWorkouts: '−{{steps}} inside workouts — counted there',
    vo2max: 'VO₂max ≈ {{value}} — from your watch',
    autoConnected: 'Automatic counting is on — your daily steps are read for you',
    manualAdd: 'Enter by hand',
    historySection: 'History',
  },
  mood: {
    title: 'Mood & diary',
    prompt: 'How are you right now?',
    // Scale direction lives in anchors under the ends (0⟷10) instead of a
    // separate caption line — shorter and clearer.
    anchorLow: 'very low',
    anchorHigh: 'great',
    showAll: 'Show all days ({{count}})',
    // History collapses by day; this labels how many check-ins a day holds. The
    // ru plural split (one/few/many) reuses the same key stems — in English few
    // and many both read as the plural form.
    marksOne: '{{count}} check-in',
    marksFew: '{{count}} check-ins',
    marksMany: '{{count}} check-ins',
    empty: 'No mood check-ins yet.',
    dbUnavailable: 'Mood is available in a device dev build.',
  },
  food: {
    // Unified with the home input bar (home.foodBar.placeholder) and the
    // add button — everywhere "Log food".
    title: 'Log food',
    // "Food today" screen: list of entries + view/edit/delete.
    todayTitle: 'Food today',
    add: 'Log food',
    entryTitle: 'Entry',
    entryLabel: 'What it was',
    update: 'Save changes',
    delete: 'Delete entry',
    deleteTitle: 'Delete this entry?',
    deleteConfirm: 'The entry and its items will be removed from this device. This cannot be undone.',
    deleteCancel: 'Keep it',
    untitled: 'Untitled',
    emptyDay: 'Nothing logged today yet. Add something whenever you are ready.',
    repeat: 'Log again',
    repeatNow: 'Log again now',
    repeated: 'Logged again ✓',
    day: {
      title: 'Today',
      kcal: '{{eaten}} of {{target}} kcal',
      kcalApprox: '{{eaten}} of ≈{{target}} kcal',
      // Hero labels next to the big number: what's left of the budget, or —
      // when over — how much above plan (calm, no red).
      left: 'kcal left',
      overBy: 'kcal over plan',
      onPlan: 'on plan ✓',
      over: 'over plan today',
      restBase: 'base {{kcal}}',
      stepsPart: 'steps {{steps}} +{{kcal}}',
      stepsForecastPart: 'steps ≈{{steps}} (your usual) +{{kcal}}',
      // Some steps happened inside watch-imported workouts — they already count
      // in “workouts +N”, so the step earnings exclude them. Always visible.
      stepsPartCut: 'steps {{steps}} (−{{cut}} in workouts) +{{kcal}}',
      stepsAllInWorkouts: 'steps — {{cut}} inside workouts, counted there',
      workoutsPart: 'workouts +{{kcal}}',
      minPart: 'not below {{kcal}}',
      forecastNote: 'Today’s steps aren’t logged yet — the budget stands on your usual count. Enter your steps and it firms up.',
      noMovement: 'These are calories without activity. Steps and workouts help compute the precise number.',
      stepsBelowBase: 'Steps today — {{steps}}: the first ~3000 are already in the base; the budget grows above that.',
      noMovementCta: 'add movement',
      how: 'how is the budget computed?',
    },
    parseIssue: {
      offline: 'Looks like there’s no internet — this was counted from the built-in table, rougher numbers than usual. Try again once you’re back online.',
      offlineEmpty: 'Looks like there’s no internet, and the built-in table doesn’t know this food. Try again once you’re back online.',
      offlineMedia: 'Looks like there’s no internet. Photos and voice need a connection — try later, or describe the food in words.',
      failed: 'Couldn’t parse this. Check your connection and try again.',
    },
    entryGone: 'This entry has already been deleted.',
    prompt: {
      morning: 'What was breakfast?',
      midday: 'What was lunch?',
      evening: 'What was dinner?',
      lateNight: 'A little something to eat?',
    },
    // Section headers in the "food today" list — meals of the day.
    meal: {
      breakfast: 'Breakfast',
      lunch: 'Lunch',
      snack: 'Snack',
      dinner: 'Dinner',
    },
    // Meal chips on the log/edit screens: the clock only suggests, the user decides.
    mealPick: { label: 'Meal' },
    parse: 'Add up',
    parsing: 'Adding up…',
    // Capture-method segmented control: the text field stays; only the secondary
    // row (mic/photo) swaps — mirrors the workout screen.
    inputMode: {
      text: 'Text',
      voice: 'Voice',
      photo: 'Photo',
    },
    // One quick-pick lane instead of three headers (yesterday/favorites/recent).
    quickPick: 'Quick',
    // Collapsed approximation caveats under the total — the «≈» badge already shows.
    whyApprox: {
      show: 'Why approximate',
      hide: 'Hide',
    },
    voice: '🎤 Say it',
    audioLevel: 'audio level',
    entryNoItems: 'No items in this entry',
    voiceListening: '● Listening… tap to stop',
    // A clear reason when recognition cuts out (whatever was already transcribed
    // stays in the field — edit it and tap “Parse”).
    voiceError: {
      'no-speech': 'Didn’t catch any speech. Try again or type it in.',
      'speech-timeout': 'Too quiet or a long pause. You can finish typing.',
      network: 'No connection for recognition. Check the internet or type it in.',
      'not-allowed': 'No microphone access. Allow it in settings.',
      'language-not-supported': 'No speech recognition for this language. Type it in.',
      'audio-capture': 'Couldn’t record from the mic. You can type instead.',
      busy: 'Recognition is busy. Wait a second and try again.',
      aborted: 'Recognition stopped. What you said is kept — carry on.',
      unknown: 'Couldn’t recognize it. What you said is kept — finish by typing.',
      unavailable: 'Voice input isn’t available on this device. Typing works too.',
      // Permission granted, but the recorder wouldn't start (mic busy/OS hiccup).
      'mic-failed': 'Couldn’t start the microphone — another app may be using it. Try again.',
      // The clip recorded, but it's silence: mic muted in the system or held.
      silent: 'The recording came out silent — the microphone delivered no sound. Check it isn’t turned off in your phone settings or held by another app, and try again.',
    },
    voiceNote: '🎙 Record a voice note',
    voiceRecording: '● Tap to finish recording',
    voiceProcessing: 'Processing your clip…',
    photo: '📷 Camera',
    photoLibrary: '🖼 From gallery',
    photoError: 'Couldn’t process that photo. Try another one, or type the meal instead.',
    // Multi-select photos: each dish its own entry, reviewed one at a time.
    batchProgress: 'Photo {{index}} of {{total}}',
    batchSkip: 'Skip photo',
    saveFailed: 'Didn’t save — please try again.',
    save: 'Save',
    saving: 'Saving…',
    clear: 'Start over',
    savedWarm1: 'Logged. Noticing what you eat is already self-care',
    savedWarm2: 'Noted. Thanks for keeping track',
    savedWarm3: 'Saved. A small step is care too',
    savedWarm4: 'Done. You noticed this meal — that’s the skill',
    empty: 'Describe your meal and tap “Add up”.',
    total: 'Total',
    hideCalories: 'Hide calories — keep protein only',
    showCalories: 'Show calories and macros',
    needHelp: 'Could not recognize it. Add more detail.',
    // Switch to another DB match when the wrong food was picked.
    alternatives: {
      promptCount: 'Similar matches ({{count}})',
      hide: 'Hide options',
    },
    matchedPick: 'system pick',
    // Manual DB search — find and replace the food yourself.
    manualSearch: {
      open: 'Find it manually',
      hide: 'Hide search',
      placeholder: 'Food name',
      action: 'Search',
      searching: 'Searching…',
      empty: 'Nothing found',
    },
    dbUnavailable: 'The database is only available in a device dev build.',
    favorites: 'Favorites',
    recent: 'Recent',
    sameAsYesterday: 'Same as yesterday',
    // «From my diet»: foods you've already confirmed — pick one and type the grams.
    myDiet: 'From my diet',
    myDietHint: 'Pick a food and type the grams — the exact macros are already saved.',
    per100: 'per 100 g',
    // Provenance: which DB row the numbers came from (so «what did it return?»
    // can't happen — the user sees the real match, not their own words echoed).
    matchedAs: 'In database: {{name}}',
    approx: '≈ approx',
    disclaimer:
      'Per-100 g figures come from the database. Until the weight is confirmed, the dish total is approximate.',
    grams: 'Weight',
    // Editing a single dish inside a saved entry.
    removeItem: 'Remove dish',
    replaceItem: 'Replace with another',
    // The user never named a weight — say honestly this is our guess.
    gramsEstimated: '≈ the weight is our guess at a typical portion. Adjust it if you know better.',
    gramsEstimatedShort: '≈ weight is our guess — adjust it',
    // Prominent note above the chips: no weight given, show the assumed one and
    // invite a fix (the weight drives the whole number).
    gramsGuessed: 'No weight given — assumed {{grams}} g. Adjust if your portion differs.',
    forGrams: 'per {{grams}} g',
    otherOption: {
      open: 'Other option',
      openCount: 'Other option ({{count}})',
      hide: 'Collapse',
    },
    // Cooking method — neutral, never "healthier/worse".
    estimateNote: 'Items not in our database aren’t counted in the total. Enter their macros to include them.',
    // Every item missed the DB: one plain line instead of a zero «Total» card.
    totalAllMisses: 'No total yet — this food isn’t in the database. Enter its macros above or find a close match manually.',
    aiEstimateNote: 'Some numbers are a rough AI estimate (not in our database). They’re counted in the total — adjust the weight or enter macros for accuracy.',
    notInDb: 'This food isn’t in the database, so no numbers are filled in. Enter its calories and macros per 100 g — from the label, say — or find a close match manually.',
    // Honest note: label numbers are for the DRY product vs. a cooked-dish weight.
    dryBasis:
      'These numbers are for the dry product. If the weight is for the cooked dish, calories are overstated roughly 3×. Enter the dry weight, or search manually for a “cooked” match. We never rewrite the numbers.',
    refereeMismatch:
      'This looks like the wrong product: the figures are far from what’s expected for this dish. Pick an option below — an AI estimate is included.',
    // Vitamins & minerals for the whole dish, as a share of the daily norm (bars).
    microsDish: {
      show: 'Vitamins & minerals for this dish',
      hide: 'Hide vitamins & minerals',
      note: 'Shown as % of the daily norm. Black tick — the norm, amber — the upper limit. Only what the source actually gives; we don’t invent zeros.',
      needSex: 'Set your sex on the Weight screen — the norms for iron and some vitamins differ by sex.',
      estimated: 'Some vitamins/minerals are a proxy from the USDA database matched by name, not this exact product’s values.',
    },
    enterMacros: 'Enter per 100 g:',
    source: {
      usda: 'from USDA',
      skurikhin: 'from Skurikhin tables',
      openfoodfacts: 'from Open Food Facts',
      apininjas: 'from API Ninjas',
      fatsecret: 'from FatSecret',
      label: 'from package label',
      ai_estimate: '≈ AI estimate',
      estimate: 'estimate (not in DB)',
      manual: 'entered manually',
      history: 'from your log',
    },
    micros: {
      title: 'Vitamins & minerals',
      count: 'measured: {{n}}',
      none: 'no data',
      coverage: 'Counted from {{withData}} of {{total}} meals today.',
      coverageNote:
        'Some foods carry no micronutrient data — they aren’t included. Read this as “at least this much”.',
      needSex: 'Set your sex on the Weight screen — iron and several vitamin norms differ for men and women.',
      empty:
        'Today’s foods carry no micronutrient data — common for many local dishes. Log foods with data and the bars appear.',
      ofNorm: '{{pct}}% of norm',
      normsHint: 'The dark tick is the daily norm, the amber tick the safe upper limit. The full norm table is on the Weight screen.',
    },
    detail: {
      show: 'Full composition',
      hide: 'Hide composition',
      basis: 'Per {{grams}} g, as reported by the source. Fields the DB lacks are simply absent — we never invent zeros.',
      totalsNote: 'Summed only over items with data — read it as “at least this much”.',
      label: {
        fiber: 'Fiber',
        sugar: 'Sugar',
        satFat: 'Saturated fat',
        na: 'Sodium',
        k: 'Potassium',
        ca: 'Calcium',
        mg: 'Magnesium',
        fe: 'Iron',
        zn: 'Zinc',
        vitA: 'Vitamin A',
        vitD: 'Vitamin D',
        vitE: 'Vitamin E',
        vitC: 'Vitamin C',
        vitB1: 'B1 (thiamin)',
        vitB2: 'B2 (riboflavin)',
        vitB6: 'B6 (pyridoxine)',
        vitB9: 'B9 (folate)',
        vitB12: 'B12 (cobalamin)',
      },
      unit: { g: 'g', mg: 'mg', mcg: 'mcg' },
    },
  },
  diary: {
    listTitle: 'Thought diary',
    newTitle: 'New entry',
    entryTitle: 'Entry',
    add: 'New entry',
    edit: 'Edit entry',
    update: 'Save changes',
    delete: 'Delete entry',
    deleteTitle: 'Delete this entry?',
    deleteConfirm: 'This entry will be removed from this device. This cannot be undone.',
    deleteCancel: 'Keep it',
    deleteError: 'Couldn’t delete the entry. Please try again.',
    empty: 'No entries yet. The first one is the hardest — and the most useful.',
    notFound: 'Entry not found.',
    emptyValue: '—',
    dbUnavailable: 'The diary is available in a device dev build.',
    back: 'Back',
    next: 'Next',
    save: 'Save',
    saveExit: 'Save & exit',
    // Exit guard for the stepper — typed-in work must not vanish on a stray back.
    discardTitle: 'Entry not saved',
    discardBody: 'If you leave now, what you typed will be lost.',
    discardStay: 'Stay',
    discardLeave: 'Leave without saving',
    saving: 'Saving…',
    progress: 'Step {{current}} of {{total}}',
    moodShort: 'Mood',
    moodShiftCaption: 'mood: before → after',
    fields: {
      moodBefore: 'Mood before the record',
      moodAfter: 'Mood after',
    },
    distortions: {
      label: 'Thinking distortions (if any fit)',
      all_or_nothing: 'All-or-nothing',
      overgeneralization: 'Overgeneralization',
      mental_filter: 'Mental filter',
      disqualifying_positive: 'Discounting the positive',
      mind_reading: 'Mind reading',
      fortune_telling: 'Fortune telling',
      catastrophizing: 'Catastrophizing',
      emotional_reasoning: 'Emotional reasoning',
      shoulds: 'Should statements',
      labeling: 'Labeling',
      personalization: 'Personalization',
    },
    trap: {
      title: 'Trap of the week',
      body: 'Most common this week: {{name}} ({{count}}). Noticing it is half the work.',
    },
    assist: {
      // On-device CBT nudges (A1). Distortion-awareness + reframe prompts only —
      // never "just think positive".
      title: 'A gentle nudge',
      dismiss: 'Hide',
      recurringDistortion:
        '"{{name}}" has come up often this week ({{count}}). Want to try a balanced reframe of a thought like that?',
      highIntensity:
        'A few entries carried very strong emotions. A calm look at the evidence for and against can take some of the heat out.',
      missingReframe:
        'Your latest entry has no reframe yet. One step — seeing the thought from the outside — often shifts how it feels.',
      crisis:
        'This looks like a really hard moment. You are not alone. If you can, reach out to someone you trust or a professional — that is okay, and it matters.',
    },
    export: {
      title: 'Thought diary — summary',
      button: 'Share summary',
    },
    emotion: {
      name: 'Emotion',
      intensityLabel: 'Intensity',
      low: 'Mild',
      mid: 'Medium',
      high: 'Strong',
      max: 'Intense',
      add: 'Add',
      remove: 'Remove emotion {{name}}',
    },
    reaction: {
      body: 'Body',
      bodyPlaceholder: 'e.g. tightness in the chest',
      behavior: 'Behavior',
      behaviorPlaceholder: 'e.g. went quiet and left',
    },
    evidence: {
      thoughtRecall: 'Weighing this thought',
      thoughtRecallEmpty: 'No thought written yet — you can step back and add it.',
      for: 'For',
      forPlaceholder: 'Facts that support the thought',
      against: 'Against',
      againstPlaceholder: 'Facts that contradict the thought',
    },
    reframePlaceholder: 'e.g. one setback does not undo my work',
    steps: {
      situation: {
        title: 'Situation',
        hint: 'What happened? Describe the facts without judgment.',
        placeholder: 'e.g. got criticized in a meeting',
      },
      thoughts: {
        title: 'Thoughts',
        hint: 'What automatic thoughts went through your mind?',
        placeholder: 'e.g. “I failed completely”',
      },
      emotions: {
        title: 'Emotions',
        hint: 'Name the emotions and rate their intensity.',
      },
      reaction: {
        title: 'Reaction',
        hint: 'What did you feel in your body, and how did you act?',
      },
      evidence: {
        title: 'Evidence',
        hint: 'Facts for and against the anxious thought.',
      },
      reframe: {
        title: 'Balanced view',
        hint: 'A more balanced thought — and your mood right now.',
      },
    },
  },
  settings: {
    title: 'Settings',
    site: 'Our site',
    pause: 'Take a break',
    goalsSection: 'Goals & reminders',
    foodSection: 'Nutrition',
    displaySection: 'Display',
    dataSection: 'Data & privacy',
    privacyHero: 'Your data stays only on this phone, in an encrypted database.',
    privacyHeroLead: 'Only food and workout parsing goes online — to OpenRouter, USA. Diary, mood and weight never do.',
    pauseNote: 'Mutes goals, reminders and auto-wins — no guilt. Your entries stay; resume any time.',
    targetKcal: 'Calories (kcal)',
    targetProtein: 'Protein (g)',
    targetFat: 'Fat (g)',
    targetCarb: 'Carbs (g)',
    targetsMoved: 'Macro targets are on the Weight screen (with BMI and the formula).',
    buildInfo: 'Build: {{info}}',
    stepsGoal: 'Steps goal',
    reminders: 'Reminders',
    reminderAdd: 'Time (HH:mm)',
    reminderAddBtn: 'Add',
    reminderRemove: 'Remove reminder {{time}}',
    // Honesty: no OS permission → the promised «Next reminder» will never fire.
    notifDenied: 'Notifications for Driftora are off in the system — reminders will not arrive. Tap to open settings.',
    // Exit guard: toggles and fields here only apply on Save.
    unsavedTitle: 'Changes not saved',
    unsavedBody: 'Go back and tap “Save” to apply them.',
    unsavedStay: 'Stay',
    unsavedLeave: 'Leave without saving',
    remindersNote: 'Fire when the app is allowed to send notifications. A break turns them off.',
    nextReminder: 'Next: {{when}}',
    contextualNudges: 'Smart movement nudges (optional)',
    contextualNudgesNote: 'If you’re moving less than usual, the app gently suggests a short walk. At most once a day, computed on your phone.',
    today: 'today',
    tomorrow: 'tomorrow',
    aiToggle: 'AI food recognition',
    aiOff: 'Off. Text is counted from the built-in table; photos and voice aren’t recognized. Turn on to parse food and workouts via AI.',
    aiOn: 'On. Food and workout descriptions, photos and voice go to OpenRouter (USA). Turn off to keep text-only counting from the built-in table.',
    hideCalories: 'Hide calories (focus on protein and habits)',
    llmDiaryAssist: 'Gentle diary hints (optional, off by default). Computed on the phone, nothing is sent anywhere.',
    showPopulationStats: 'Step reference comparison (optional)',
    showPopulationStatsNote: 'Shows your step average next to research reference points — not a leaderboard. Off by default: comparison doesn’t help everyone.',
    regionTitle: 'Nutrition region',
    region_auto: 'Auto',
    region_RU: 'Russia',
    region_US: 'USA',
    regionNote: 'Which nutrition database parses your food. “Auto” follows the device language.',
    storage: 'Storage',
    storageEncrypted: 'Encrypted',
    storageUnencrypted: 'Not encrypted',
    storageUnencryptedNote: 'Encrypted storage didn’t start on this device, so data sits in a plain database for now. The installed app should read “Encrypted” here; this usually happens only in a test run.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved ✓',
    dbUnavailable: 'Settings are available in a device dev build.',
  },
  notifications: {
    reminderTitle: 'Driftora',
    reminderBody: 'A minute for you — log your mood or steps.',
    nudge: {
      moodWalkTitle: 'A short walk?',
      moodWalkBody: 'If today feels heavy, a short walk gently steadies your nervous system and mood. No pressure.',
      afternoonWalkTitle: 'Stretch your legs?',
      afternoonWalkBody: 'You’ve moved a little less than usual today. 10 minutes on foot eases both heart and head.',
      eveningWalkTitle: 'An evening step',
      eveningWalkBody: 'The day’s almost done. A short stroll is a pleasant way to close it out.',
    },
  },
  wins: {
    title: 'Wins',
    add: 'Add a win',
    // Short one-line example — a long placeholder wraps and clips in the
    // single-line field, reading like stale prefilled text.
    addPlaceholder: 'e.g. walked 8,000 steps',
    empty: 'No wins yet — mark your first one, however small.',
    share: 'Share',
    dbUnavailable: 'Wins are available in a device dev build.',
    totalLabel: 'Wins so far',
    streak: '{{days}} days running',
    quick: {
      walk: 'Took a walk',
      sleep: 'Slept well',
      cooked: 'Cooked at home',
      mood: 'Handled stress',
    },
    auto: {
      stepsGoal: 'Daily step goal reached — {{steps}} {{stepsWord}} 🎉',
      stepsGoal2: 'Step goal done today — {{steps}} {{stepsWord}}. Your legs carried you 🎉',
      stepsGoal3: '{{steps}} {{stepsWord}} — daily goal taken. Your body thanks you 🚶',
      stepsGoal4: 'Done: {{steps}} {{stepsWord}} today. A small win that counts ✨',
      proteinGoal: 'Protein goal reached — {{protein}} g 💪',
      proteinGoal2: 'Protein goal done — {{protein}} g. Muscle supported 💪',
      proteinGoal3: '{{protein}} g protein — goal met. Satiety and strength up 🍳',
      proteinGoal4: 'Done: {{protein}} g protein today. A good habit growing 🌱',
    },
  },
  review: {
    title: 'Weekly review',
    dbUnavailable: 'The review is available in a device dev build.',
    totalLabel: 'Days logged',
    streak: 'Streak: {{weeks}} weeks running',
    reassurance: 'Days without entries are fine. Progress is a process, not a perfect streak.',
    deltaCaption: 'On the right — change vs last week.',
    avgSection: 'Average per day',
    totalSection: 'This week',
    delta: '{{change}}',
    deltaSame: 'no change',
    norms: {
      title: 'Where your week stands on steps',
      building: 'Your weekly average is {{avg}} steps/day. Around 7,000 is where risk reductions show up; about {{gap}} more a day to get there.',
      approaching: 'Your average is {{avg}} steps/day — close to the ~7,000 reference where benefit grows fastest (~{{gap}} more a day).',
      beneficial: 'Your average is {{avg}} steps/day — already in the zone of clear benefit for heart, brain and stress.',
      ample: 'Your average is {{avg}} steps/day — more than enough by the evidence. More is not necessarily “better”.',
      source: '“10,000” is marketing, not medicine: the research reference is about 7,000 a day (Lancet, 2025). Compare yourself with yourself.',
    },
    metrics: {
      steps: 'Steps',
      protein: 'Protein',
      kcal: 'Calories',
      foodDays: 'Days with food',
      diary: 'Diary entries',
      wins: 'Wins',
    },
  },
  // Phase 1: local encrypted backup & restore (no server). The copy stays honest
  // about the one hard limit of real E2E — lose the key, lose the data.
  backup: {
    title: 'Backup',
    openRow: 'Backup & restore',
    openRowNote: 'An encrypted copy of all your data, saved to your own cloud. Helps if you lose your phone.',
    // Hero — the privacy anchor (encrypted + honest that without the phrase even
    // we can't open it). Folds in the former `intro` and `safetyNote`.
    heroText: 'The copy is encrypted with your key.',
    heroLead: 'Without your phrase, not even we can open it.',
    backupTitle: 'Create a backup',
    backupExplainer: 'The Share sheet opens — pick a cloud (iCloud, Google Drive). Nothing is sent to our server.',
    backupCta: 'Create backup',
    restoreTitle: 'Restore',
    restoreExplainer: 'Pick a backup file you saved — your data is decrypted on this device and comes back.',
    restoreReplaceWarning: 'Warning: restoring replaces all current data on this device with the backup’s contents.',
    restoreCta: 'Restore from file',
    restoreConfirm: 'Restore',
    restoreCancel: 'Cancel',
    working: 'Working…',
    shareTitle: 'Save your backup',
    backupDone: 'Backup created. Save the file somewhere safe.',
    savedLocally: 'Backup saved locally: {{path}}',
    backupError: 'Could not create the backup. Check your available storage and try again.',
    restoreDone: 'Your data was restored from the backup.',
    restoreError: 'Could not restore from the file. Make sure you picked a valid backup file and try again.',
    restoreWrongKey: 'This file could not be decrypted with this device’s key. A backup made on another phone can’t be restored yet (cross-device key transfer comes later).',
    dbUnavailable: 'Backup is available in a device dev build.',
    // Phase 3: server-backed E2E sync. Off by default; honest that the data is
    // stored encrypted and the server can't read it.
    sync: {
      title: 'Sync across devices',
      toggle: 'Sync through our server',
      explainer:
        'Your data is encrypted on this device with your key, and only then is the encrypted copy sent to our server. We store just the encrypted file and cannot read it — the key stays with you. Sign-in is proven with your key, not a password.',
      on: 'Sync is on. An encrypted copy will be sent to the server and downloaded on your other devices.',
      off: 'Off. Until you turn sync on, nothing is sent to the server — your data stays only on this device.',
      limitNote:
        'The server only ever sees the encrypted file and metadata (when it was updated, its size, a device id). It cannot be decrypted without your key — not even by us.',
    },
  },
  // Phase 2: user-held recovery fallback (recovery phrase + key-file) so a backup
  // restores on a NEW device with no server. The copy stays honest about the hard
  // E2E limit: lose both the phrase and the key-file and the data is gone.
  recovery: {
    // Unskippable save-gate, shown when creating a backup.
    gate: {
      title: 'Save your recovery phrase',
      warning:
        'Without a saved phrase or key-file, no one can restore your data — not even us. That is the price of real end-to-end encryption: only you hold the key.',
      phraseLabel: 'Your recovery phrase (write it down)',
      exportKeyFile: 'Save key-file',
      exportAgain: 'Save key-file again',
      exportHint:
        'You can also save a key-file to a password manager or Files — a power-user alternative to the phrase.',
      savedAck: 'I have written down the recovery phrase somewhere safe',
      confirmLabel: 'Confirm: enter the requested groups',
      groupN: 'Group {{n}}',
      groupPlaceholder: '6 characters',
      confirmError: 'The groups do not match. Check that you copied the phrase correctly.',
      proceed: 'Create backup',
      working: 'Creating…',
      cancel: 'Cancel',
    },
    // New-device restore: prompt for the recovery phrase.
    restore: {
      title: 'Enter your recovery phrase',
      body: 'This device has no key yet. Enter the recovery phrase from this backup to decrypt your data.',
      placeholder: 'e.g. abc123 — def456 — ghi789 — jkl012',
      submit: 'Restore',
      wrongPhrase: 'Wrong recovery phrase. Check it and try again.',
      cancel: 'Cancel',
    },
    // Power-user key-file path (export/import the raw key as JSON).
    keyFile: {
      title: 'Key-file (advanced)',
      teaser: 'The same recovery as the phrase, as a file.',
      explainer:
        'A key-file is the same recovery as the phrase, just as a file. Save it instead of the phrase, or import it on a new device. Anyone who gets this file can decrypt your backups — keep it like a password.',
      exportCta: 'Export key-file',
      importCta: 'Import key-file',
      shareTitle: 'Save your key-file',
      imported: 'Key imported. You can now restore a backup made with this key.',
      exportError: 'Could not export the key-file. Please try again.',
      importError: 'Could not import the key-file. Check the file and try again.',
    },
    // Errors from key-file import (codes map to recovery.ts RecoveryFileError).
    keyFileError: {
      invalidFormat: 'Invalid file format. It must be a driftora-key.json key-file.',
      noPrivateKey: 'The file has no private key.',
      noPublicKey: 'The file has no public key.',
      mismatch: 'The key-file is corrupt: the keys do not match.',
    },
  },
  // Phase 2 (native): biometric unlock + platform key custody (iCloud Keychain /
  // Google Block Store) so a new phone in the same ecosystem restores the data with
  // no phrase to type. The phrase / key-file remain the cross-ecosystem fallback.
  keysync: {
    biometricReason: 'Confirm it’s you to unlock your encryption key.',
    gateFailed: 'Could not confirm it’s you. Try again, or use your recovery phrase.',
    autoRestored:
      'Your key was restored from your account (iCloud Keychain / Google) — data decrypted with no phrase.',
  },
} as const;
