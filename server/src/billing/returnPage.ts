/**
 * The page ЮKassa returns a payer to when the purchase was started by the APP.
 *
 * The web purchase flow does not come here: the site page on family-pie.ru asks
 * for its own return page and shows the key in its own design. This one exists
 * for the in-app flow, where the WebView watches for this URL to close itself —
 * so it is served, and stays deliberately plain, because in practice it flashes
 * by for a fraction of a second. Someone who lands here with a browser (an old
 * link, a copied URL) still gets their key rather than a dead end.
 *
 * It POLLS rather than concluding, because arriving here means the BROWSER is
 * done, not that the payment is: the notification that mints the licence is a
 * separate delivery and normally lands within seconds. Announcing failure on the
 * first 404 would tell people who just paid that they had not.
 *
 * No frameworks, no external assets: this service ships three runtime
 * dependencies and a return page is not a reason for a fourth. It also lets the
 * page run under a `default-src 'none'` CSP.
 */

const STYLE = `
:root { color-scheme: light dark; --bg:#faf7f4; --card:#fff; --text:#1b1a19; --subtle:#6b6663;
        --line:#e6e0da; --accent:#c8553d; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16150f; --card:#221f1b; --text:#f2ede7; --subtle:#a49b93; --line:#332e29; }
}
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 56px; background:var(--bg); color:var(--text);
       font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
main { max-width:520px; margin:0 auto; }
h1 { font-size:26px; line-height:1.2; margin:0 0 8px; }
p { margin:0 0 16px; color:var(--subtle); }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin:0 0 12px; }
.err { color:var(--accent); font-weight:500; }
.key { font:600 22px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:1px;
       word-break:break-all; user-select:all; }
.small { font-size:13px; }
ol { padding-left:20px; color:var(--subtle); }
`;

/** `GET /billing/done` — collect the licence the payment bought. */
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

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Оплата прошла — Driftora</title>
<style>${STYLE}</style>
</head><body><main>
${body}
</main><script>${script}</script></body></html>`;
}
