/**
 * Food-parse eval runner.
 *
 *   npm run eval                                  # against localhost:8787
 *   BASE_URL=https://food.family-pie.ru npm run eval
 *   npm run eval -- --baseline eval/baselines/2026-07-25.json
 *   npm run eval -- --save eval/baselines/$(date +%F).json
 *
 * Hits a RUNNING service — it does not start one, and it spends real provider
 * and model quota, which is why it is a manual tool and not a CI job. What CI
 * does check is `score.ts`, so the numbers this prints mean what they say.
 *
 * Reads APP_TOKEN from the environment when the target requires one.
 */
import { readFile, writeFile } from 'node:fs/promises';

import {
  compareToBaseline,
  scoreCase,
  summarize,
  type CaseResult,
  type EvalCase,
  type EvalDraft,
  type EvalSummary,
} from './score.js';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const APP_TOKEN = process.env.APP_TOKEN ?? '';
/** One at a time by default: the service is rate-limited and this is not a load test. */
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY) || 1;
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS) || 30_000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/food/parse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(APP_TOKEN ? { authorization: `Bearer ${APP_TOKEN}` } : {}),
      },
      body: JSON.stringify({ text: testCase.text, region: testCase.region }),
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    const draft = response.ok ? ((await response.json()) as EvalDraft) : null;
    return scoreCase(testCase, draft, ms, response.status);
  } catch (error) {
    // A timeout is a result, not a crash: «одно фото не распозналось» was a
    // client timeout firing before the server's, and it looked like silence.
    const ms = Date.now() - started;
    const reason = error instanceof Error ? error.message : String(error);
    return {
      id: testCase.id,
      pass: false,
      failures: [`request failed: ${reason}`],
      empty: true,
      ms,
      sources: [],
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs cases with a fixed number of workers, preserving input order in the output. */
async function runAll(cases: EvalCase[]): Promise<CaseResult[]> {
  const results = new Array<CaseResult>(cases.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    for (;;) {
      const index = next++;
      const testCase = cases[index];
      if (!testCase) return;
      const result = await runCase(testCase);
      results[index] = result;
      const mark = result.pass ? 'ok  ' : 'FAIL';
      const detail = result.pass ? '' : `  ← ${result.failures.join('; ')}`;
      console.log(`${mark} ${testCase.id.padEnd(26)} ${String(result.ms).padStart(6)} ms${detail}`);
    }
  });
  await Promise.all(workers);
  return results;
}

function printSummary(summary: EvalSummary): void {
  console.log('');
  console.log(`cases       ${summary.total}`);
  console.log(`passed      ${summary.passed}  (${(summary.passRate * 100).toFixed(0)}%)`);
  console.log(`empty       ${(summary.emptyRate * 100).toFixed(0)}%`);
  console.log(
    `latency     p50 ${summary.latencyMs.p50} ms · p95 ${summary.latencyMs.p95} ms · max ${summary.latencyMs.max} ms`,
  );
  const sources = Object.entries(summary.sourceCounts).sort((a, b) => b[1] - a[1]);
  if (sources.length > 0) {
    console.log(`provenance  ${sources.map(([name, n]) => `${name} ${n}`).join(' · ')}`);
  }
}

async function main(): Promise<void> {
  const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8')) as EvalCase[];
  console.log(`${cases.length} cases → ${BASE_URL}${APP_TOKEN ? ' (token set)' : ' (no token)'}\n`);

  const results = await runAll(cases);
  const summary = summarize(results);
  printSummary(summary);

  const savePath = arg('save');
  if (savePath) {
    await writeFile(savePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`\nbaseline written to ${savePath}`);
  }

  const baselinePath = arg('baseline');
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as EvalSummary;
    const regressions = compareToBaseline(summary, baseline);
    if (regressions.length > 0) {
      console.error(`\nREGRESSION vs ${baselinePath}:`);
      for (const line of regressions) console.error(`  · ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nno regression vs ${baselinePath}`);
  }
}

await main();
