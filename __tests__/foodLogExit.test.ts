import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * THE BACK STACK AFTER A SAVE (device feedback 2026-08-19: «записал 3-4 еды — из
 * главного меню 3 раза откатывает на страницу записи еды»).
 *
 * The food log screen is reached from the day list's «+ Добавить», so «Еда» is
 * already on the stack underneath it. Leaving with `router.replace('/food')`
 * swapped the log screen for a SECOND «Еда» sitting on top of the first — and
 * every meal logged in one sitting added one more. Four meals in, going Home
 * meant four back presses that each landed on «Еда» again.
 *
 * `dismissTo` is the fix and the reason it is the right one is that it handles
 * BOTH entry paths in one call: it pops back to the «Еда» already on the stack
 * when there is one, and replaces the current screen (the old behavior, which
 * was correct for the Home mic/text FAB) when there isn't.
 *
 * This is a source-level guard because the bug lives in the interaction between
 * two screens' navigation calls — the kind of thing that reads as fine in either
 * file alone, which is exactly how it shipped.
 */

const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function screenFiles(dir = path.join(ROOT, 'app'), out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) screenFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Every `router.<method>('<literal route>')` call site under `app/`. */
function navCalls(method: 'push' | 'replace' | 'dismissTo'): { route: string; at: string }[] {
  const calls: { route: string; at: string }[] = [];
  const pattern = new RegExp(`router\\.${method}\\(\\s*['\`]([^'\`$?]+)`, 'g');
  for (const file of screenFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(pattern)) {
      const line = src.slice(0, m.index).split('\n').length;
      calls.push({ route: m[1], at: `${path.relative(ROOT, file)}:${line}` });
    }
  }
  return calls;
}

describe('leaving the food log screen after a save', () => {
  const log = read('app/food/log.tsx');

  it('returns to the day list without stacking a second copy of it', () => {
    expect(log).toContain("router.dismissTo('/food')");
  });

  it('never replaces its way onto «Еда» — that is the bug itself', () => {
    expect(log).not.toContain("router.replace('/food')");
  });

  it('is still opened by a push from the day list (the setup the bug needs)', () => {
    // If this ever stops being true the coupling above is worth re-reading
    // rather than trusting: `dismissTo` is chosen BECAUSE «Еда» can already be
    // on the stack when the log screen opens.
    expect(read('app/food/index.tsx')).toContain("router.push('/food/log')");
  });
});

describe('back-stack hygiene across the app', () => {
  it('no screen replaces its way onto a route that is also pushed', () => {
    // `replace` swaps the CURRENT screen for the target — which quietly adds a
    // duplicate whenever the target is already below on the stack. A route that
    // is pushed anywhere can be below, so replacing onto it is the shape of the
    // 2026-08-19 bug. `dismissTo` expresses "get me to that screen" without the
    // duplicate, and is what a new occurrence should reach for.
    //
    // `router.replace('/')` (mood) is not caught and should not be: Home is
    // never pushed, and that call is already guarded by `canGoBack()`.
    const pushed = new Set(navCalls('push').map((c) => c.route));
    const offenders = navCalls('replace').filter((c) => pushed.has(c.route));
    expect(offenders).toEqual([]);
  });
});
