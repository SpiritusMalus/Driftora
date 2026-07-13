import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import {
  identifyFromAudio,
  identifyFromPhoto,
  identifyFromText,
  parseWorkoutFromAudio,
  parseWorkoutFromPhoto,
  parseWorkoutFromText,
  VisionUnavailableError,
} from './llm.js';
import { metrics } from './metrics.js';
import { Resolver } from './nutrition/resolver.js';
import { buildMealDraft, buildProviders } from './orchestrator.js';
import { buildLimiters, type RateLimits, resolveLimits } from './rateLimit.js';
import {
  coercePer100,
  emptyMealDraft,
  type IdentifiedItem,
  type MealDraft,
  type NutritionAlternative,
  type Region,
} from './types.js';

const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_TEXT = 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB — client downscales to ≤~1024px
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB — short voice clips are far under this

// In-memory upload (stateless, nothing written to disk) — privacy §2.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES } });
// Separate instance so an audio upload is bounded by its own cap (same size).
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES } });

/**
 * Detect the actual image type from magic bytes. The multipart mime is
 * client-supplied and the client always CLAIMS jpeg — but a gallery upload from
 * an older/foreign client can be any format under that label, and a data URL
 * whose declared type contradicts the bytes makes the vision call flaky. Only
 * types the vision models actually accept are named; anything unrecognized
 * returns undefined and the caller keeps the declared mime (today's behavior).
 */
export function sniffImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.toString('ascii', 0, 6))) return 'image/gif';
  // ISO-BMFF `ftyp` box — HEIC/HEIF/AVIF (what iPhones shoot) live here.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand.startsWith('avi')) return 'image/avif';
    if (brand.startsWith('he')) return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }
  return undefined;
}

/** Map an upload's mime/filename to an OpenRouter `input_audio` format token. */
function audioFormat(mime: string | undefined, name: string | undefined): string {
  const s = `${mime ?? ''} ${name ?? ''}`.toLowerCase();
  if (s.includes('wav')) return 'wav';
  if (s.includes('mp3') || s.includes('mpeg')) return 'mp3';
  if (s.includes('ogg') || s.includes('opus')) return 'ogg';
  if (s.includes('flac')) return 'flac';
  if (s.includes('aac')) return 'aac';
  // expo-audio defaults to m4a (AAC in an MP4 container) on iOS + Android.
  return 'm4a';
}

function defaultRegion(): Region {
  return process.env.DEFAULT_REGION === 'RU' ? 'RU' : 'US';
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// Constant-time comparison of the presented token against the app secret, so
// response timing can't be used to recover it byte-by-byte. Both sides are
// hashed to a fixed 32 bytes first: `timingSafeEqual` throws on length-mismatched
// buffers, and the raw length would itself be a (small) leak.
function tokensMatch(presented: string, secret: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

// Static-token gate (skips /health). No user identity, just an app secret.
function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!APP_TOKEN) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokensMatch(token, APP_TOKEN)) {
    fail(res, 401, 'unauthorized', 'Missing or invalid access token.');
    return;
  }
  next();
}

/** region from the request body, falling back to the server default. */
function regionOf(body: { region?: unknown }): Region {
  return body.region === 'RU' || body.region === 'US' ? body.region : defaultRegion();
}

/**
 * Manual-search AI fallback: identify the typed name and turn the model's OWN
 * per-100g estimate into a single honest `ai_estimate` candidate. Only complete
 * estimates (kcal + all three macros) become a row — a partial guess would read
 * as fact. Returns null on any gap, so the caller just shows the empty DB result.
 * The number still comes from the model's estimate field, never invented here
 * (THE HONESTY RULE) — and the source tag makes the client render it with «≈».
 */
async function aiSearchEstimate(query: string, region: Region): Promise<NutritionAlternative | null> {
  const items = await identifyFromText(query, region);
  const est = items[0]?.estimate;
  if (
    !est ||
    est.kcal_100g === undefined ||
    est.prot_100g === undefined ||
    est.fat_100g === undefined ||
    est.carb_100g === undefined
  ) {
    return null;
  }
  const per100 = coercePer100({
    source: 'ai_estimate',
    kcal: est.kcal_100g,
    prot: est.prot_100g,
    fat: est.fat_100g,
    carb: est.carb_100g,
  });
  return { name: items[0]?.name_ru || query, per100 };
}

/** Options for `createApp` (mirrors the injectable-resolver pattern). */
export interface CreateAppOptions {
  /** Override per-IP rate limits (tests set tiny, deterministic caps). */
  limits?: Partial<RateLimits>;
}

/**
 * Build the Express app (no listener — see `server.ts`). A custom `resolver`
 * can be injected for tests; production wires it from env-configured providers.
 */
