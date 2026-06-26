import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { identifyFromAudio, identifyFromPhoto, identifyFromText, VisionUnavailableError } from './llm.js';
import { metrics } from './metrics.js';
import { Resolver } from './nutrition/resolver.js';
import { buildMealDraft, buildProviders } from './orchestrator.js';
import { buildLimiters, type RateLimits, resolveLimits } from './rateLimit.js';
import { emptyMealDraft, type IdentifiedItem, type MealDraft, type Region } from './types.js';

const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_TEXT = 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB — client downscales to ≤~1024px
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB — short voice clips are far under this

// In-memory upload (stateless, nothing written to disk) — privacy §2.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES } });
// Separate instance so an audio upload is bounded by its own cap (same size).
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES } });

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

// Static-token gate (skips /health). No user identity, just an app secret.
function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!APP_TOKEN) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== APP_TOKEN) {
    fail(res, 401, 'unauthorized', 'Missing or invalid access token.');
    return;
  }
  next();
}

/** region from the request body, falling back to the server default. */
function regionOf(body: { region?: unknown }): Region {
  return body.region === 'RU' || body.region === 'US' ? body.region : defaultRegion();
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

  // Aggregate, content-free ops counters (privacy §2).
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
    const mimeType = file.mimetype || 'image/jpeg';
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
      fail(res, 500, 'internal_error', 'Internal server error.');
      return;
    }
    next();
  });

  return app;
}
