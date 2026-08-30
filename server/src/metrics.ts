import type { MealDraft, NutritionSource, Region } from './types.js';

/**
 * Process-local, AGGREGATE-ONLY metrics (BUILD SPEC §8.4). Counts and latencies
 * only — NEVER any request content (no meal text, no food names, no photos),
 * honoring the no-content-logging privacy invariant (§2). Resets on restart;
 * scrape `GET /metrics` for basic ops visibility.
 */
/** The three food-parse routes (they carry a MealDraft). */
type FoodRoute = 'text' | 'photo' | 'audio';
/** The workout-parse family — same LLM, no draft, only a workout list. */
type WorkoutRoute = 'workout_text' | 'workout_photo' | 'workout_audio';
/** The monetization funnel's steps, in the order a paying user walks them. */
type FunnelStep = 'paywall_shown' | 'checkout_started' | 'payments_succeeded';

/**
 * Latency histogram edges, in ms. Fixed buckets rather than a growing sample:
 * memory stays constant however long the process lives, which is the only
 * property that matters for a registry nobody resets.
 *
 * WHY THIS EXISTS. Every latency number here used to be an AVERAGE, and an
 * average is blind to exactly the failure this file was written to catch. A
 * photo route answering in 20 s on average while one request in twenty takes
 * 55 s looks healthy in `avg` — and 55 s is past the client's 50 s deadline,
 * so that request was hung up on by the phone, billed by us in full, and
 * recorded HERE AS A SUCCESS (`recordParse` runs on the success path; the
 * client's disconnect is invisible to Express). The tail is the part the user
 * lives in; the mean is the part that hides it.
 */
const BUCKET_EDGES_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 12_000, 17_000, 25_000, 35_000, 50_000, 70_000] as const;

/** Sum/count (for the mean everything already reads) plus the shape around it. */
type Timing = { sum: number; count: number; max: number; buckets: number[] };

function newTiming(): Timing {
  return { sum: 0, count: 0, max: 0, buckets: new Array(BUCKET_EDGES_MS.length + 1).fill(0) };
}

function observe(t: Timing, ms: number): void {
  t.sum += ms;
  t.count += 1;
  if (ms > t.max) t.max = ms;
  let i = 0;
  while (i < BUCKET_EDGES_MS.length && ms > BUCKET_EDGES_MS[i]!) i += 1;
  t.buckets[i] = (t.buckets[i] ?? 0) + 1;
}

/**
 * The upper EDGE of the bucket holding the 95th percentile — read it as «95% of
 * these finished within N ms», never as a precise quantile. Deliberately not
 * interpolated: a bucketed p95 dressed up with single-millisecond precision
 * invites decisions the data cannot carry. Past the last edge there is no
 * ceiling to name, so the observed max is the honest answer.
 */
function percentile95(t: Timing): number {
  if (t.count === 0) return 0;
  const target = t.count * 0.95;
  let seen = 0;
  for (let i = 0; i < t.buckets.length; i += 1) {
    seen += t.buckets[i] ?? 0;
    if (seen >= target) return i < BUCKET_EDGES_MS.length ? BUCKET_EDGES_MS[i]! : t.max;
  }
  return t.max;
}

