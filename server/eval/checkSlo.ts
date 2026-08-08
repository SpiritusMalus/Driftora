/**
 * Reads `/metrics` off a running service and exits non-zero when an SLO alert
 * threshold is crossed. Driven by `.github/workflows/slo.yml`; run it by hand
 * the same way:
 *
 *   BASE_URL=https://food.family-pie.ru APP_TOKEN=… npm run slo
 *
 * Exit codes: 0 fine (targets may be reported), 1 an alert threshold crossed,
 * 2 the metrics could not be read at all.
 */
import { evaluate, THRESHOLDS, type MetricsSnapshot } from './slo.js';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const APP_TOKEN = process.env.APP_TOKEN ?? '';
const TIMEOUT_MS = Number(process.env.SLO_TIMEOUT_MS) || 15_000;

/** GitHub renders these as annotations on the run. */
function annotate(kind: 'error' | 'warning', message: string): void {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${kind}::${message}`);
}

async function main(): Promise<void> {
  let metrics: MetricsSnapshot;
  try {
    const response = await fetch(`${BASE_URL}/metrics`, {
      headers: APP_TOKEN ? { authorization: `Bearer ${APP_TOKEN}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // 401 here means the token is wrong, not that the service is unhealthy —
      // say which, or the next person debugs the wrong thing.
      const hint = response.status === 401 ? ' (APP_TOKEN missing or wrong)' : '';
      annotate('error', `GET /metrics → HTTP ${response.status}${hint}`);
      console.error(`GET ${BASE_URL}/metrics → HTTP ${response.status}${hint}`);
      process.exitCode = 2;
      return;
    }
    metrics = (await response.json()) as MetricsSnapshot;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    annotate('error', `could not read /metrics: ${reason}`);
    console.error(`could not read ${BASE_URL}/metrics: ${reason}`);
    process.exitCode = 2;
    return;
  }

  const { violations, sampled, totals } = evaluate(metrics);

  const uptimeH = ((metrics.uptime_s ?? 0) / 3600).toFixed(1);
  console.log(`uptime        ${uptimeH} h  (counters reset on restart)`);
  console.log(`requests      ${totals.requests}`);
  console.log(`parse success ${(totals.parseSuccess * 100).toFixed(1)}%`);
  console.log(`model-guessed ${(totals.aiShare * 100).toFixed(1)}% of items`);
  console.log(`escalations   ${(totals.escalationRate * 100).toFixed(1)}% of parses`);
  if (!sampled) {
    console.log(
      `\n${totals.requests} parses since the last restart, under the ${THRESHOLDS.minSample} needed ` +
        'to judge a ratio — success/provenance/escalation checks skipped, latency reported ' +
        `(alerts from ${THRESHOLDS.minLatencySample} requests per route)`,
    );
  }

  const alerts = violations.filter((v) => v.level === 'alert');
  const targets = violations.filter((v) => v.level === 'slo');

  for (const violation of targets) {
    console.log(`\nbelow target · ${violation.sli}: ${violation.message}`);
    annotate('warning', `${violation.sli}: ${violation.message}`);
  }
  for (const violation of alerts) {
    console.error(`\nALERT · ${violation.sli}: ${violation.message}`);
    annotate('error', `${violation.sli}: ${violation.message}`);
  }

  if (alerts.length > 0) {
    console.error(`\n${alerts.length} alert threshold(s) crossed — see docs/operations.md`);
    process.exitCode = 1;
    return;
  }
  console.log(targets.length === 0 ? '\nall SLOs met' : '\nno alert thresholds crossed');
}

await main();
