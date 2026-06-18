import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { identifyFromPhoto, identifyFromText, VisionUnavailableError } from './gemini.js';
import { metrics } from './metrics.js';
import { Resolver } from './nutrition/resolver.js';
import { buildMealDraft, buildProviders } from './orchestrator.js';
import { emptyMealDraft, type IdentifiedItem, type MealDraft, type Region } from './types.js';

const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_TEXT = 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB — client downscales to ≤~1024px

// In-memory upload (stateless, nothing written to disk) — privacy §2.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES } });

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

/**
 * Build the Express app (no listener — see `server.ts`). A custom `resolver`
 * can be injected for tests; production wires it from env-configured providers.
 */
export function createApp(resolver: Resolver = new Resolver(buildProviders())): express.Express {
  const app = express();
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
    route: 'text' | 'photo',
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

  app.post('/food/parse', requireToken, async (req: Request, res: Response) => {
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
  // Gemini vision. The client downscales + strips EXIF before upload; the file
  // stays in memory and is never persisted (privacy §2).
  app.post('/food/parse-photo', requireToken, upload.single('image'), async (req: Request, res: Response) => {
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
