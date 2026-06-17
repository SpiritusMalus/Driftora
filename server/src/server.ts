import express, { type NextFunction, type Request, type Response } from 'express';

import { parseFood, ParserUnavailableError } from './parser.js';

const PORT = Number(process.env.PORT) || 8787;
const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_UTTERANCE = 1000;

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

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post('/food/parse', requireToken, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { utterance?: unknown };
  const utterance = typeof body.utterance === 'string' ? body.utterance.trim() : '';

  if (utterance.length === 0) {
    fail(res, 400, 'empty_input', 'Поле utterance обязательно и не может быть пустым.');
    return;
  }
  if (utterance.length > MAX_UTTERANCE) {
    fail(res, 400, 'input_too_long', `Поле utterance не длиннее ${MAX_UTTERANCE} символов.`);
    return;
  }

  try {
    const result = await parseFood(utterance);
    res.json(result);
  } catch (err) {
    if (err instanceof ParserUnavailableError) {
      fail(res, 503, 'llm_unavailable', 'Сервис разбора временно недоступен.');
      return;
    }
    // Never leak the utterance or a stack trace.
    fail(res, 500, 'internal_error', 'Внутренняя ошибка сервера.');
  }
});

app.listen(PORT, () => {
  // Aggregate tech log only — no request bodies, no utterances.
  console.log(`food-parse service listening on :${PORT}`);
});
