import { describe, expect, it } from '@jest/globals';

import { en } from '@/lib/i18n/locales/en';
import { ru } from '@/lib/i18n/locales/ru';

/// Flattens a nested locale object into dot-path → string leaves.
function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else if (value != null && typeof value === 'object') {
      for (const [p, v] of flatten(value as Record<string, unknown>, path)) out.set(p, v);
    }
  }
  return out;
}

/// The {{placeholder}} names a string interpolates, sorted for comparison.
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

/// Editing one locale and forgetting the other used to surface only on-device
/// (raw keys / English text in a Russian build). Codified after the 2026-07-12
/// simplification pass — every copy edit now proves both locales moved together.
describe('locale parity (ru ↔ en)', () => {
  const ruFlat = flatten(ru);
  const enFlat = flatten(en);

  it('has the same key set in both locales', () => {
    expect([...enFlat.keys()].sort()).toEqual([...ruFlat.keys()].sort());
  });

  it('keeps the same {{placeholders}} per key', () => {
    for (const [key, ruVal] of ruFlat) {
      const enVal = enFlat.get(key);
      if (enVal == null) continue; // the key-set test reports the miss
      expect({ key, ph: placeholders(enVal) }).toEqual({ key, ph: placeholders(ruVal) });
    }
  });

  it('has no empty strings', () => {
    for (const [key, val] of ruFlat) expect({ key, blank: val.trim() === '' }).toEqual({ key, blank: false });
    for (const [key, val] of enFlat) expect({ key, blank: val.trim() === '' }).toEqual({ key, blank: false });
  });
});
