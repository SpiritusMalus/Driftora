import { PLAN_DAYS } from './licenses.js';
import type { PlanPrice } from './yookassa.js';

/**
 * The two web pages of the purchase flow, served by the parse service itself.
 *
 * WHY THEY LIVE HERE and not on the marketing site: creating a payment needs the
 * ЮKassa secret, so an endpoint on this service is required no matter what. Once
 * that exists, hosting the two pages next to it costs nothing and removes an
 * entire class of problem — no CORS, no second deploy target, no third place
 * where the price is written down and drifts.
 *
 * WHY THE PAYMENT ID GOES INTO sessionStorage: ЮKassa's `return_url` is fixed at
 * payment-creation time and it does not append the payment id on the way back,
 * so the returning browser would otherwise arrive with nothing to look the
 * licence up by. The id is written before the redirect and read on return; the
 * `?payment_id=` query is honoured too, so a copied link still works.
 *
 * No frameworks, no external assets: this service ships three runtime
 * dependencies and a checkout page is not a reason for a fourth. It also lets
 * the pages run under a `default-src 'none'` CSP.
 */

/** Text → HTML. Everything interpolated below goes through this. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * JSON → a `<script>`-safe literal. Escaping `<` covers the one string that can
 * end the block early (`</script>`) even when it appears inside a JSON string.
 */
function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLE = `
:root { color-scheme: light dark; --bg:#faf7f4; --card:#fff; --text:#1b1a19; --subtle:#6b6663;
        --line:#e6e0da; --accent:#c8553d; --accent-text:#fff; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16150f; --card:#221f1b; --text:#f2ede7; --subtle:#a49b93; --line:#332e29; }
}
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 56px; background:var(--bg); color:var(--text);
       font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
main { max-width:520px; margin:0 auto; }
h1 { font-size:26px; line-height:1.2; margin:0 0 8px; }
h2 { font-size:15px; margin:0 0 8px; color:var(--text); }
p { margin:0 0 16px; color:var(--subtle); }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin:0 0 12px; }
.plan { display:flex; align-items:center; gap:12px; cursor:pointer; }
.plan input { width:20px; height:20px; accent-color:var(--accent); flex:none; }
.plan .name { font-weight:600; }
.plan .note { color:var(--subtle); font-size:14px; }
.price { margin-left:auto; font-weight:600; white-space:nowrap; }
label.field { display:block; font-size:14px; color:var(--subtle); margin:16px 0 6px; }
input[type=email], input[type=text] { width:100%; padding:12px; font-size:16px; color:var(--text);
       background:var(--card); border:1px solid var(--line); border-radius:12px; }
button { width:100%; margin-top:20px; padding:15px; font-size:17px; font-weight:600; cursor:pointer;
         color:var(--accent-text); background:var(--accent); border:0; border-radius:14px; }
button[disabled] { opacity:.55; cursor:progress; }
.err { color:var(--accent); font-weight:500; }
.key { font:600 22px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:1px;
       word-break:break-all; user-select:all; }
.small { font-size:13px; }
.legal { margin-top:28px; padding-top:16px; border-top:1px solid var(--line); color:var(--subtle); }
.legal p { margin:0 0 8px; }
a { color:var(--accent); }
ol { padding-left:20px; color:var(--subtle); }
`;

