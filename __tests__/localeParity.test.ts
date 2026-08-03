import fs from 'node:fs';
import path from 'node:path';

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

  /// Parity above only proves the two locales agree — a key missing from BOTH is
  /// invisible to it, and i18next then renders the KEY ITSELF on screen. That is
  /// how `bodySetup.result.notSaved` shipped: the copy that admits «норма не
  /// сохранилась» rendered as the raw dotted path, in the one place the app was
  /// trying to be honest that nothing was saved. This side checks the other
  /// direction — every literal key the code asks for actually exists.
  it('resolves every literal t() key used in the app', () => {
    const missing = literalKeyUses().filter(
      ({ key }) => !ruFlat.has(key) || !enFlat.has(key),
    );
    expect(missing).toEqual([]);
  });
});

/// Source roots that render UI copy. Template-literal keys (`t(\`a.${b}\`)`) are
/// deliberately out of scope — only what can be checked statically is checked.
const UI_ROOTS = ['app', 'lib', 'components'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/// Every `t('some.key')` call site, with a file:line so a failure points at the
/// screen rather than at the key alone.
function literalKeyUses(): { key: string; at: string }[] {
  const root = path.resolve(__dirname, '..');
  const uses: { key: string; at: string }[] = [];
  for (const dir of UI_ROOTS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
        const line = src.slice(0, m.index).split('\n').length;
        uses.push({ key: m[1], at: `${path.relative(root, file)}:${line}` });
      }
    }
  }
  return uses;
}
