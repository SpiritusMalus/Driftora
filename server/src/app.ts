import express, { type NextFunction, type Request, type Response } from 'express';

import { identifyFromText, VisionUnavailableError } from './gemini.js';
import { Resolver } from './nutrition/resolver.js';
import { buildMealDraft, buildProviders } from './orchestrator.js';
import { emptyMealDraft, type Region } from './types.js';

const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_TEXT = 1000;

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

    try {
      const identified = await identifyFromText(text, region);
      if (identified.length === 0) {
        res.json(emptyMealDraft(region));
        return;
      }
      res.json(await buildMealDraft(resolver, identified, region));
    } catch (err) {
      if (err instanceof VisionUnavailableError) {
        fail(res, 503, 'llm_unavailable', 'The parsing service is temporarily unavailable.');
        return;
      }
      // Never leak the input or a stack trace.
      fail(res, 500, 'internal_error', 'Internal server error.');
    }
  });

  // Photo parsing (Phase 3) is intentionally not wired yet.

  return app;
}
