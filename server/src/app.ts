import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import {
  estimateFoodPer100,
  identifyFromAudio,
  identifyFromPhoto,
  readPackageLabel,
  identifyFromText,
  parseWorkoutFromAudio,
  parseWorkoutFromPhoto,
  parseWorkoutFromText,
  VisionUnavailableError,
} from './llm.js';
import { metrics } from './metrics.js';
import { Resolver } from './nutrition/resolver.js';
import {
  createCommunityFoods,
  CommunityProvider,
  sanitizeFoodName,
  sanitizeSample,
  type CommunityFoods,
} from './nutrition/community.js';
import { buildMealDraft, buildProviders } from './orchestrator.js';
import { localizeAlternatives, localizeDraft } from './nutrition/translateNames.js';
import { createInstallQuota, installIdOf } from './installQuota.js';
import { createEntitlements, type PurchaseVerifier } from './entitlements.js';
import { createGooglePlayVerifier } from './billing/googlePlay.js';
import { createLicenses, DEFAULT_PLAN, normalizeKey, PLAN_DAYS, type Licenses } from './billing/licenses.js';
import {
  createYooKassaClient,
  createYooKassaPaymentCreator,
  createYooKassaWebhook,
  resolvePrices,
  type CheckoutDraft,
  type CreatedPayment,
  type YooKassaPayment,
} from './billing/yookassa.js';
import { renderDonePage } from './billing/returnPage.js';
// Aliased: `resolveGoogleVerifier` in this file already means the Google PLAY
// PURCHASE verifier. Identity and billing are different Googles, and one name
// for both is how they get confused.
import { resolveGoogleVerifier as resolveGoogleIdentity, type GoogleVerifier } from './billing/googleIdentity.js';
import { buildLimiters, type RateLimits, resolveLimits } from './rateLimit.js';
import {
  coercePer100,
  emptyMealDraft,
  type IdentifiedItem,
  type LabelReading,
  type MealDraft,
  type NutritionAlternative,
  type Region,
} from './types.js';

const APP_TOKEN = process.env.APP_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_TEXT = 1000;
// Where the SHARED food base lives. Unset ⇒ the feature is OFF: nothing is
// stored, nothing is served, and the provider chain is exactly what it was
// before it existed. A deliberate switch, because this is the one store in the
// service that holds anything a user typed.
const COMMUNITY_FOODS_PATH = process.env.COMMUNITY_FOODS_PATH || '';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB — client downscales to ≤~1024px
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB — short voice clips are far under this

// In-memory upload (stateless, nothing written to disk) — privacy §2.
// `fileSize` alone leaves multer's OTHER limits unbounded: without `fields`/
// `parts`/`fieldSize` caps a single multipart request with thousands of text
// fields accumulates them all in memory until OOM. Routes send one file plus
// a couple of small string fields — cap accordingly.
const MULTIPART_LIMITS = { files: 1, fields: 8, parts: 12, fieldSize: 10 * 1024 };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, ...MULTIPART_LIMITS } });
// Separate instance so an audio upload is bounded by its own cap (same size).
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, ...MULTIPART_LIMITS },
});

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

/**
 * `install + product name → panel reading` cache for the dedicated label pass.
 * Insertion-ordered Map as a tiny LRU (same idiom as the resolver's lookup
 * caches). Process-local and reset on restart — a panel is stable per product,
 * so even a short-lived cache absorbs the common case: the same «Бабаевский»
 * logged for the third time this week.
 *
 * SCOPED PER INSTALL, and skipped entirely without an install id. The key is
 * the identified name, and that name is only as specific as the photo allowed:
 * the prompt asks for the brand «when it is legible», so an unbranded or
 * badly-lit wrapper yields a generic «творог 5%». Globally shared, that key
 * makes one user's panel answer another user's photo of a DIFFERENT product —
 * and a panel is shown as «по упаковке», a claim of fact, so the wrong numbers
 * arrive with no «≈» and the package actually photographed is never read.
 * Scoping keeps the repeat-purchase win (same person, same product) and leaves
 * only a collision inside one install's own foods.
 */
const labelCache = new Map<string, LabelReading>();
const LABEL_CACHE_MAX = 300;
function rememberLabel(key: string, value: LabelReading): void {
  if (labelCache.has(key)) labelCache.delete(key); // refresh recency
  labelCache.set(key, value);
  if (labelCache.size > LABEL_CACHE_MAX) {
    const oldest = labelCache.keys().next().value;
    if (oldest !== undefined) labelCache.delete(oldest);
  }
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
 * Manual-search AI card: the user's typed name turned into ONE honest
 * `ai_estimate` candidate, shown ALONGSIDE the DB rows (not just as a fallback).
 * Uses the dedicated `estimateFoodPer100` — which always answers and reads the
 * BRAND/intent the generic DBs can't («масло простоквашино», «сыр тысяча озёр
 * лёгкий») — so the user sees both «по базе» and «через ИИ» and picks. The
 * source tag makes the client render it with «≈». Null on a failed model call.
 */
