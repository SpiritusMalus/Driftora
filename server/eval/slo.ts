/**
 * Turns a `/metrics` snapshot into a list of SLO violations.
 *
 * Pure, and unit-tested in `test/sloCheck.test.ts`, because the alternative is a
 * `jq` expression buried in a workflow file that nobody can run, nobody has
 * tested, and that fails open — an alert that silently stops firing is worse
 * than no alert, since its silence is read as health.
 *
 * The thresholds mirror docs/operations.md. Two levels, deliberately:
 *
 *   · SLO — the target being held. Reported, never fails a run.
 *   · ALERT — the looser number that says something is actually broken. This is
 *     what fails the workflow and puts mail in someone's inbox.
 *
 * A single level would either cry wolf on normal variance or say nothing until
 * the service was long dead.
 */

export interface MetricsSnapshot {
  uptime_s?: number;
  requests?: Record<string, number | undefined>;
  empty?: number;
  escalations?: number;
  sources?: Record<string, number | undefined>;
  latency_ms?: Record<string, { avg?: number; count?: number } | undefined>;
}

export interface Violation {
  level: 'alert' | 'slo';
  sli: string;
  message: string;
}

export const THRESHOLDS = {
  /** 1 − empty/requests. */
  parseSuccess: { slo: 0.95, alert: 0.9 },
  /** share of resolved items whose numbers came from the model, not a database */
  aiEstimateShare: { slo: 0.25, alert: 0.4 },
  /** escalations/requests — the cost signal */
  escalationRate: { slo: 0.1, alert: 0.2 },
  /** average latency per route, milliseconds */
  latencyMs: {
    text: { slo: 3_000, alert: 6_000 },
    photo: { slo: 9_000, alert: 15_000 },
  },
  /**
   * Below this many parses since the last restart, every ratio is noise: one
   * empty out of three requests is 33 % and means nothing. Counters reset on
   * restart, so this is hit routinely right after a deploy — staying quiet then
   * is the whole point.
   */
  minSample: 20,
} as const;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function evaluate(metrics: MetricsSnapshot): {
  violations: Violation[];
  sampled: boolean;
  totals: { requests: number; parseSuccess: number; aiShare: number; escalationRate: number };
} {
  const requests = Object.values(metrics.requests ?? {}).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const empty = metrics.empty ?? 0;
  const escalations = metrics.escalations ?? 0;

  const sourceValues = Object.values(metrics.sources ?? {}).map((n) => n ?? 0);
  const items = sourceValues.reduce((sum, n) => sum + n, 0);
  const aiItems = metrics.sources?.ai_estimate ?? 0;

  const parseSuccess = requests > 0 ? 1 - empty / requests : 1;
  const aiShare = items > 0 ? aiItems / items : 0;
  const escalationRate = requests > 0 ? escalations / requests : 0;
  const totals = { requests, parseSuccess, aiShare, escalationRate };

  const violations: Violation[] = [];

  // Latency is a per-request average and needs no ratio sample — a single slow
  // route is meaningful on its own, so it is checked even on a small sample.
  for (const route of ['text', 'photo'] as const) {
    const entry = metrics.latency_ms?.[route];
    const avg = entry?.avg ?? 0;
    const count = entry?.count ?? 0;
    if (count === 0 || avg === 0) continue;
    const limit = THRESHOLDS.latencyMs[route];
    if (avg > limit.alert) {
      violations.push({
        level: 'alert',
        sli: `latency.${route}`,
        message: `${route} average ${avg} ms over the alert ceiling ${limit.alert} ms (n=${count})`,
      });
    } else if (avg > limit.slo) {
      violations.push({
        level: 'slo',
        sli: `latency.${route}`,
        message: `${route} average ${avg} ms over the ${limit.slo} ms target (n=${count})`,
      });
    }
  }

  const sampled = requests >= THRESHOLDS.minSample;
  if (!sampled) return { violations, sampled, totals };

  if (parseSuccess < THRESHOLDS.parseSuccess.alert) {
    violations.push({
      level: 'alert',
      sli: 'parseSuccess',
      message: `parse success ${pct(parseSuccess)} below the alert floor ${pct(THRESHOLDS.parseSuccess.alert)} (${empty} empty of ${requests})`,
    });
  } else if (parseSuccess < THRESHOLDS.parseSuccess.slo) {
    violations.push({
      level: 'slo',
      sli: 'parseSuccess',
      message: `parse success ${pct(parseSuccess)} below the ${pct(THRESHOLDS.parseSuccess.slo)} target (${empty} empty of ${requests})`,
    });
  }

  // The quiet failure: a nutrition provider is down, the model covers for it,
  // and every other number still looks healthy.
  if (items > 0) {
    if (aiShare > THRESHOLDS.aiEstimateShare.alert) {
      violations.push({
        level: 'alert',
        sli: 'aiEstimateShare',
        message: `${pct(aiShare)} of items came from the model, over the alert ceiling ${pct(THRESHOLDS.aiEstimateShare.alert)} — a nutrition provider is probably down`,
      });
    } else if (aiShare > THRESHOLDS.aiEstimateShare.slo) {
      violations.push({
        level: 'slo',
        sli: 'aiEstimateShare',
        message: `${pct(aiShare)} of items came from the model, over the ${pct(THRESHOLDS.aiEstimateShare.slo)} target`,
      });
    }
  }

  if (escalationRate > THRESHOLDS.escalationRate.alert) {
    violations.push({
      level: 'alert',
      sli: 'escalationRate',
      message: `${pct(escalationRate)} of parses escalated to the pricier model, over ${pct(THRESHOLDS.escalationRate.alert)}`,
    });
  } else if (escalationRate > THRESHOLDS.escalationRate.slo) {
    violations.push({
      level: 'slo',
      sli: 'escalationRate',
      message: `${pct(escalationRate)} of parses escalated, over the ${pct(THRESHOLDS.escalationRate.slo)} target`,
    });
  }

  return { violations, sampled, totals };
}
