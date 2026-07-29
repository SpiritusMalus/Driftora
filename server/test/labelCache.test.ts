import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';
// Deterministic single lane: the hedge would fire a duplicate vision call and
// make the "how many label reads happened" assertions ambiguous.
process.env.VISION_HEDGE_MS = '0';

const { createApp } = await import('../src/app.js');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** One panel reading, in BOTH shapes the label pass reconciles (crossCheckLabel). */
function panelReply(kcal: number, prot: number, fat: number, carb: number): Response {
  return json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            panel_text: `белки — ${prot} г; жиры — ${fat} г; углеводы — ${carb} г; ${kcal} ккал`,
            label: { prot_100g: prot, fat_100g: fat, carb_100g: carb, kcal_100g: kcal },
          }),
        },
      },
    ],
  });
}

/** The identified item — a GENERIC packaged name, exactly what the photo prompt
 *  returns when the brand isn't legible («name the PRODUCT, brand included when
 *  it is legible», prompt.ts). Two different products share this name. A fresh
 *  Response per call: a body can only be read once. */
const identifyReply = (): Response =>
  json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            items: [
              {
                name_ru: 'творог 5%',
                name_en: 'cottage cheese 5%',
                est_grams: 200,
                confidence: 0.8,
                prepared: false,
                packaged: true,
              },
            ],
          }),
        },
      },
    ],
  });

/** The panel the NEXT label read will return, and how many reads happened. */
let panel = (): Response => panelReply(121, 16, 5, 3);
let labelReads = 0;

async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => {
  panel = () => panelReply(121, 16, 5, 3);
  labelReads = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] };
      const system = body.messages?.find((m) => m.role === 'system')?.content;
      // The dedicated second pass is the only one told to read a printed panel.
      if (typeof system === 'string' && system.includes('NUTRITION PANEL')) {
        labelReads += 1;
        return panel();
      }
      return identifyReply();
    }
    if (url.includes('api.nal.usda.gov')) return json({ foods: [] });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function photoForm(): FormData {
  const form = new FormData();
  form.append('region', 'RU');
  form.append('image', new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' }), 'meal.jpg');
  return form;
}

function postPhoto(base: string, installId: string): Promise<Response> {
  return realFetch(`${base}/food/parse-photo`, {
    method: 'POST',
    headers: { 'X-Install-Id': installId },
    body: photoForm(),
  });
}

async function kcalOf(res: Response): Promise<{ kcal: number; source: string }> {
  const draft = (await res.json()) as { items: { per100: { kcal: number; source: string } }[] };
  const per100 = draft.items[0]!.per100;
  return { kcal: per100.kcal, source: per100.source };
}

/**
 * A cached panel must never cross installs. The panel is shown as «по упаковке»
 * — a claim of FACT, not an estimate — so serving one install's reading for
 * another install's photo of a same-named product prints someone else's numbers
 * as this user's measurement, and skips reading the package that was actually
 * photographed.
 */
test('a packaged panel cached for one install is NOT reused for another', async () => {
  const { base, stop } = await startApp();
  try {
    const first = await kcalOf(await postPhoto(base, 'install-aaaa1111'));
    assert.equal(first.source, 'label');
    assert.equal(first.kcal, 121);
    assert.equal(labelReads, 1);

    // A DIFFERENT install photographs a DIFFERENT product that the model names
    // identically — its own package prints 159 kcal.
    panel = () => panelReply(159, 18, 9, 3);
    const second = await kcalOf(await postPhoto(base, 'install-bbbb2222'));
    assert.equal(second.kcal, 159, 'the second install must get ITS OWN panel, not the first install’s');
    assert.equal(labelReads, 2, 'the second install’s package must actually be read');
  } finally {
    await stop();
  }
});

/** The cache still earns its keep: the same install re-logging the same product
 *  pays no second vision call (the case it was built for). */
test('the same install re-logging the same product reuses its cached panel', async () => {
  const { base, stop } = await startApp();
  try {
    await postPhoto(base, 'install-cccc3333');
    assert.equal(labelReads, 1);

    panel = () => panelReply(159, 18, 9, 3); // would differ if it were read again
    const again = await kcalOf(await postPhoto(base, 'install-cccc3333'));
    assert.equal(again.kcal, 121, 'the install’s own cached panel should answer');
    assert.equal(labelReads, 1, 'no second vision call for a product this install already read');
  } finally {
    await stop();
  }
});

/** No install id (an older client) — the cache is skipped entirely rather than
 *  falling back to a key many devices share behind one CGNAT address. */
test('without an install id the panel is read fresh every time', async () => {
  const { base, stop } = await startApp();
  try {
    await realFetch(`${base}/food/parse-photo`, { method: 'POST', body: photoForm() });
    panel = () => panelReply(159, 18, 9, 3);
    const res = await realFetch(`${base}/food/parse-photo`, { method: 'POST', body: photoForm() });
    assert.equal((await kcalOf(res)).kcal, 159);
    assert.equal(labelReads, 2);
  } finally {
    await stop();
  }
});