async function aiSearchCard(query: string, region: Region): Promise<NutritionAlternative | null> {
  const est = await estimateFoodPer100(query, region);
  if (!est) return null;
  const per100 = coercePer100({
    source: 'ai_estimate',
    kcal: est.kcal,
    prot: est.prot,
    fat: est.fat,
    carb: est.carb,
  });
  return { name: est.name, per100 };
}

/** Options for `createApp` (mirrors the injectable-resolver pattern). */
export interface CreateAppOptions {
  /** Override per-IP rate limits (tests set tiny, deterministic caps). */
  limits?: Partial<RateLimits>;
  /** Override the per-install daily AI quota (tests set tiny caps; 0 disables). */
  aiQuotaPerDay?: number;
  /** Override the paid-tier daily AI quota. */
  aiQuotaPerDayPaid?: number;
  /** Inject a purchase verifier (tests); production builds one from env. */
  verifyPurchase?: PurchaseVerifier;
  /** Where entitlements persist. Empty string = memory only (tests). */
  entitlementsPath?: string;
  /** Where issued ЮKassa licences persist. Empty string = memory only (tests). */
  licensesPath?: string;
  /** Inject the ЮKassa payment reader (tests); production builds one from env. */
  getYooKassaPayment?: (id: string) => Promise<YooKassaPayment>;
  /** Inject the ЮKassa payment creator (tests); production builds one from env. */
  createYooKassaPayment?: (draft: CheckoutDraft) => Promise<CreatedPayment>;
  /** Override the ЮKassa source-IP allowlist (tests). */
  yooKassaCidrs?: readonly string[];
  /** Skip the webhook's source-IP gate (env: YOOKASSA_WEBHOOK_OPEN=1) — see WebhookOptions.open. */
  yooKassaWebhookOpen?: boolean;
  /** Inject the Google ID-token verifier (tests); production builds one from env. */
  verifyGoogleIdToken?: GoogleVerifier;
}

/**
 * Try each adapter until one recognises the string.
 *
 * The subtlety worth spelling out: "no adapter recognised it" and "an adapter
 * could not reach its store" must stay different answers. If Google times out
 * while the licence table simply has no such key, calling the purchase INVALID
 * would tell a paying customer their subscription is fake. So an error from any
 * adapter is rethrown unless some other adapter produced a real verdict.
 */
function chainVerifiers(verifiers: PurchaseVerifier[]): PurchaseVerifier {
  return async (purchaseToken, productId) => {
    let failure: unknown = null;
    for (const verify of verifiers) {
      try {
        const verdict = await verify(purchaseToken, productId);
        if (verdict) return verdict;
      } catch (err) {
        failure = err;
      }
    }
    if (failure) throw failure;
    return null;
  };
}

/**
 * Build the Google Play adapter, or null when this deployment does not sell
 * through the store.
 *
 * Billing is OPT-IN by configuration: today's prod has no service account, and a
 * server that refused to boot without one would take food parsing down for
 * everybody in exchange for a feature nobody has bought yet. Absent config means
 * "free tier for all", which is exactly the current behaviour.
 */
