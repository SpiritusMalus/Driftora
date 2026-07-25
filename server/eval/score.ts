/**
 * Scoring for the food-parse eval — pure, so `test/evalScore.test.ts` can check
 * the judge itself. A harness nobody has verified is worse than no harness: it
 * produces numbers that look like evidence.
 *
 * What it deliberately does NOT do: score exact calories against a "true" value.
 * There is no ground truth for «борщ» — portion, recipe and fat content move the
 * answer by a factor of two, and inventing a reference number would make the
 * eval measure agreement with our own guess. It scores the things that DO have a
 * right answer: did the parse return anything at all, did the numbers land in a
 * physically plausible band, did the item come from a real database row or from
 * the model's imagination, and how long did it take.
 */

/** One case in `cases.json`. */
export interface EvalCase {
  /** Stable id — the report is diffed across runs by this. */
  id: string;
  /** What is sent to POST /food/parse. */
  text: string;
  region: 'RU' | 'US';
  /** Why this case is in the set: a bug it once caught, or a category it covers. */
  note: string;
  expect: {
    /** Fewest items a correct parse must return. 0 = "anything, including nothing". */
    minItems?: number;
    /**
     * Plausible band for the whole meal's kcal. Wide on purpose — it is a
     * sanity range («лимонад тархун» must not come back as 974 kcal), not an
     * accuracy target.
     */
    kcalRange?: [number, number];
    /**
     * Substrings, lowercased, that at least one item's name or matched_name must
     * contain. Catches the failure where a query resolves to an unrelated row
     * («тархун» → «сушёный эстрагон»).
     */
    nameContains?: string[];
    /**
     * Require the numbers to come from a real source rather than a guess. When
     * true, every item must carry a per100.source other than 'estimate'.
     */
    requireResolved?: boolean;
  };
}

export type NutritionSourceName = string;

export interface EvalItem {
  name_ru?: string;
  name_en?: string;
  matched_name?: string;
  per100?: { source?: NutritionSourceName };
  scaled?: { kcal?: number };
}

export interface EvalDraft {
  items?: EvalItem[];
  totals?: { kcal?: number };
  flags?: { low_confidence?: boolean; has_estimate?: boolean; has_ai_estimate?: boolean };
}

export interface CaseResult {
  id: string;
  /** Every expectation held. */
  pass: boolean;
  /** Human-readable reasons this case failed; empty when it passed. */
  failures: string[];
  /** The parse came back with no items at all — the «не распозналось» symptom. */
  empty: boolean;
  /** Wall-clock milliseconds for the request. */
  ms: number;
  /** Distinct per100 sources seen, for the provenance table. */
  sources: string[];
  /** HTTP status, or 0 when the request never completed. */
  status: number;
}

function names(item: EvalItem): string {
  return [item.name_ru, item.name_en, item.matched_name].filter(Boolean).join(' ').toLowerCase();
}

/** Judge one response against one case. */
export function scoreCase(
  testCase: EvalCase,
  draft: EvalDraft | null,
  ms: number,
  status: number,
): CaseResult {
  const failures: string[] = [];
  const items = draft?.items ?? [];
  const empty = items.length === 0;
  const sources = [...new Set(items.map((i) => i.per100?.source).filter((s): s is string => !!s))];

  if (status !== 200) {
    failures.push(`HTTP ${status}`);
    return { id: testCase.id, pass: false, failures, empty: true, ms, sources, status };
  }

  const minItems = testCase.expect.minItems ?? 1;
  if (items.length < minItems) {
    failures.push(`items ${items.length} < ${minItems}`);
  }

  const kcal = draft?.totals?.kcal;
  const range = testCase.expect.kcalRange;
  if (range) {
    if (typeof kcal !== 'number' || !Number.isFinite(kcal)) {
      failures.push('totals.kcal missing');
    } else if (kcal < range[0] || kcal > range[1]) {
      failures.push(`kcal ${Math.round(kcal)} outside ${range[0]}–${range[1]}`);
    }
  }

  for (const needle of testCase.expect.nameContains ?? []) {
    const wanted = needle.toLowerCase();
    if (!items.some((item) => names(item).includes(wanted))) {
      failures.push(`no item matching "${needle}"`);
    }
  }

  if (testCase.expect.requireResolved) {
    const guessed = items.filter((i) => i.per100?.source === 'estimate');
    if (guessed.length > 0) {
      failures.push(`${guessed.length} item(s) unresolved (source 'estimate')`);
    }
  }

  return { id: testCase.id, pass: failures.length === 0, failures, empty, ms, sources, status };
}

/**
 * Nearest-rank percentile over already-collected latencies. Nearest-rank, not
 * interpolated: with 20–40 cases an interpolated p95 invents a number that no
 * request actually took.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] as number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  /** Share of cases that came back with no items — the metric users feel. */
  emptyRate: number;
  passRate: number;
  latencyMs: { p50: number; p95: number; max: number };
  /** How many items each provenance produced, best-effort. */
  sourceCounts: Record<string, number>;
  failures: { id: string; failures: string[] }[];
}

export function summarize(results: CaseResult[]): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const latencies = results.map((r) => r.ms);
  const sourceCounts: Record<string, number> = {};
  for (const result of results) {
    for (const source of result.sources) {
      sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    }
  }
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : passed / total,
    emptyRate: total === 0 ? 0 : results.filter((r) => r.empty).length / total,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length === 0 ? 0 : Math.max(...latencies),
    },
    sourceCounts,
    failures: results.filter((r) => !r.pass).map((r) => ({ id: r.id, failures: r.failures })),
  };
}

/**
 * Compares a run against a recorded baseline. Returns the regressions worth
 * failing a run over — a drop in pass rate, a rise in empties, or a latency
 * blow-out. Improvements are reported by the caller, never gated on.
 */
export function compareToBaseline(
  current: EvalSummary,
  baseline: EvalSummary,
  tolerance = { passRate: 0.05, emptyRate: 0.05, p95Factor: 1.5 },
): string[] {
  const regressions: string[] = [];
  if (current.passRate < baseline.passRate - tolerance.passRate) {
    regressions.push(
      `pass rate ${(current.passRate * 100).toFixed(0)}% vs baseline ${(baseline.passRate * 100).toFixed(0)}%`,
    );
  }
  if (current.emptyRate > baseline.emptyRate + tolerance.emptyRate) {
    regressions.push(
      `empty rate ${(current.emptyRate * 100).toFixed(0)}% vs baseline ${(baseline.emptyRate * 100).toFixed(0)}%`,
    );
  }
  if (baseline.latencyMs.p95 > 0 && current.latencyMs.p95 > baseline.latencyMs.p95 * tolerance.p95Factor) {
    regressions.push(`p95 ${current.latencyMs.p95}ms vs baseline ${baseline.latencyMs.p95}ms`);
  }
  return regressions;
}