function page(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body><main>
${body}
</main><script>${script}</script></body></html>`;
}

export interface CheckoutPageOptions {
  prices: Record<string, PlanPrice>;
  /** Receipts on → the buyer's email is mandatory, so the field is too. */
  requireEmail: boolean;
  /** Where the offer lives, if it is published. Empty hides the link. */
  termsUrl: string;
  /** Privacy policy URL. Empty hides the link. */
  privacyUrl: string;
  /**
   * Who is selling, as it appears in the registry ("ИП Фамилия И. О., ИНН …").
   *
   * ЮKassa moderates the page a shop sells from and looks for the seller's own
   * details, a way to reach them, and the refund rules. All three are left as
   * configuration because only the shop owner knows them — but the page is
   * built to carry them, so switching the shop live is an env change, not a
   * code change.
   */
  seller: string;
  /** Support contact (email or a link). Empty hides the line. */
  contact: string;
}

/** `GET /billing/pay` — pick a plan, then hand off to ЮKassa. */
export function renderPayPage(opts: CheckoutPageOptions): string {
  const plans = Object.keys(PLAN_DAYS).filter((plan) => opts.prices[plan]);
  const options = plans
    .map((plan, i) => {
      const price = opts.prices[plan];
      const days = PLAN_DAYS[plan] ?? 30;
      const perMonth = plan === 'yearly' ? Math.round(Number(price?.amount ?? 0) / 12) : 0;
      const note = perMonth > 0 ? `${days} дней · ≈${perMonth} ₽ в месяц` : `${days} дней`;
      return `<label class="card plan">
  <input type="radio" name="plan" value="${esc(plan)}"${i === 0 ? ' checked' : ''}>
  <span><span class="name">${plan === 'yearly' ? 'На год' : 'На месяц'}</span><br>
  <span class="note">${esc(note)}</span></span>
  <span class="price">${esc(String(Math.round(Number(price?.amount ?? 0))))} ₽</span>
</label>`;
    })
    .join('\n');

  const email = `<label class="field" for="email">Почта для чека${opts.requireEmail ? '' : ' (необязательно)'}</label>
<input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">`;

  const renew = `<label class="field" for="key">Уже есть ключ? Продлим его (необязательно)</label>
<input id="key" type="text" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">`;

  const links = [
    opts.termsUrl ? `<a href="${esc(opts.termsUrl)}">Условия использования</a>` : '',
    opts.privacyUrl ? `<a href="${esc(opts.privacyUrl)}">Политика конфиденциальности</a>` : '',
  ].filter(Boolean);

  // Everything the payer — and ЮKassa's moderator, who reads this page before
  // switching the shop on — has to find without asking: what is sold, for how
  // much and for how long, when it starts, how to pay, how a refund works, who
  // the seller is, how to reach them, and where the documents are.
  const legal = `<div class="legal small">
<h2>Об услуге</h2>
<p>Driftora — приложение для дневника питания и самочувствия. Подписка снимает дневной
потолок на разбор еды с помощью ИИ (фото, голос, текст). Всё остальное в приложении
работает бесплатно и без подписки.</p>
<p>Услуга цифровая, доставки нет. Сразу после оплаты вы получаете лицензионный ключ на этом
сайте — его нужно ввести в приложении: «Ещё» → «Настройки» → «Подписка». Доступ начинается
в момент активации ключа и действует оплаченный срок.</p>
<p>Оплата банковской картой через ЮKassa. Автосписаний нет: подписка продлевается только
новой оплатой, поэтому отменять нечего и деньги сами не спишутся.</p>
<p>Возврат: если услуга не заработала или вы передумали, напишите нам${
    opts.contact ? ` (${esc(opts.contact)})` : ''
  } — вернём
деньги за неиспользованный срок на ту же карту в течение 10 рабочих дней.</p>
${opts.seller ? `<p>Продавец: ${esc(opts.seller)}</p>` : ''}
${opts.contact ? `<p>Связь: ${esc(opts.contact)}</p>` : ''}
${links.length ? `<p>${links.join(' · ')}</p>` : ''}
${opts.termsUrl ? `<p>Оплачивая, вы принимаете <a href="${esc(opts.termsUrl)}">условия использования</a>.</p>` : ''}
</div>`;

  const body = `<h1>Подписка Driftora</h1>
<p>Снимает дневной потолок на ИИ-разборы еды — фото, голос и текст. Дневник, вес, настроение и ручной ввод остаются бесплатными всегда.</p>
${options}
${email}
${renew}
<button id="go" type="button">Перейти к оплате</button>
<p id="err" class="err" hidden></p>
${legal}`;

  const script = `
var cfg = ${json({ requireEmail: opts.requireEmail })};
var go = document.getElementById('go'), err = document.getElementById('err');
function show(m) { err.textContent = m; err.hidden = false; go.disabled = false; }
go.addEventListener('click', function () {
  var planEl = document.querySelector('input[name=plan]:checked');
  var email = document.getElementById('email').value.trim();
  var key = document.getElementById('key').value.trim();
  if (cfg.requireEmail && !email) { show('Укажите почту — на неё придёт чек.'); return; }
  err.hidden = true; go.disabled = true;
  fetch('/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: planEl ? planEl.value : 'monthly', email: email, license_key: key })
  }).then(function (r) {
    return r.json().then(function (b) { return { ok: r.ok, body: b }; });
  }).then(function (res) {
    if (!res.ok || !res.body.confirmation_url) {
      show((res.body && res.body.error && res.body.error.message) || 'Не получилось начать оплату. Попробуйте ещё раз.');
      return;
    }
    // Read back by /billing/done — ЮKassa does not put the id in the return url.
    try { sessionStorage.setItem('driftora_payment_id', res.body.payment_id); } catch (e) {}
    location.href = res.body.confirmation_url;
  }).catch(function () { show('Сеть недоступна. Попробуйте ещё раз.'); });
});
`;
  return page('Подписка Driftora', body, script);
}

/**
 * `GET /billing/done` — where ЮKassa returns the payer.
 *
 * It POLLS rather than concluding, because arriving here means the BROWSER is
 * done, not that the payment is: the notification that mints the licence is a
 * separate delivery and normally lands within seconds. Announcing failure on the
 * first 404 would tell people who just paid that they had not.
 */
export function renderDonePage(): string {
  const body = `<h1>Спасибо за оплату</h1>
<p id="status">Проверяем платёж…</p>
<div class="card"><div class="key" id="key">—</div></div>
<ol class="small">
  <li>Откройте приложение → «Ещё» → «Настройки» → «Подписка».</li>
  <li>Вставьте ключ и нажмите «Активировать».</li>
</ol>
<p class="small">Сохраните ключ: он же вернёт подписку на новом телефоне.</p>`;

  const script = `
var params = new URLSearchParams(location.search);
var id = params.get('payment_id');
if (!id) { try { id = sessionStorage.getItem('driftora_payment_id'); } catch (e) {} }
var status = document.getElementById('status'), keyEl = document.getElementById('key');
var tries = 0;
function fail(m) { status.className = 'err'; status.textContent = m; }
function poll() {
  tries += 1;
  fetch('/billing/license?payment_id=' + encodeURIComponent(id)).then(function (r) {
    if (r.ok) return r.json();
    // 404 while the notification is still in flight is expected, not an answer.
    if (r.status === 404 && tries < 20) { setTimeout(poll, 3000); return null; }
    if (r.status === 404) { fail('Платёж ещё не подтверждён. Обновите страницу через минуту — деньги не потеряются.'); return null; }
    fail('Не удалось получить ключ. Напишите нам, платёж мы видим.');
    return null;
  }).then(function (b) {
    if (!b) return;
    status.textContent = 'Подписка активна до ' + new Date(b.paid_until).toLocaleDateString('ru-RU') + '.';
    keyEl.textContent = b.key;
  }).catch(function () {
    if (tries < 20) { setTimeout(poll, 3000); return; }
    fail('Сеть недоступна. Обновите страницу.');
  });
}
if (id) { poll(); } else { fail('Не знаем, какой это платёж. Откройте ссылку из письма от ЮKassa.'); }
`;
  return page('Оплата прошла — Driftora', body, script);
}
