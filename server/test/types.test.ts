import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assembleMealDraft,
  coercePer100,
  emptyMealDraft,
  crossCheckLabel,
  normalizeIdentified,
  parsePanelText,
  normalizeParsedWorkoutPhoto,
  normalizeParsedWorkouts,
  scaleToGrams,
  sumNutrients,
  type NutritionItem,
  type Per100,
} from '../src/types.js';

const chicken: Per100 = {
  source: 'usda',
  kcal: 165,
  prot: 31,
  fat: 3.6,
  carb: 0,
  minerals: { na: 74, k: 256, fe: 1 },
};

test('scaleToGrams: per100 * grams / 100, minerals rounded to whole mg', () => {
  const s = scaleToGrams(chicken, 150);
  assert.equal(s.kcal, 248); // 165 * 1.5 = 247.5 → 248
  assert.equal(s.prot, 46.5);
  assert.equal(s.fat, 5.4);
  assert.equal(s.carb, 0);
  assert.deepEqual(s.minerals, { na: 111, k: 384, fe: 2 }); // 74*1.5, 256*1.5, 1*1.5→2
});

test('scaleToGrams: 100 g is identity (rounded)', () => {
  const s = scaleToGrams(chicken, 100);
  assert.equal(s.kcal, 165);
  assert.equal(s.prot, 31);
});

test('sumNutrients adds macros and merges minerals across items', () => {
  const items = [
    { scaled: scaleToGrams(chicken, 100) },
    { scaled: scaleToGrams({ ...chicken, minerals: { na: 10, ca: 20 } }, 100) },
  ];
  const total = sumNutrients(items);
  assert.equal(total.kcal, 330);
  assert.equal(total.prot, 62);
  assert.deepEqual(total.minerals, { na: 84, k: 256, fe: 1, ca: 20 });
});

test('assembleMealDraft: any estimated item → approximate + portion_state estimated', () => {
  const items: NutritionItem[] = [
    {
      name_ru: 'курица', name_en: 'chicken', grams: 150, grams_source: 'estimated',
      confidence: 0.9, per100: chicken, scaled: scaleToGrams(chicken, 150), approximate: true,
    },
  ];
  const draft = assembleMealDraft('US', items);
  assert.equal(draft.approximate, true);
  assert.equal(draft.portion_state, 'estimated');
  assert.equal(draft.flags.has_estimate, false);
  assert.equal(draft.flags.low_confidence, false);
  assert.equal(draft.totals.kcal, 248);
});

test('assembleMealDraft: confirmed grams + DB miss + low confidence flags', () => {
  const est: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };
  const items: NutritionItem[] = [
    {
      name_ru: 'нечто', name_en: 'thing', grams: 100, grams_source: 'confirmed',
      confidence: 0.3, per100: est, scaled: scaleToGrams(est, 100), approximate: false,
    },
  ];
  const draft = assembleMealDraft('RU', items);
  assert.equal(draft.approximate, false);
  assert.equal(draft.portion_state, 'confirmed');
  assert.equal(draft.flags.has_estimate, true);
  assert.equal(draft.flags.low_confidence, true);
  // The DB-miss placeholder is fabricated — it must NOT count toward the total.
  assert.equal(draft.totals.kcal, 0);
});

test('assembleMealDraft: total counts real items, excludes DB-miss placeholder', () => {
  const est: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };
  const items: NutritionItem[] = [
    {
      name_ru: 'курица', name_en: 'chicken', grams: 100, grams_source: 'confirmed',
      confidence: 0.9, per100: chicken, scaled: scaleToGrams(chicken, 100), approximate: false,
    },
    {
      name_ru: 'пончик', name_en: 'donut', grams: 200, grams_source: 'estimated',
      confidence: 0.3, per100: est, scaled: scaleToGrams(est, 200), approximate: true,
    },
  ];
  const draft = assembleMealDraft('RU', items);
  assert.equal(draft.flags.has_estimate, true);
  assert.equal(draft.totals.kcal, 165); // chicken only — donut's 300 kcal placeholder excluded
});

