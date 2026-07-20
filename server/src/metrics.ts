import type { MealDraft, NutritionSource, Region } from './types.js';

/**
 * Process-local, AGGREGATE-ONLY metrics (BUILD SPEC §8.4). Counts and latencies
 * only — NEVER any request content (no meal text, no food names, no photos),
 * honoring the no-content-logging privacy invariant (§2). Resets on restart;
 * scrape `GET /metrics` for basic ops visibility.
 */
class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly requests: Record<string, number> = { text: 0, photo: 0, audio: 0 };
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
  };
  private empty = 0;
  private lowConfidence = 0;
  private escalations = 0;
  /** Answers that hit the token ceiling mid-generation and were re-rolled. */
  private truncationRetries = 0;
  private readonly latency: Record<string, { sum: number; count: number }> = {
    text: { sum: 0, count: 0 },
    photo: { sum: 0, count: 0 },
    audio: { sum: 0, count: 0 },
  };

  /** Record one completed parse from its result draft (no content touched). */
  recordParse(route: 'text' | 'photo' | 'audio', region: Region, draft: MealDraft, ms: number): void {
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
      by_region: { ...this.byRegion },
      empty: this.empty,
      low_confidence: this.lowConfidence,
      escalations: this.escalations,
      truncation_retries: this.truncationRetries,
      label_cache_hits: this.labelCacheHits,
      hedges: this.hedges,
      sources: { ...this.sources },
      latency_ms,
      stage_ms,
    };
  }
}

export const metrics = new MetricsRegistry();