function resolveGoogleVerifier(injected?: PurchaseVerifier): PurchaseVerifier | null {
  if (injected) return injected;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    return createGooglePlayVerifier();
  } catch (err) {
    // Misconfigured is worse than unconfigured: someone MEANT to sell here and
    // the app would look healthy while every purchase silently failed.
    console.error('billing: google verifier unavailable:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Same opt-in rule for direct ЮKassa sales. */
function resolveYooKassaReader(
  injected?: (id: string) => Promise<YooKassaPayment>,
): ((id: string) => Promise<YooKassaPayment>) | null {
  if (injected) return injected;
  if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) return null;
  try {
    return createYooKassaClient();
  } catch (err) {
    console.error('billing: yookassa unavailable:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** …and for the outbound half: creating the payment the webhook later settles. */
function resolvePaymentCreator(
  injected?: (draft: CheckoutDraft) => Promise<CreatedPayment>,
): ((draft: CheckoutDraft) => Promise<CreatedPayment>) | null {
  if (injected) return injected;
  if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) return null;
  try {
    return createYooKassaPaymentCreator();
  } catch (err) {
    console.error('billing: yookassa checkout unavailable:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Absolute base for the ЮKassa `return_url`.
 *
 * Prefers `BILLING_PUBLIC_URL` and falls back to the request's own host. The
 * fallback is safe for exactly one reason worth writing down: the only use is
 * sending the payer's browser BACK to where it already is, so a forged Host
 * header can only redirect the attacker to their own page. Never reuse this
 * value for anything a third party is asked to trust.
 */
function publicBaseUrl(req: Request): string {
  const configured = (process.env.BILLING_PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host') ?? ''}`;
}

/** Rough shape check — a full RFC validator would reject addresses that work. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/**
 * Origins allowed to drive a purchase from a browser: our own marketing site.
 *
 * This is both the CORS allowlist for `/billing/*` and the allowlist a
 * `return_url` must match. One list, because they answer the same question —
 * "is this page ours?" — and two lists would drift until one of them let a
 * stranger's page send our buyers somewhere after paying.
 */
function siteOrigins(): string[] {
  const raw = process.env.BILLING_WEB_ORIGINS ?? 'https://family-pie.ru,https://www.family-pie.ru';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Is this somewhere we are willing to send a payer after they pay?
 *
 * Compared as a parsed origin, never as a string prefix: `startsWith` would
 * accept `https://family-pie.ru.evil.test/…`, which is exactly the open redirect
 * this guard exists to prevent.
 */
function isAllowedReturnUrl(value: string, allowed: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return allowed.includes(parsed.origin);
}

/**
 * The process-wide SHARED food base.
 *
 * Exactly one instance, because the provider that SERVES community rows and the
 * route that RECORDS them have to be looking at the same store — two would mean
 * a contribution shows up only after a restart. Lazy, so a deployment without
 * `COMMUNITY_FOODS_PATH` never opens a file for a feature it does not run.
 */
let communityFoodsSingleton: CommunityFoods | null = null;
function defaultCommunityFoods(): CommunityFoods {
  communityFoodsSingleton ??= createCommunityFoods(COMMUNITY_FOODS_PATH);
  return communityFoodsSingleton;
}

/**
 * One line for the startup log: is the shared food base on, and how many foods
 * did it load. Reported because "off" and "broken" look identical from a phone —
 * an unset COMMUNITY_FOODS_PATH gives an app whose «общая база» search answers
 * «ничего не нашлось» forever and whose sharing toggle does nothing visible.
 */
export function communityBaseStatus(): string {
  if (!COMMUNITY_FOODS_PATH) {
    return 'OFF (COMMUNITY_FOODS_PATH is not set — nothing is stored or served)';
  }
  return `ON — ${defaultCommunityFoods().size()} foods from ${COMMUNITY_FOODS_PATH}`;
}

/**
 * Build the Express app (no listener — see `server.ts`). A custom `resolver`
 * can be injected for tests; production wires it from env-configured providers.
 */
export function createApp(
  // The estimator fills DB misses for the photo path, which no longer asks the
  // vision model for nutrition numbers — see IDENTIFY_PHOTO_SYSTEM_PROMPT.
  resolver: Resolver = new Resolver(
    buildProviders(COMMUNITY_FOODS_PATH ? new CommunityProvider(defaultCommunityFoods()) : undefined),
    async (name, region) => {
      // Timed wrapper: the on-demand estimator is a whole extra model call per
      // suspicious row — stage_ms.estimator is how we notice it getting greedy.
      const t0 = Date.now();
      try {
        return await estimateFoodPer100(name, region);
      } finally {
        metrics.recordStage('estimator', Date.now() - t0);
      }
    },
  ),
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

  // Who has paid. Consulted by the quota below for its cap, and by /billing/*.
  // Two ways in, one notion of entitlement: a Google Play purchase token and a
  // ЮKassa licence key arrive through the SAME /billing/register field, and the
  // chain decides which adapter owns the string.
  const googleVerifier = resolveGoogleVerifier(opts.verifyPurchase);
  const getYooKassaPayment = resolveYooKassaReader(opts.getYooKassaPayment);
  const createYooKassaPayment = resolvePaymentCreator(opts.createYooKassaPayment);
  const licenses: Licenses = createLicenses({ path: opts.licensesPath });

  const verifiers: PurchaseVerifier[] = [];
  // Licences first: a local lookup that costs nothing, before any network hop.
  if (getYooKassaPayment) verifiers.push(licenses.verifier);
  if (googleVerifier) verifiers.push(googleVerifier);
  const billingEnabled = verifiers.length > 0;

  const verifyGoogleIdToken = opts.verifyGoogleIdToken ?? resolveGoogleIdentity();

  const entitlements = createEntitlements({
    verify: chainVerifiers(verifiers),
    path: opts.entitlementsPath,
  });

  // The SHARED food base — the same instance the provider chain reads, so a
  // contribution is findable by the next person immediately rather than after a
  // restart. Unconfigured ⇒ memory-only: writes are accepted and forgotten, and
  // the chain has no community provider at all.
  const communityFoods = defaultCommunityFoods();

  // Per-install daily AI budget (the CGNAT-safe layer; per-IP caps stay as the
  // abuse backstop). Mounted on the six LLM-burning parse routes only — the DB
  // search stays under the per-IP caps, so a quota'd-out user can still look
  // things up by hand.
  const aiQuota = createInstallQuota(fail, {
    perDay: opts.aiQuotaPerDay,
    perDayPaid: opts.aiQuotaPerDayPaid,
    isPaid: entitlements.isPaid,
  });

  // Global per-IP burst guard, before body parsing/routes so abuse is cheap to
  // reject; /health is never limited (skip lives in the limiter).
  app.use(limiters.burst);

  app.use(express.json({ limit: '16kb' }));

  const webOrigins = siteOrigins();

  /**
   * CORS for the billing endpoints only.
   *
   * The global handler above answers to `ALLOWED_ORIGIN`, which is unset in prod
   * (the app is native and needs no CORS). The purchase page is a browser page
   * on another origin, so it needs its own, narrower grant — and it stays
   * narrow: named origins, no credentials, and only on `/billing/*`.
   */
  app.use('/billing', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (origin && webOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
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

  app.post('/billing/checkout', limiters.billingDaily, async (req: Request, res: Response) => {
    if (!createYooKassaPayment) {
      fail(res, 503, 'billing_unavailable', 'This deployment does not sell subscriptions.');
      return;
    }
    const body = (req.body ?? {}) as {
      plan?: unknown;
      email?: unknown;
      license_key?: unknown;
      return_url?: unknown;
    };

    // An unknown plan is REJECTED rather than defaulted: silently falling back to
    // monthly would charge someone who asked for a year the wrong amount and
    // give them the wrong thing, which is the one failure here that costs money.
    const plan = typeof body.plan === 'string' ? body.plan.trim() : DEFAULT_PLAN;
    // Object.hasOwn, not `in`: `'constructor' in PLAN_DAYS` is true via the
    // prototype, and prices['constructor'] is a (truthy) Function — the junk
    // plan then reached ЮKassa as a payment without an amount and surfaced as
    // a bogus 502 store_unreachable instead of this honest 400.
    if (!Object.hasOwn(PLAN_DAYS, plan) || !prices[plan]) {
      fail(res, 400, 'unknown_plan', 'No such subscription plan.');
      return;
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (receiptRequired && !looksLikeEmail(email)) {
      // The shop issues fiscal receipts, and ЮKassa rejects a receipt without a
      // customer contact — better a clear field error than a failed payment.
      fail(res, 400, 'email_required', 'An email address is required for the receipt.');
      return;
    }
    if (email && !looksLikeEmail(email)) {
      fail(res, 400, 'invalid_email', 'That email address does not look valid.');
      return;
    }

    // Renewal: the key must be one we issued. Passing an unrecognised string
    // through would make the typo itself the new licence key — the buyer would
    // pay and then not find their subscription where they expected it.
    const rawKey = typeof body.license_key === 'string' ? body.license_key.trim() : '';
    const licenseKey = rawKey ? normalizeKey(rawKey) : '';
    if (licenseKey && !licenses.byKey(licenseKey)) {
      fail(res, 404, 'unknown_license', 'We do not know that licence key. Leave the field empty to get a new one.');
      return;
    }

    // The web page sends its own return page; the app sends nothing and gets the
    // service's own. Allowlisted by ORIGIN — an unchecked return_url here would
    // turn a payment link into an open redirect wearing our domain.
    const askedReturn = typeof body.return_url === 'string' ? body.return_url.trim() : '';
    if (askedReturn && !isAllowedReturnUrl(askedReturn, webOrigins)) {
      fail(res, 400, 'invalid_return_url', 'That return_url is not one of ours.');
      return;
    }

    try {
      const payment = await createYooKassaPayment({
        plan,
        email: email || undefined,
        licenseKey: licenseKey || undefined,
        returnUrl: askedReturn || `${publicBaseUrl(req)}/billing/done`,
      });
      res.json({
        payment_id: payment.id,
        confirmation_url: payment.confirmationUrl,
        plan,
        amount: payment.amount,
      });
    } catch (err) {
      console.error('billing: checkout failed:', err instanceof Error ? err.message : String(err));
      fail(res, 502, 'store_unreachable', 'Could not start the payment. Try again in a minute.');
    }
  });


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
    // `ai_quota` rides alongside the registry snapshot: the anonymous usage
    // histogram that will size the free tier / fair-use cap from real behavior.
    res.json({
      ...metrics.snapshot(),
      ai_quota: aiQuota.snapshot(),
      billing: { ...entitlements.snapshot(), ...licenses.snapshot() },
    });
  });

  /**
   * ЮKassa notification endpoint.
   *
   * Deliberately NOT behind `requireToken`: ЮKassa has no way to send our app
   * token. Authentication is the source-IP allowlist inside the handler, which
   * is the mechanism ЮKassa itself prescribes — and the handler re-reads the
   * payment through the API rather than believing the body.
   */
  const yooKassaWebhook = getYooKassaPayment
    ? createYooKassaWebhook({
        licenses,
        getPayment: getYooKassaPayment,
        cidrs: opts.yooKassaCidrs,
        // fam's nginx SNI-router loses the client IP (backend sees 127.0.0.1),
        // so the IP gate there rejects ЮKassa itself — see WebhookOptions.open.
        open: opts.yooKassaWebhookOpen ?? process.env.YOOKASSA_WEBHOOK_OPEN === '1',
      })
    : null;
  // Mounted unconditionally even when unconfigured, so the route stays visible
  // to the openapi contract test instead of vanishing from the spec's view.
  // billingDaily bounds the open-gate mode's spam surface (each POST is a
  // potential API call to ЮKassa); a 429 is safe — they redeliver for 24h.
  app.post('/billing/yookassa/webhook', limiters.billingDaily, (req: Request, res: Response) => {
    if (!yooKassaWebhook) {
      fail(res, 503, 'billing_unavailable', 'This deployment does not sell subscriptions.');
      return;
    }
    void yooKassaWebhook(req, res);
  });

  /**
   * Start a purchase: create a ЮKassa payment and hand back where to send the
   * payer. The webhook above settles it and mints the licence.
   *
   * No `requireToken`, same reason as `/billing/license`: the caller is a web
   * page, which cannot hold the app token. Creating a payment moves no money and
   * commits nobody — the payer still has to complete it at ЮKassa — so the
   * exposure is a per-IP-capped stream of abandoned payments, not a loss.
   */
  const prices = resolvePrices();
  const receiptRequired = process.env.BILLING_RECEIPT === '1';
  // Where the purchase page lives. The app never opens it (it creates payments
  // natively), so this is purely the web front door.
  const salesPageUrl = process.env.BILLING_SALES_URL || `${webOrigins[0] ?? ''}/driftora/subscription`;

  /**
   * What is on sale, for the app's native purchase screen.
   *
   * The price lives on the server for the same reason the quota caps do: an APK
   * with 199 ₽ baked into it can only be corrected by a store release, and the
   * store release is the slowest thing in this whole product. Unauthenticated,
   * because a price list is public by definition.
   */
  app.get('/billing/plans', (_req: Request, res: Response) => {
    res.json({
      enabled: Boolean(createYooKassaPayment),
      receipt_required: receiptRequired,
      currency: 'RUB',
      plans: Object.keys(PLAN_DAYS)
        .filter((plan) => prices[plan])
        .map((plan) => ({
          id: plan,
          days: PLAN_DAYS[plan],
          amount: prices[plan]?.amount ?? '',
          description: prices[plan]?.description ?? '',
        })),
    });
  });

  /** Locks the two HTML pages down to what they actually use. */
  function sendPage(res: Response, html: string): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(html);
  }

  /**
   * Kept as the stable address of "where you buy", now pointing at the real
   * page on the site.
   *
   * The purchase page used to be rendered here, and moving it removed a second
   * copy of the price, the refund rules and the seller's details — the exact
   * duplication that goes stale in one of its two homes and is then wrong
   * somewhere nobody is looking. The service keeps what only it can do (create
   * the payment, issue the licence); the site keeps what it is good at.
   *
   * 302, not 301: a permanent redirect is cached by browsers forever, and this
   * target is a deployment detail we may well want to move again.
   */
  app.get('/billing/pay', (_req: Request, res: Response) => {
    res.redirect(302, salesPageUrl);
  });

  /**
   * Where ЮKassa returns the payer. Served unconditionally: someone can land
   * here from an old payment after billing was switched off, and a 503 would
   * hide a licence they already own.
   */
  app.get('/billing/done', (_req: Request, res: Response) => {
    sendPage(res, renderDonePage());
  });

  /**
   * The buyer collects their licence key here after paying, using the payment id
   * ЮKassa returned to them.
   *
   * No `requireToken`: this is called by the checkout page on the web, which has
   * no app token. The payment id is an unguessable ЮKassa uuid known only to the
   * buyer, and the route is capped per IP per day.
   */
  app.get('/billing/license', limiters.billingDaily, (req: Request, res: Response) => {
    const paymentId = typeof req.query.payment_id === 'string' ? req.query.payment_id : '';
    if (!paymentId) {
      fail(res, 400, 'invalid_purchase_body', 'Query parameter "payment_id" is required.');
      return;
    }
    const license = licenses.byPaymentId(paymentId);
    if (!license) {
      // Also the honest answer while the notification is still in flight — the
      // page should poll rather than conclude the payment failed.
      fail(res, 404, 'license_not_ready', 'No licence for this payment (yet).');
      return;
    }
    res.json({ key: license.key, plan: license.plan, paid_until: license.paidUntil });
  });

  /**
   * Register a purchase made in the store, binding it to this install.
   *
   * The client calls this after buying AND on every launch: the store SDK hands
   * over the token each time, and re-registering is what carries a subscription
   * onto a new phone after a reinstall (the install id changes, the Google
   * account's purchase does not) and what lets a refund end access here — see
   * entitlements.ts on why the server cannot re-check on its own.
   */
  app.post('/billing/register', requireToken, limiters.billingDaily, async (req: Request, res: Response) => {
    if (!billingEnabled) {
      fail(res, 503, 'billing_unavailable', 'This deployment does not sell subscriptions.');
      return;
    }
    const installId = installIdOf(req);
    if (!installId) {
      // Without an id there is nothing to bind the purchase TO — the entitlement
      // would be verified and then immediately unfindable.
      fail(res, 400, 'install_id_required', 'Header "X-Install-Id" is required to register a purchase.');
      return;
    }
    const body = (req.body ?? {}) as { purchaseToken?: unknown; productId?: unknown };
    const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : '';
    const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
    if (!purchaseToken || !productId) {
      fail(res, 400, 'invalid_purchase_body', 'Fields "purchaseToken" and "productId" are required.');
      return;
    }

    const result = await entitlements.register(purchaseToken, productId, installId);
    if (result.reason === 'store_unreachable') {
      // 503, not 402: the purchase may well be perfectly good. The client must
      // retry later and must NOT tell the user their payment failed.
      fail(res, 503, 'store_unreachable', 'Could not reach the store to verify this purchase. Retry later.');
      return;
    }
    if (result.reason === 'invalid_purchase') {
      fail(res, 402, 'invalid_purchase', 'The store does not recognize this purchase.');
      return;
    }
    res.json({ active: result.active, expires_at: result.expiresAt, state: result.state });
  });

  /**
   * Link a licence to a Google account, and sign in on this device.
   *
   * This is what turns a forwardable string into a subscription. Sending the
   * key alongside the token CLAIMS the licence for the account; sending the
   * token alone signs a later device in — a new phone needs the account, not
   * the key, which is the whole point.
   */
  app.post('/billing/link', requireToken, limiters.billingDaily, async (req: Request, res: Response) => {
    if (!verifyGoogleIdToken) {
      fail(res, 503, 'identity_unavailable', 'This deployment does not support account sign-in.');
      return;
    }
    const installId = installIdOf(req);
    if (!installId) {
      fail(res, 400, 'install_id_required', 'Header "X-Install-Id" is required.');
      return;
    }
    const body = (req.body ?? {}) as { idToken?: unknown; licenseKey?: unknown };
    const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
    if (!idToken) {
      fail(res, 400, 'invalid_id_token', 'Field "idToken" is required.');
      return;
    }

    let identity: Awaited<ReturnType<GoogleVerifier>>;
    try {
      identity = await verifyGoogleIdToken(idToken);
    } catch (err) {
      // Google unreachable is not "your token is fake" — same split the store
      // adapters draw. Telling a paying user their account is invalid because
      // Google had a bad minute is the failure this guards against.
      console.error('billing: google verify failed:', err instanceof Error ? err.message : String(err));
      fail(res, 503, 'identity_unreachable', 'Could not reach Google to check the sign-in. Retry later.');
      return;
    }
    if (!identity) {
      fail(res, 401, 'invalid_id_token', 'That sign-in could not be verified.');
      return;
    }

    const claimKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
    if (claimKey) {
      const attached = licenses.attachAccount(claimKey, identity.sub);
      if (!attached) {
        // Either no such licence, or it already belongs to somebody else — and
        // those two must read the same from outside, or this endpoint becomes a
        // way to ask "is this key taken?".
        fail(res, 409, 'license_not_claimable', 'That key cannot be linked to this account.');
        return;
      }
    }

    const license = licenses.byAccount(identity.sub);
    if (!license) {
      res.json({ linked: true, active: false, expires_at: 0, state: 'none' });
      return;
    }

    // Reuse the entitlement path wholesale: the licence key is still what the
    // quota consults, the account is only how we found it.
    const result = await entitlements.register(license.key, license.plan, installId);
    res.json({ linked: true, active: result.active, expires_at: result.expiresAt, state: result.state });
  });

  /** Current entitlement for this install — what the client gates its paywall on. */
  app.get('/billing/status', requireToken, (req: Request, res: Response) => {
    const status = entitlements.statusOf(installIdOf(req));
    res.json({
      billing_enabled: billingEnabled,
      active: status.active,
      expires_at: status.expiresAt,
      state: status.state,
    });
  });

  // Shared tail for both inputs: identified items → resolved MealDraft, with the
  // same error mapping + aggregate metrics. Never leaks the input or a stack trace.
  async function respondWithDraft(
    res: Response,
    route: 'text' | 'photo' | 'audio',
    region: Region,
    // Audio also returns what it HEARD; every other route just returns items.
    identify: () => Promise<IdentifiedItem[] | { items: IdentifiedItem[]; heard?: string }>,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const answer = await identify();
      const identified = Array.isArray(answer) ? answer : answer.items;
      const heard = Array.isArray(answer) ? undefined : answer.heard;
      // Stage split: everything up to here is model work (identification and,
      // for photos, the label pass); everything after is DB resolution. The
      // per-route total alone can't say which side a slow day comes from.
      metrics.recordStage(`identify_${route}`, Date.now() - startedAt);
      const resolveStart = Date.now();
      const draft: MealDraft =
        identified.length === 0 ? emptyMealDraft(region) : await buildMealDraft(resolver, identified, region);
      metrics.recordStage('resolve', Date.now() - resolveStart);
      // Display-only: localize English DB row labels to Russian for RU (behind
      // the TRANSLATE_DB_LABELS flag; a no-op / English fallback otherwise).
      // Timed as its own stage — it is an LLM round-trip on cache-cold labels
      // and was the last untimed chunk of the user-visible wait.
      const translateStart = Date.now();
      const localized = await localizeDraft(draft, region);
      metrics.recordStage('translate', Date.now() - translateStart);
      metrics.recordParse(route, region, draft, Date.now() - startedAt);
      // `heard` rides alongside the draft, never inside it: it is a record of
      // what the person said, not nutrition data, and nothing downstream may
      // treat it as a food name. It matters most when `items` is EMPTY — that is
      // the case where the phone otherwise has nothing of theirs to show.
      res.json(heard ? { ...localized, heard } : localized);
    } catch (err) {
      if (err instanceof VisionUnavailableError) {
        // Counted, not just returned: a failure that reaches no counter is a
        // failure nobody will notice (see metrics.recordFailure).
        metrics.recordFailure(route, 'llm_unavailable');
        fail(res, 503, 'llm_unavailable', 'The parsing service is temporarily unavailable.');
        return;
      }
      metrics.recordFailure(route, 'internal_error');
      // Error name+message only — never the request content (privacy §2).
      // Without this line a recurring internal bug is invisible in journalctl.
      console.error('parse failed:', route, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      fail(res, 500, 'internal_error', 'Internal server error.');
    }
  }

  app.post('/food/parse', requireToken, limiters.textDaily, aiQuota.middleware, async (req: Request, res: Response) => {
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
    // Show BOTH, always. The DB search and the AI estimate run in PARALLEL (the
    // AI call adds no latency the ~5 s OFF search doesn't already cost), and we
    // return the DB rows FIRST, then the AI card for what the user typed. So a
    // branded query gets the generic DB row AND the brand-specific AI guess side
    // by side («по базе: Масло» + «через ИИ: Масло Простоквашино»), each with its
    // own per-100g and source tag — the user picks. The AI card needs consent
    // (`ai: true`); without it we still return whatever the DBs found.
    // The AI card is a real LLM call — it must spend the same per-install AI
    // budget as a parse, or the search box becomes a free side door around the
    // quota (free 30/day vs the 300/day per-IP text cap). Out of budget → the
    // DB candidates still return; only the card is withheld.
    const wantAi = body.ai === true && aiQuota.tryConsume(req, res);
    const [candidates, aiCard] = await Promise.all([
      resolver.search(query, region).catch(() => []),
      wantAi ? aiSearchCard(query, region).catch(() => null) : Promise.resolve(null),
    ]);
    // Localize the English DB candidate labels to Russian (RU, behind the flag).
    // The AI card's name is already Russian (from the estimate), so it's appended
    // after localization untouched.
    const localized = await localizeAlternatives(candidates, region);
    res.json({ candidates: aiCard ? [...localized, aiCard] : localized });
  });

  /**
   * Contribute ONE confirmed food to the shared base — the only write path into
   * it, and deliberately the narrowest possible one.
   *
   * The body is `{ name, region, per100: { kcal, prot, fat, carb, … } }` and
   * NOTHING else is read: not the meal it came from, not the weight eaten, not
   * when, not by whom. The install id the AI routes meter on is not consulted
   * here and is never written — a row in this base is a food, not a person's
   * food. Refusals are silent by design (`{ ok: true, votes: 0 }`): the device
   * fires this in the background after a save, and a food that failed the
   * plausibility gate is not something to interrupt a user about.
   *
   * Free of AI quota (no model runs) but under the per-IP daily text cap, which
   * is what bounds a flood.
   */
  app.post('/food/contribute', requireToken, limiters.textDaily, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { name?: unknown; region?: unknown; per100?: unknown };
    const region = regionOf(body);
    const name = sanitizeFoodName(body.name);
    const sample = sanitizeSample(body.per100);
    if (!name || !sample) {
      res.json({ ok: true, votes: 0 });
      return;
    }
    const votes = communityFoods.add(region, name, sample);
    res.json({ ok: true, votes });
  });

  // Free-text WORKOUT parse: `{ text }` → `{ workouts: ParsedWorkout[] }`. The
  // model only maps text → structured activities (type/minutes/pace); kcal is
  // computed client-side from the user's weight, so no energy numbers cross the
  // wire. Reuses the text daily cap (one cheap LLM call, same cost profile).
  app.post('/workout/parse', requireToken, limiters.textDaily, aiQuota.middleware, async (req: Request, res: Response) => {
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
    const startedAt = Date.now();
    try {
      const workouts = await parseWorkoutFromText(text);
      metrics.recordWorkoutParse('workout_text', workouts.length === 0, Date.now() - startedAt);
      res.json({ workouts });
    } catch (err) {
      failWorkoutParse(res, err, 'workout_text');
    }
  });

  /// Shared error tail for the workout parse family: the model only ever maps
  /// input → structured activities, so every route answers the same way.
  /// Counted in /metrics like the food tail — without it, an upstream failure
  /// on the workout schema kept the dashboard green while every input died
  /// (the exact blindness recordFailure exists to prevent).
  function failWorkoutParse(
    res: Response,
    err: unknown,
    route: 'workout_text' | 'workout_photo' | 'workout_audio',
  ): void {
    if (err instanceof VisionUnavailableError) {
      metrics.recordFailure(route, 'llm_unavailable');
      fail(res, 503, 'llm_unavailable', 'The parsing service is temporarily unavailable.');
      return;
    }
    // Same privacy-safe visibility as the food tail: name+message, no content.
    console.error('workout parse failed:', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    metrics.recordFailure(route, 'internal_error');
    fail(res, 500, 'internal_error', 'Internal server error.');
  }

  // Spoken WORKOUT: multipart `audio` → `{ workouts }`. Same honesty split as
  // the text parse (kcal client-side); the clip stays in memory, never persisted.
  app.post('/workout/parse-audio', requireToken, limiters.photoDaily, aiQuota.middleware, uploadAudio.single('audio'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "audio" is required.');
      return;
    }
    const format = audioFormat(file.mimetype, file.originalname);
    const startedAt = Date.now();
    try {
      const workouts = await parseWorkoutFromAudio(file.buffer.toString('base64'), format);
      metrics.recordWorkoutParse('workout_audio', workouts.length === 0, Date.now() - startedAt);
      res.json({ workouts });
    } catch (err) {
      failWorkoutParse(res, err, 'workout_audio');
    }
  });

  // Fitness-tracker SCREENSHOT: multipart `image` → `{ workouts, device_kcal?,
  // device_minutes? }`. The tracker's own printed totals are transcribed and,
  // when present, the client logs THEM («по трекеру») instead of re-deriving.
  app.post('/workout/parse-photo', requireToken, limiters.photoDaily, aiQuota.middleware, upload.single('image'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "image" is required.');
      return;
    }
    const mimeType = sniffImageMime(file.buffer) ?? (file.mimetype || 'image/jpeg');
    const startedAt = Date.now();
    try {
      const parsed = await parseWorkoutFromPhoto(file.buffer.toString('base64'), mimeType);
      metrics.recordWorkoutParse('workout_photo', parsed.workouts.length === 0, Date.now() - startedAt);
      res.json(parsed);
    } catch (err) {
      failWorkoutParse(res, err, 'workout_photo');
    }
  });

  // Photo input (BUILD SPEC §5.1): multipart `image` + `region` → MealDraft via
  // the vision model. The client downscales + strips EXIF before upload; the file
  // stays in memory and is never persisted (privacy §2).
  // Daily cap runs before multer buffers the (up to 8 MB) upload and before the
  // vision call, so an over-limit request is rejected cheaply.
  app.post('/food/parse-photo', requireToken, limiters.photoDaily, aiQuota.middleware, upload.single('image'), async (req: Request, res: Response) => {
    const region = regionOf((req.body ?? {}) as { region?: unknown });
    const file = req.file;
    if (!file || file.size === 0) {
      fail(res, 400, 'empty_input', 'Field "image" is required.');
      return;
    }
    // Trust the bytes over the client's label — see `sniffImageMime`.
    const mimeType = sniffImageMime(file.buffer) ?? (file.mimetype || 'image/jpeg');
    const base64 = file.buffer.toString('base64');
    // Whose panel readings this request may reuse — null for a client that sends
    // no id, which then reads every package fresh (see `labelCache`).
    const installId = installIdOf(req);
    await respondWithDraft(res, 'photo', region, async () => {
      const items = await identifyFromPhoto(base64, mimeType, region);
      // SECOND PASS, only for wrappers the first pass flagged: read the printed
      // panel. Exact numbers beat any database average — the tester's turkey ham
      // prints 100 kcal / 16 / 2 / 4 while the DB rows guessed 126 and 82. Runs
      // concurrently across items and is best-effort: a package whose panel
      // stays unreadable simply keeps its DB-resolved row.
      const packaged = items.filter((it) => it.packaged === true);
      if (packaged.length > 0) {
        const labelStart = Date.now();
        await Promise.all(
          packaged.map(async (it) => {
            // A product's printed panel doesn't change between purchases, so a
            // package THIS INSTALL has already read never pays the second vision
            // call (or the repeat ~200 KB image upload) again. Keyed by install
            // + identified name: the name alone is not a product identifier
            // (see `labelCache`), so a shared key would hand one user's reading
            // to another user's photo as «по упаковке».
            const key = installId ? `${installId}::${it.name_ru.trim().toLowerCase()}` : null;
            const cached = key ? labelCache.get(key) : undefined;
            if (cached) {
              it.label = cached;
              metrics.recordLabelCacheHit();
              return;
            }
            const label = await readPackageLabel(base64, mimeType, it.name_ru);
            if (label) {
              it.label = label;
              // Cache only complete readings — a failed/partial read should be
              // retried on the next photo, not remembered forever.
              if (key) rememberLabel(key, label);
            }
          }),
        );
        metrics.recordStage('label', Date.now() - labelStart);
      }
      return items;
    });
  });

  // Voice input: multipart `audio` (a short spoken meal description) + `region` →
  // MealDraft via the multimodal model. The clip stays in memory and is never
  // persisted (privacy §2). Reuses the photo daily cap (similar cost profile).
  app.post('/food/parse-audio', requireToken, limiters.photoDaily, aiQuota.middleware, uploadAudio.single('audio'), async (req: Request, res: Response) => {
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
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      // The audio routes must not blame a «photo» — pick the code by route.
      const tooLargeCode = req.path.includes('audio') ? 'audio_too_large' : 'image_too_large';
      fail(res, tooLarge ? 413 : 400, tooLarge ? tooLargeCode : 'bad_upload', err.message);
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