export function createApp(
  resolver: Resolver = new Resolver(buildProviders()),
  opts: CreateAppOptions = {},
): express.Express {
  const app = express();

  // Caddy is a single hop (family-pie/Caddyfile reverse_proxy → 127.0.0.1:8787),
  // so trust exactly 1 proxy and read the real client IP from X-Forwarded-For.
  // Use the integer hop count, never `true` (spoofable, rejected by the limiter).
  // Bump only if a CDN/LB is ever added in front.
  //
  // ⚠️ SECURITY INVARIANT: the fronting proxy (Caddy) MUST overwrite the inbound
  // X-Forwarded-For with the real remote address — it must not append to a
  // client-supplied one. Otherwise a client can spoof its IP and each request
  // looks like a fresh IP to the rate limiter, defeating the per-IP caps entirely
  // (burst + daily) and letting one attacker fan out unbounded paid LLM/USDA
  // calls. Verify the Caddyfile sets `X-Forwarded-For {http.request.remote.host}`.
  app.set('trust proxy', 1);

  const limiters = buildLimiters(resolveLimits(opts.limits), fail);

  // Global per-IP burst guard, before body parsing/routes so abuse is cheap to
  // reject; /health is never limited (skip lives in the limiter).
  app.use(limiters.burst);

  app.use(express.json({ limit: '16kb' }));

  // Minimal CORS — only emitted when an origin is configured.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (ALLOWED_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Aggregate, content-free ops counters (privacy §2). NOTE: `requireToken` is a
  // no-op when APP_TOKEN is unset, so on a tokenless deployment /metrics (like
  // every route) is public — operational counts become visible to anyone. That's
  // acceptable only if running behind a network boundary; set APP_TOKEN otherwise.
  app.get('/metrics', requireToken, (_req: Request, res: Response) => {
    res.json(metrics.snapshot());
  });

  // Shared tail for both inputs: identified items → resolved MealDraft, with the
  // same error mapping + aggregate metrics. Never leaks the input or a stack trace.
  async function respondWithDraft(
    res: Response,
    route: 'text' | 'photo' | 'audio',
    region: Region,
    identify: () => Promise<IdentifiedItem[]>,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const identified = await identify();
      const draft: MealDraft =
        identified.length === 0 ? emptyMealDraft(region) : await buildMealDraft(resolver, identified, region);
      metrics.recordParse(route, region, draft, Date.now() - startedAt);
      res.json(draft);
    } catch (err) {
      if (err instanceof VisionUnavailableError) {
        fail(res, 503, 'llm_unavailable', 'The parsing service is temporarily unavailable.');
        return;
      }
      fail(res, 500, 'internal_error', 'Internal server error.');
    }
  }

  app.post('/food/parse', requireToken, limiters.textDaily, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { text?: unknown; region?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const region = regionOf(body);

    if (text.length === 0) {
      fail(res, 400, 'empty_input', 'Field "text" is required and cannot be empty.');
      return;
    }
    if (text.length > MAX_TEXT) {
      fail(res, 400, 'input_too_long', `Field "text" must be at most ${MAX_TEXT} characters.`);
      return;
    }

    await respondWithDraft(res, 'text', region, () => identifyFromText(text, region));
  });

  // Free-text DB search for the manual "find it yourself" picker (disambiguation
  // layer 4). Returns ranked candidates ({ candidates: NutritionAlternative[] }),
  // never a stack trace. Reuses the text daily cap (it hits the same providers).
  app.post('/food/search', requireToken, limiters.textDaily, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { query?: unknown; region?: unknown; ai?: unknown };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const region = regionOf(body);
    if (query.length === 0) {
      fail(res, 400, 'empty_input', 'Field "query" is required and cannot be empty.');
      return;
    }
    if (query.length > MAX_TEXT) {
      fail(res, 400, 'input_too_long', `Field "query" must be at most ${MAX_TEXT} characters.`);
      return;
    }
    const candidates = await resolver.search(query, region).catch(() => []);
    // When the DBs return NOTHING and the client holds AI consent (`ai: true`),
    // fall back to an LLM per-100g estimate so «Найти вручную» is never a dead
    // end — the long-tail/branded products the RU DBs miss still get a usable,
    // honestly-flagged («≈», source ai_estimate) row the user can accept or edit.
    if (candidates.length === 0 && body.ai === true) {
      const est = await aiSearchEstimate(query, region).catch(() => null);
      if (est) {
        res.json({ candidates: [est] });
        return;
      }
    }
    res.json({ candidates });
  });

  // Free-text WORKOUT parse: `{ text }` → `{ workouts: ParsedWorkout[] }`. The
  // model only maps text → structured activities (type/minutes/pace); kcal is
  // computed client-side from the user's weight, so no energy numbers cross the
  // wire. Reuses the text daily cap (one cheap LLM call, same cost profile).
  app.post('/workout/parse', requireToken, limiters.textDaily, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length === 0) {
      fail(res, 400, 'empty_input', 'Field "text" is required and cannot be empty.');
      return;
    }
    if (text.length > MAX_TEXT) {
      fail(res, 400, 'input_too_long', `Field "text" must be at most ${MAX_TEXT} characters.`);
      return;
    }
    try {
      const workouts = await parseWorkoutFromText(text);
      res.json({ workouts });
    } catch (err) {
      failWorkoutParse(res, err);
    }
  });

  /// Shared error tail for the workout parse family: the model only ever maps
  /// input → structured activities, so every route answers the same way.
  function failWorkoutParse(res: Response, err: unknown): void {
    if (err instanceof VisionUnavailableError) {
      fail(res, 503, 'llm_unavailable', 'The parsing service is temporarily unavailable.');
      return;
    }
    fail(res, 500, 'internal_error', 'Internal server error.');
  }

  // Spoken WORKOUT: multipart `audio` → `{ workouts }`. Same honesty split as
  // the text parse (kcal client-side); the clip stays in memory, never persisted.
  app.post('/workout/parse-audio', requireToken, limiters.photoDaily, uploadAudio.single('audio'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "audio" is required.');
      return;
    }
    const format = audioFormat(file.mimetype, file.originalname);
    try {
      const workouts = await parseWorkoutFromAudio(file.buffer.toString('base64'), format);
      res.json({ workouts });
    } catch (err) {
      failWorkoutParse(res, err);
    }
  });

  // Fitness-tracker SCREENSHOT: multipart `image` → `{ workouts, device_kcal?,
  // device_minutes? }`. The tracker's own printed totals are transcribed and,
  // when present, the client logs THEM («по трекеру») instead of re-deriving.
  app.post('/workout/parse-photo', requireToken, limiters.photoDaily, upload.single('image'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "image" is required.');
      return;
    }
    const mimeType = sniffImageMime(file.buffer) ?? (file.mimetype || 'image/jpeg');
    try {
      const parsed = await parseWorkoutFromPhoto(file.buffer.toString('base64'), mimeType);
      res.json(parsed);
    } catch (err) {
      failWorkoutParse(res, err);
    }
  });

  // Photo input (BUILD SPEC §5.1): multipart `image` + `region` → MealDraft via
  // the vision model. The client downscales + strips EXIF before upload; the file
  // stays in memory and is never persisted (privacy §2).
  // Daily cap runs before multer buffers the (up to 8 MB) upload and before the
  // vision call, so an over-limit request is rejected cheaply.
  app.post('/food/parse-photo', requireToken, limiters.photoDaily, upload.single('image'), async (req: Request, res: Response) => {
    const region = regionOf((req.body ?? {}) as { region?: unknown });
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "image" is required.');
      return;
    }
    // Trust the bytes over the client's label — see `sniffImageMime`.
    const mimeType = sniffImageMime(file.buffer) ?? (file.mimetype || 'image/jpeg');
    const base64 = file.buffer.toString('base64');
    await respondWithDraft(res, 'photo', region, () => identifyFromPhoto(base64, mimeType, region));
  });

  // Voice input: multipart `audio` (a short spoken meal description) + `region` →
  // MealDraft via the multimodal model. The clip stays in memory and is never
  // persisted (privacy §2). Reuses the photo daily cap (similar cost profile).
  app.post('/food/parse-audio', requireToken, limiters.photoDaily, uploadAudio.single('audio'), async (req: Request, res: Response) => {
    const region = regionOf((req.body ?? {}) as { region?: unknown });
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "audio" is required.');
      return;
    }
    const format = audioFormat(file.mimetype, file.originalname);
    const base64 = file.buffer.toString('base64');
    await respondWithDraft(res, 'audio', region, () => identifyFromAudio(base64, format, region));
  });

  // Map multer rejections (e.g. oversized upload) to a clean error envelope.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      fail(res, tooLarge ? 413 : 400, tooLarge ? 'image_too_large' : 'bad_upload', err.message);
      return;
    }
    if (err) {
      // express.json() rejects an oversized body with a PayloadTooLargeError
      // (type 'entity.too.large', status 413). Report it honestly so clients
      // treat it as "don't resend" rather than a transient 500 to retry.
      const e = err as { type?: string; status?: number; statusCode?: number };
      if (e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413) {
        fail(res, 413, 'input_too_large', 'Request body is too large.');
        return;
      }
      fail(res, 500, 'internal_error', 'Internal server error.');
      return;
    }
    next();
  });

  return app;
}