test('normalizeIdentified: keeps named items, clamps confidence, defaults grams', () => {
  const items = normalizeIdentified({
    items: [
      { name_ru: 'тост', name_en: 'toast', est_grams: 30, confidence: 0.8 },
      { name_ru: '', name_en: '', est_grams: 50, confidence: 1 }, // nameless → dropped
      { name_ru: 'яйцо', name_en: 'egg', est_grams: 0, confidence: 5 }, // grams default + clamp
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0]!.est_grams, 30);
  assert.equal(items[1]!.name_ru, 'яйцо');
  assert.equal(items[1]!.est_grams, 100); // 0 → sane default
  assert.equal(items[1]!.confidence, 1); // clamped to 1
});

test('normalizeIdentified: carries prepared only when strictly true', () => {
  const items = normalizeIdentified({
    items: [
      { name_ru: 'суп харчо', name_en: 'kharcho soup', est_grams: 250, confidence: 0.9, prepared: true },
      { name_ru: 'гречка', name_en: 'buckwheat', est_grams: 100, confidence: 0.9, prepared: false },
      { name_ru: 'тост', name_en: 'toast', est_grams: 30, confidence: 0.8, prepared: 'yes' },
    ],
  });
  assert.equal(items.length, 3);
  assert.equal(items[0]!.prepared, true);
  assert.ok(!('prepared' in items[1]!)); // false → no signal on the wire
  assert.ok(!('prepared' in items[2]!)); // loose-model garbage stays off
});

test('normalizeIdentified: garbage → empty, never throws', () => {
  for (const junk of [null, undefined, 42, 'x', { items: 'no' }]) {
    assert.deepEqual(normalizeIdentified(junk), []);
  }
});

test('normalizeIdentified: carries a legible label, drops implausible/garbage fields', () => {
  const [ok] = normalizeIdentified({
    items: [
      {
        name_ru: 'скир',
        name_en: 'skyr',
        est_grams: 120,
        confidence: 0.8,
        label: { kcal_100g: 66, prot_100g: 14, fat_100g: 1.2, carb_100g: 1.5, net_weight_g: 120 },
      },
    ],
  });
  assert.deepEqual(ok!.label, { kcal_100g: 66, prot_100g: 14, fat_100g: 1.2, carb_100g: 1.5, net_weight_g: 120 });

  // kcal over the ceiling, negative protein, non-numeric fat, a real 0 carb —
  // every field is rejected, so `label` stays absent rather than an empty husk.
  const [bad] = normalizeIdentified({
    items: [
      {
        name_ru: 'x',
        name_en: 'x',
        est_grams: 100,
        confidence: 0.5,
        label: { kcal_100g: 5000, prot_100g: -3, fat_100g: 'abc', carb_100g: 0 },
      },
    ],
  });
  assert.equal(bad!.label, undefined);

  // A partial-but-legible label survives with only the fields it could read.
  const [partial] = normalizeIdentified({
    items: [{ name_ru: 'творог', name_en: 'quark', est_grams: 200, confidence: 0.7, label: { prot_100g: 17, net_weight_g: 200 } }],
  });
  assert.deepEqual(partial!.label, { prot_100g: 17, net_weight_g: 200 });
});

test('normalizeIdentified: carries a legible AI estimate, drops implausible fields', () => {
  const [ok] = normalizeIdentified({
    items: [
      {
        name_ru: 'плескавица',
        name_en: 'pljeskavica',
        est_grams: 200,
        confidence: 0.7,
        estimate: { kcal_100g: 215, prot_100g: 17, fat_100g: 15, carb_100g: 3 },
      },
    ],
  });
  assert.deepEqual(ok!.estimate, { kcal_100g: 215, prot_100g: 17, fat_100g: 15, carb_100g: 3 });

  // kcal over ceiling, negative protein, non-numeric fat, a real 0 carb → all
  // rejected, so `estimate` stays absent rather than an empty object.
  const [bad] = normalizeIdentified({
    items: [
      {
        name_ru: 'y',
        name_en: 'y',
        est_grams: 100,
        confidence: 0.5,
        estimate: { kcal_100g: 5000, prot_100g: -1, fat_100g: 'x', carb_100g: 0 },
      },
    ],
  });
  assert.equal(bad!.estimate, undefined);
});

test('coercePer100: unknown source falls back to estimate, clamps negatives', () => {
  const p = coercePer100({ source: 'bogus', kcal: -5, prot: '12.34', fat: 1, carb: 2, minerals: { na: 10 } });
  assert.equal(p.source, 'estimate');
  assert.equal(p.kcal, 0);
  assert.equal(p.prot, 12.3);
  assert.deepEqual(p.minerals, { na: 10 });
});

test('emptyMealDraft is a valid unrecognized result', () => {
  const d = emptyMealDraft('RU');
  assert.deepEqual(d.items, []);
  assert.equal(d.approximate, false);
  assert.equal(d.totals.kcal, 0);
});

test('normalizeParsedWorkouts: known type keeps pace, drops model met', () => {
  const [w] = normalizeParsedWorkouts({
    workouts: [{ type: 'run', name_ru: 'бег', minutes: 30, speed_kmh: 10, met: 9, confidence: 0.9 }],
  });
  assert.equal(w.type, 'run');
  assert.equal(w.minutes, 30);
  assert.equal(w.speed_kmh, 10);
  assert.equal(w.met, undefined); // met is ignored for known types (app owns MET)
});

test('normalizeParsedWorkouts: "other" carries a clamped met, no pace', () => {
  const [w] = normalizeParsedWorkouts({
    workouts: [{ type: 'other', name_ru: 'отжимания', minutes: 8, speed_kmh: 5, met: 999, confidence: 0.7 }],
  });
  assert.equal(w.type, 'other');
  assert.equal(w.name_ru, 'отжимания');
  assert.equal(w.met, 25); // clamped to the human ceiling
  assert.equal(w.speed_kmh, undefined); // pace meaningless for a non-speed type
});

test('normalizeParsedWorkouts: unknown type folds to "other"; name falls back to type', () => {
  const [w] = normalizeParsedWorkouts({ workouts: [{ type: 'quidditch', minutes: 20, confidence: 0.5 }] });
  assert.equal(w.type, 'other');
  assert.equal(w.name_ru, 'other');
});

test('normalizeParsedWorkoutPhoto: keeps plausible tracker totals, drops wild ones', () => {
  const ok = normalizeParsedWorkoutPhoto({
    workouts: [{ type: 'run', name_ru: 'бег', minutes: 30, confidence: 0.9 }],
    device_kcal: 412.6,
    device_minutes: 31.2,
  });
  assert.equal(ok.workouts.length, 1);
  assert.equal(ok.device_kcal, 413);
  assert.equal(ok.device_minutes, 31);
  // Steps misread as kcal (10 000) or a 12-hour "duration" must not pass.
  const wild = normalizeParsedWorkoutPhoto({ workouts: [], device_kcal: 10_000, device_minutes: 720 });
  assert.equal(wild.device_kcal, undefined);
  assert.equal(wild.device_minutes, undefined);
  // Garbage payloads → an empty, well-formed result. Never a throw.
  assert.deepEqual(normalizeParsedWorkoutPhoto(null), { workouts: [] });
  assert.deepEqual(normalizeParsedWorkoutPhoto('nope'), { workouts: [] });
});

test('normalizeParsedWorkouts: sets ride along for strength only, clamped', () => {
  const [lift] = normalizeParsedWorkouts({
    workouts: [{ type: 'strength', name_ru: 'жим лёжа', minutes: 12, sets: 4, confidence: 0.9 }],
  });
  assert.equal(lift.sets, 4);
  // A wild count is dropped rather than clamped-and-kept — no fabricated volume.
  const [wild] = normalizeParsedWorkouts({
    workouts: [{ type: 'strength', name_ru: 'жим', minutes: 12, sets: 500, confidence: 0.9 }],
  });
  assert.equal(wild.sets, undefined);
  // Sets are meaningless for a run — dropped even if the model emits them.
  const [run] = normalizeParsedWorkouts({
    workouts: [{ type: 'run', name_ru: 'бег', minutes: 30, sets: 3, confidence: 0.9 }],
  });
  assert.equal(run.sets, undefined);
});

test('normalizeParsedWorkouts: strength effort rides along, validated', () => {
  const [heavy] = normalizeParsedWorkouts({
    workouts: [{ type: 'strength', name_ru: 'присед', minutes: 36, intensity: 'heavy', confidence: 0.9 }],
  });
  assert.equal(heavy.intensity, 'heavy');
  // An invented effort word is dropped — the client then keeps its fixed MET.
  const [odd] = normalizeParsedWorkouts({
    workouts: [{ type: 'strength', name_ru: 'присед', minutes: 36, intensity: 'ультра', confidence: 0.9 }],
  });
  assert.equal(odd.intensity, undefined);
  // Effort is meaningless outside strength — dropped even if the model emits it.
  const [run] = normalizeParsedWorkouts({
    workouts: [{ type: 'run', name_ru: 'бег', minutes: 30, intensity: 'heavy', confidence: 0.9 }],
  });
  assert.equal(run.intensity, undefined);
  // Absent effort stays absent — no default is invented server-side.
  const [plain] = normalizeParsedWorkouts({
    workouts: [{ type: 'strength', name_ru: 'силовая', minutes: 36, confidence: 0.9 }],
  });
  assert.equal(plain.intensity, undefined);
});

test('normalizeParsedWorkouts: drops non-positive / garbage durations, never throws', () => {
  assert.deepEqual(normalizeParsedWorkouts({ workouts: [{ type: 'run', minutes: 0, confidence: 1 }] }), []);
  assert.deepEqual(normalizeParsedWorkouts({ workouts: [{ type: 'walk', minutes: 'x', confidence: 1 }] }), []);
  assert.deepEqual(normalizeParsedWorkouts(null), []);
  assert.deepEqual(normalizeParsedWorkouts({ workouts: 'nope' }), []);
});

test('normalizeParsedWorkouts: clamps minutes to 10 h and caps the array', () => {
  const [w] = normalizeParsedWorkouts({ workouts: [{ type: 'walk', minutes: 99999, confidence: 1 }] });
  assert.equal(w.minutes, 600);
  const many = normalizeParsedWorkouts({
    workouts: Array.from({ length: 50 }, () => ({ type: 'run', minutes: 10, confidence: 1 })),
  });
  assert.equal(many.length, 20);
});

// ---- panel transcription: words decide the mapping, not the model ----------

// Verbatim panel from the tester's «Индилайт филе грудки индейки» pack.
// Ground truth, read off the package: 100 kcal, P16, F2, C4 per 100 g, net 120 g.
const INDEYKA_PANEL =
  'Пищевая и энергетическая ценность в 100 г продукта (средние значения): ' +
  'белки - 16 г; жиры - 2 г; углеводы - 4 г; 100 ккал / 410 кДж. Масса нетто: 120 г';

test('parsePanelText: the Russian phrase maps each number by its own word', () => {
  assert.deepEqual(parsePanelText(INDEYKA_PANEL), {
    kcal_100g: 100,
    prot_100g: 16,
    fat_100g: 2,
    carb_100g: 4,
    net_weight_g: 120,
  });
});

test('parsePanelText: dash variants, decimal commas and «жиров/углеводов» endings', () => {
  const p = parsePanelText('белков — 6,5 г, жиров – 3,2 г, углеводов - 12,8 г, 118 ккал');
  assert.equal(p?.prot_100g, 6.5);
  assert.equal(p?.fat_100g, 3.2);
  assert.equal(p?.carb_100g, 12.8);
  assert.equal(p?.kcal_100g, 118);
});

test('parsePanelText: nothing to parse stays undefined, never zero-filled', () => {
  assert.equal(parsePanelText(''), undefined);
  assert.equal(parsePanelText('просто тарелка супа'), undefined);
  assert.equal(parsePanelText(null), undefined);
});

test('crossCheckLabel: agreeing readings earn the label source', () => {
  const model = { kcal_100g: 100, prot_100g: 16, fat_100g: 2, carb_100g: 4, net_weight_g: 120 };
  const out = crossCheckLabel(model, parsePanelText(INDEYKA_PANEL));
  assert.deepEqual(out, model);
});

test('crossCheckLabel: a transposed macro pair is DROPPED, not averaged', () => {
  // The exact failure this cross-check exists for: fat and carbs swapped between
  // the two readings. Both pass an Atwater check (98 vs 108 against a stated
  // 100 kcal), so only disagreement — not arithmetic — can catch it. Better a
  // generic DB row than a wrong number wearing the «по упаковке» badge.
  const swapped = { kcal_100g: 100, prot_100g: 16, fat_100g: 4, carb_100g: 2 };
  const out = crossCheckLabel(swapped, parsePanelText(INDEYKA_PANEL));
  assert.equal(out?.kcal_100g, undefined, 'composition must not survive a conflict');
  assert.equal(out?.fat_100g, undefined);
  assert.equal(out?.net_weight_g, 120, 'net weight is a separate, far easier read — keep it');
});

test('crossCheckLabel: one reading alone still counts', () => {
  const only = { kcal_100g: 92, prot_100g: 10, fat_100g: 1.5, carb_100g: 7 };
  assert.deepEqual(crossCheckLabel(only, undefined), only);
  assert.deepEqual(crossCheckLabel(undefined, only), only);
  assert.equal(crossCheckLabel(undefined, undefined), undefined);
});

test('normalizeIdentified: panel_text reconciles into the item label end-to-end', () => {
  const items = normalizeIdentified({
    items: [
      {
        name_ru: 'ветчина из грудки индейки',
        name_en: 'turkey breast ham',
        est_grams: 120,
        confidence: 0.8,
        label: { kcal_100g: 100, prot_100g: 16, fat_100g: 2, carb_100g: 4 },
        panel_text: INDEYKA_PANEL,
      },
    ],
  });
  assert.equal(items[0]?.label?.fat_100g, 2);
  assert.equal(items[0]?.label?.carb_100g, 4);
  assert.equal(items[0]?.label?.net_weight_g, 120, 'net weight comes from the phrase');
});

test('normalizeIdentified: packaged rides through only as a strict boolean true', () => {
  const [pack, plate, junk] = normalizeIdentified({
    items: [
      { name_ru: 'ветчина', name_en: 'ham', est_grams: 120, confidence: 0.8, packaged: true },
      { name_ru: 'борщ', name_en: 'borscht', est_grams: 350, confidence: 0.9, packaged: false },
      { name_ru: 'хлеб', name_en: 'bread', est_grams: 40, confidence: 0.7, packaged: 'yes' },
    ],
  });
  assert.equal(pack?.packaged, true, 'a wrapper triggers the dedicated label pass');
  assert.equal(plate?.packaged, undefined, 'a plate must never pay for panel work');
  assert.equal(junk?.packaged, undefined, 'a loose truthy value is not a flag');
});
