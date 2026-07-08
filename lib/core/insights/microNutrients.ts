import type { Sex } from './bodyMetrics';

/// Daily reference intakes for a BASIC set of vitamins and minerals — "how much
/// a body needs per day", shown on the Weight screen as a reference table.
///
/// HONESTY NOTE (surfaces in the UI copy): these are REQUIREMENTS, not a readout
/// of what the user ate. The food DB carries no vitamins and only a partial set
/// of minerals, so presenting "intake vs need" here would be dishonest. The
/// table answers one question only — the daily norm — and cites its source.
///
/// Values are the U.S. IOM / National Academies DRIs for non-pregnant adults
/// 19–50 (RDA where one exists, otherwise the Adequate Intake). Chosen because
/// every number here is well-established and citable; they align closely with
/// WHO. Sex-split only where the DRI itself differs. If official Rospotrebnadzor
/// norms (МР 2.3.1.2432-08) are preferred later, only this table changes.

export type MicroGroup = 'vitamin' | 'mineral';
export type MicroUnit = 'mg' | 'mcg';

export interface MicroNorm {
  /// Stable i18n key (weight.micros.name.<key>) and React list key.
  key: string;
  group: MicroGroup;
  unit: MicroUnit;
  /// Daily norm for each sex (equal when the DRI isn't sex-specific).
  male: number;
  female: number;
  /// True when the figure is an Adequate Intake (no firm RDA) — the copy softens
  /// "нужно" to "ориентир" for these (potassium, sodium).
  adequate?: boolean;
  /// Upper reference to show alongside the target (sodium: "≈X, не более Y").
  limit?: number;
}

/// The basic set, in display order (vitamins first, then minerals). Kept short
/// on purpose — the common, name-recognisable micronutrients, not an exhaustive
/// DRI dump.
export const BASIC_MICROS: readonly MicroNorm[] = [
  // ── Vitamins ──
  { key: 'a', group: 'vitamin', unit: 'mcg', male: 900, female: 700 },
  { key: 'd', group: 'vitamin', unit: 'mcg', male: 15, female: 15 },
  { key: 'e', group: 'vitamin', unit: 'mg', male: 15, female: 15 },
  { key: 'c', group: 'vitamin', unit: 'mg', male: 90, female: 75 },
  { key: 'b1', group: 'vitamin', unit: 'mg', male: 1.2, female: 1.1 },
  { key: 'b2', group: 'vitamin', unit: 'mg', male: 1.3, female: 1.1 },
  { key: 'b6', group: 'vitamin', unit: 'mg', male: 1.3, female: 1.3 },
  { key: 'b9', group: 'vitamin', unit: 'mcg', male: 400, female: 400 },
  { key: 'b12', group: 'vitamin', unit: 'mcg', male: 2.4, female: 2.4 },
  // ── Minerals ──
  { key: 'ca', group: 'mineral', unit: 'mg', male: 1000, female: 1000 },
  { key: 'fe', group: 'mineral', unit: 'mg', male: 8, female: 18 },
  { key: 'mg', group: 'mineral', unit: 'mg', male: 400, female: 310 },
  { key: 'zn', group: 'mineral', unit: 'mg', male: 11, female: 8 },
  { key: 'k', group: 'mineral', unit: 'mg', male: 3400, female: 2600, adequate: true },
  { key: 'na', group: 'mineral', unit: 'mg', male: 1500, female: 1500, adequate: true, limit: 2300 },
  { key: 'i', group: 'mineral', unit: 'mcg', male: 150, female: 150 },
];

/// One resolved row for the UI. When `sexSplit` is set (sex unknown AND the norm
/// differs by sex), the UI shows both figures; otherwise it shows `value`.
export interface MicroRow {
  key: string;
  group: MicroGroup;
  unit: MicroUnit;
  value: number;
  sexSplit: { male: number; female: number } | null;
  adequate: boolean;
  limit?: number;
}

/// Resolve the basic norms for a profile sex. Known sex ⇒ that sex's figures.
/// Unknown sex ⇒ `value` falls back to the male figure but `sexSplit` is filled
/// wherever the sexes differ, so the UI can show "♂ … · ♀ …" instead of guessing.
export function dailyMicroNorms(sex: '' | Sex): MicroRow[] {
  const known = sex === 'male' || sex === 'female';
  return BASIC_MICROS.map((n) => {
    const differs = n.male !== n.female;
    const value = sex === 'female' ? n.female : n.male;
    return {
      key: n.key,
      group: n.group,
      unit: n.unit,
      value,
      sexSplit: !known && differs ? { male: n.male, female: n.female } : null,
      adequate: n.adequate === true,
      ...(n.limit != null ? { limit: n.limit } : {}),
    };
  });
}