class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly requests: Record<string, number> = {
    text: 0,
    photo: 0,
    audio: 0,
    workout_text: 0,
    workout_photo: 0,
    workout_audio: 0,
  };
  private readonly byRegion: Record<Region, number> = { RU: 0, US: 0 };
  private readonly sources: Record<NutritionSource, number> = {
    usda: 0,
    skurikhin: 0,
    openfoodfacts: 0,
    apininjas: 0,
    fatsecret: 0,
    label: 0,
    ai_estimate: 0,
    estimate: 0,
    community: 0,
  };
  /** Requests that produced NO draft, by route and by cause — see recordFailure. */
  private readonly failures: Record<string, number> = {
    text: 0,
    photo: 0,
    audio: 0,
    workout_text: 0,
    workout_photo: 0,
    workout_audio: 0,
  };
  private readonly failuresByReason: Record<string, number> = { llm_unavailable: 0, internal_error: 0 };
  /**
   * `llm_unavailable` broken down by HOW the model path died (llm.ts strains:
   * timeout / truncated / provider_error / …). The flat reason above says the
   * LLM was down; only this says WHICH of the historical failure modes it was —
   * without it, diagnosing an incident means reconstructing the strain from
   * latency signatures by hand (the 2026-07-20 method).
   */
  private readonly failuresByStrain: Record<string, number> = {};
  private empty = 0;
  private lowConfidence = 0;
  private escalations = 0;
  /** Answers that hit the token ceiling mid-generation and were re-rolled. */
  private truncationRetries = 0;
  private readonly latency: Record<string, Timing> = {
    text: newTiming(),
    photo: newTiming(),
    audio: newTiming(),
    workout_text: newTiming(),
    workout_photo: newTiming(),
    workout_audio: newTiming(),
  };

  /** Record one completed parse from its result draft (no content touched). */
  recordParse(route: FoodRoute, region: Region, draft: MealDraft, ms: number): void {
    this.requests[route] = (this.requests[route] ?? 0) + 1;
    this.byRegion[region] += 1;
    observe((this.latency[route] ??= newTiming()), ms);
    if (draft.items.length === 0) this.empty += 1;
    if (draft.flags.low_confidence) this.lowConfidence += 1;
    for (const item of draft.items) this.sources[item.per100.source] += 1;
  }

  recordEscalation(): void {
    this.escalations += 1;
  }

  /**
   * A completed WORKOUT parse. No MealDraft here — only a workout list — but
   * the family burns the same LLM and used to be invisible in every counter:
   * a 2026-08-12-style upstream failure on the workout schema would have kept
   * /metrics (and slo.yml) green while every workout input died. `empty`
   * joins the shared empty counter — «request that produced nothing» means
   * the same thing on both families and keeps parseSuccess honest.
   */
  recordWorkoutParse(route: WorkoutRoute, empty: boolean, ms: number): void {
    this.requests[route] = (this.requests[route] ?? 0) + 1;
    observe((this.latency[route] ??= newTiming()), ms);
    if (empty) this.empty += 1;
  }

  /**
   * A parse that never produced a draft — the model was unreachable/looping
   * (`llm_unavailable`) or the handler threw (`internal_error`).
   *
   * WHY THIS EXISTS: `recordParse` runs only on the success path, so a failed
   * request was invisible in EVERY counter — it never reached `requests`, so it
   * could not raise the empty rate either. On 2026-08-12 that hid a defect that
   * was failing roughly two thirds of voice notes: `/metrics` showed three
   * healthy audio parses and said nothing about the ones that died. A dashboard
   * that only counts successes reports «здоров» right up until nobody can use
   * the thing.
   */
  recordFailure(
    route: FoodRoute | WorkoutRoute,
    reason: 'llm_unavailable' | 'internal_error',
    strain?: string,
  ): void {
    this.failures[route] = (this.failures[route] ?? 0) + 1;
    this.failuresByReason[reason] = (this.failuresByReason[reason] ?? 0) + 1;
    if (strain) this.failuresByStrain[strain] = (this.failuresByStrain[strain] ?? 0) + 1;
  }

  /** A sustained non-zero count means the token ceiling needs another look. */
  recordTruncationRetry(): void {
    this.truncationRetries += 1;
  }

  /**
   * Per-STAGE timings inside one parse (identify_* / label / resolve /
   * estimator). The per-route latency above says a photo took 19 s; only this
   * says WHERE those seconds went — without it every tuning decision is a
   * reconstruction from ad-hoc logs (which is exactly how this session started).
   */
  private readonly stages: Record<string, Timing> = {};

  recordStage(stage: string, ms: number): void {
    observe((this.stages[stage] ??= newTiming()), ms);
  }

  /** Packaged product whose panel was served from cache — no second vision call. */
  private labelCacheHits = 0;

  /** Per-source count of «could not be reached», see recordSourceUnavailable. */
  private readonly sourceOutages: Record<string, number> = {};
  /** Outages split by WHY, keyed `<source>.<reason>` — see recordSourceUnavailable. */
  private readonly sourceOutageReasons: Record<string, number> = {};

  /** Duplicate vision calls fired because the first was still silent past the
   *  hedge trigger — the price of cutting the slow tail. Sustained growth here
   *  means the trigger sits below the healthy answer time and needs raising. */
  private hedges = 0;

  recordHedge(): void {
    this.hedges += 1;
  }

  recordLabelCacheHit(): void {
    this.labelCacheHits += 1;
  }

  /**
   * A nutrition source refused or never answered (per source name). This used
   * to be invisible: providers swallowed their own outages into an empty list,
   * so a throttled Open Food Facts looked exactly like «этой еды нет» — both to
   * the user and to us. Measured 2026-08-22: OFF answers 503 to ANONYMOUS
   * traffic under load («registered users are not subject to request limits»),
   * and one server IP serves every user, so this counter is the early warning
   * that brand lookups are silently degrading to generic rows.
   */
  recordSourceUnavailable(source: string, reason = 'unknown'): void {
    this.sourceOutages[source] = (this.sourceOutages[source] ?? 0) + 1;
    // The number alone never said WHICH failure it was, so every investigation
    // restarted from curl on the box: throttled, refused, slow and unreachable
    // all landed in one counter and need four different fixes.
    const key = `${source}.${reason}`;
    this.sourceOutageReasons[key] = (this.sourceOutageReasons[key] ?? 0) + 1;
  }

  /**
   * The monetization funnel, one counter per step. `quota_hits` (the step
   * before all of these) lives in the quota snapshot; these three close the
   * missing half: did the person who hit the wall ever SEE the paywall, did
   * they start a payment, did the payment settle. Until now the first and last
   * numbers existed and everything between them was a guess.
   *
   * `paywall_shown` arrives from the client (POST /funnel/paywall) with a
   * source tag — «пришёл с лимита» и «нашёл сам в Ещё» are different funnels.
   * Aggregate-only like everything here: no ids, no content.
   */
  // Typed by its three steps rather than `Record<string, number>`: through the
  // wide type, spreading this into the snapshot erased every key, so
  // `snapshot().funnel.paywall_shown` was a compile error and the funnel could
  // only be read by string index. That is what had `tsconfig.check.json` (the
  // config CI runs, and the only one that includes test/) failing on master.
  private readonly funnel: Record<FunnelStep, number> = {
    paywall_shown: 0,
    checkout_started: 0,
    payments_succeeded: 0,
  };
  private readonly paywallSources: Record<string, number> = {};

  recordFunnel(step: FunnelStep, source?: string): void {
    this.funnel[step] = (this.funnel[step] ?? 0) + 1;
    if (step === 'paywall_shown' && source) {
      this.paywallSources[source] = (this.paywallSources[source] ?? 0) + 1;
    }
  }

  /**
   * Requests whose CLIENT hung up before we answered, by route.
   *
   * THE FAILURE NOBODY COULD SEE. Every per-route budget in this service is
   * honest on its own, but they are spent in SEQUENCE: identify, then the
   * optional escalation, then the label pass. Nothing ever compared the sum
   * against the deadline the phone actually holds (25 s typed, 50 s upload,
   * 12 s for a workout). When the sum wins, six things happen in a row and not
   * one of them reaches a counter: the phone aborts; Express never notices (no
   * `req.on('close')` anywhere, so the upstream call runs to completion and is
   * billed); the AI quota was already spent at the door; `recordParse` files it
   * as a SUCCESS; `avg` buries the outlier; and the user reads «нет интернета»
   * on a connection that is plainly working.
   *
   * This counter is the first link made visible. A non-zero value here means
   * work we paid for that nobody received — and paired with `p95` in
   * `latency_ms` it says exactly which route to shorten.
   */
  private readonly abandoned: Record<string, number> = {};

  recordAbandoned(route: string): void {
    this.abandoned[route] = (this.abandoned[route] ?? 0) + 1;
  }

  /**
   * Does a field the schema marks `required` actually come back? Keyed
   * `<route>.<field>`, as present-out-of-total.
   *
   * WHY MEASURE SOMETHING THE SCHEMA GUARANTEES. Because it does not. #227
   * recorded, from production, that the model «молча не выводит даже как
   * обязательное» — for `weight_basis` and for `prepared` — and the server
   * grew a narrow heuristic (`weighedDry`) to survive the silence. But the
   * observation was never split by ROUTE, and the two candidate causes predict
   * different splits: if the field is missing only on the typed-text path, the
   * cause is that path's schema (it alone lists `weight_basis` in `required`
   * while never declaring the property); if it is missing everywhere, the cause
   * is `strict: false`, under which `required` is a suggestion rather than a
   * grammar. One is a six-line fix, the other is a contract migration. This
   * counter tells them apart from live traffic, at no risk, in a day.
   */
  private readonly schemaFields: Record<string, { present: number; total: number }> = {};

  recordSchemaField(route: string, field: string, present: boolean): void {
    const key = `${route}.${field}`;
    const s = (this.schemaFields[key] ??= { present: 0, total: 0 });
    s.total += 1;
    if (present) s.present += 1;
  }

  /**
   * Token spend per `<call>|<model>`, straight from the `usage` block every
   * OpenRouter completion already carries and nothing was reading.
   *
   * Call COUNTS cannot stand in for this. Three features multiply our spend —
   * the hedge (a duplicate call on the slow tail), the escalation (a second,
   * stronger model at full reasoning depth) and the label pass (a second vision
   * call) — and on this model completion length runs from ~200 tokens to the
   * 6144 ceiling when a decode loop starts. A thirty-fold spread means the
   * number of calls says almost nothing about the bill.
   */
  private readonly tokens: Record<string, { prompt: number; completion: number; calls: number }> = {};

  recordUsage(label: string, promptTokens: number, completionTokens: number): void {
    const t = (this.tokens[label] ??= { prompt: 0, completion: 0, calls: 0 });
    t.prompt += promptTokens;
    t.completion += completionTokens;
    t.calls += 1;
  }

  /**
   * Escalations that actually IMPROVED on the fast model's answer.
   *
   * `escalations` counts attempts, and it is incremented before the verdict is
   * computed — so the most expensive optional call in the service has, until
   * now, had no signal at all about whether it earns its price. Read as a ratio
   * against `escalations`: a low one means `OPENROUTER_PRO_MODEL` is buying
   * latency and tokens and giving back the fast model's answer.
   */
  private escalationsBetter = 0;

  recordEscalationBetter(): void {
    this.escalationsBetter += 1;
  }

  snapshot() {
    // `avg` and `count` keep their names, positions and meanings: checkSlo reads
    // them, and the two new numbers are meant to be read NEXT TO the mean, not
    // instead of it. Nothing that consumes /metrics today has to change.
    const summarize = (t: Timing) => ({
      avg: t.count > 0 ? Math.round(t.sum / t.count) : 0,
      count: t.count,
      p95: percentile95(t),
      max: t.max,
    });
    const latency_ms: Record<string, ReturnType<typeof summarize>> = {};
    for (const [route, t] of Object.entries(this.latency)) latency_ms[route] = summarize(t);
    const stage_ms: Record<string, ReturnType<typeof summarize>> = {};
    for (const [stage, t] of Object.entries(this.stages)) stage_ms[stage] = summarize(t);
    return {
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      requests: { ...this.requests },
      // Sits next to `requests` on purpose: the two are only meaningful read
      // together. `requests` alone is a success count wearing a neutral name.
      failures: { ...this.failures },
      failures_by_reason: { ...this.failuresByReason },
      failures_by_strain: { ...this.failuresByStrain },
      funnel: { ...this.funnel, paywall_sources: { ...this.paywallSources } },
      by_region: { ...this.byRegion },
      empty: this.empty,
      low_confidence: this.lowConfidence,
      escalations: this.escalations,
      escalations_better: this.escalationsBetter,
      truncation_retries: this.truncationRetries,
      abandoned: { ...this.abandoned },
      schema_fields: { ...this.schemaFields },
      tokens: { ...this.tokens },
      label_cache_hits: this.labelCacheHits,
      hedges: this.hedges,
      sources: { ...this.sources },
      source_outages: { ...this.sourceOutages },
      source_outage_reasons: { ...this.sourceOutageReasons },
      latency_ms,
      stage_ms,
    };
  }
}

export const metrics = new MetricsRegistry();
