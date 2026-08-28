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
  private readonly latency: Record<string, { sum: number; count: number }> = {
    text: { sum: 0, count: 0 },
    photo: { sum: 0, count: 0 },
    audio: { sum: 0, count: 0 },
    workout_text: { sum: 0, count: 0 },
    workout_photo: { sum: 0, count: 0 },
    workout_audio: { sum: 0, count: 0 },
  };

  /** Record one completed parse from its result draft (no content touched). */
  recordParse(route: FoodRoute, region: Region, draft: MealDraft, ms: number): void {
    this.requests[route] = (this.requests[route] ?? 0) + 1;
    this.byRegion[region] += 1;
    const lat = this.latency[route];
    if (lat) {
      lat.sum += ms;
      lat.count += 1;
    }
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
    const lat = (this.latency[route] ??= { sum: 0, count: 0 });
    lat.sum += ms;
    lat.count += 1;
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
  private readonly stages: Record<string, { sum: number; count: number }> = {};

  recordStage(stage: string, ms: number): void {
    const s = (this.stages[stage] ??= { sum: 0, count: 0 });
    s.sum += ms;
    s.count += 1;
  }

  /** Packaged product whose panel was served from cache — no second vision call. */
  private labelCacheHits = 0;

  /** Per-source count of «could not be reached», see recordSourceUnavailable. */
  private readonly sourceOutages: Record<string, number> = {};

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
  recordSourceUnavailable(source: string): void {
    this.sourceOutages[source] = (this.sourceOutages[source] ?? 0) + 1;
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

  snapshot() {
    const latency_ms: Record<string, { avg: number; count: number }> = {};
    for (const [route, { sum, count }] of Object.entries(this.latency)) {
      latency_ms[route] = { avg: count > 0 ? Math.round(sum / count) : 0, count };
    }
    const stage_ms: Record<string, { avg: number; count: number }> = {};
    for (const [stage, { sum, count }] of Object.entries(this.stages)) {
      stage_ms[stage] = { avg: count > 0 ? Math.round(sum / count) : 0, count };
    }
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
      truncation_retries: this.truncationRetries,
      label_cache_hits: this.labelCacheHits,
      hedges: this.hedges,
      sources: { ...this.sources },
      source_outages: { ...this.sourceOutages },
      latency_ms,
      stage_ms,
    };
  }
}

export const metrics = new MetricsRegistry();
