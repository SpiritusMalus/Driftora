// One-shot transform for web-legal/legal.html (TASK-2026-06-20-legal-pages, steps 1 & 2).
// Decodes the JSON-encoded template (line 179), applies a11y/SEO + deep-link edits on
// plain HTML, re-encodes; edits the outer wrapper (lines 1-177) as plain text.
// Every replacement asserts an exact occurrence count — aborts on any mismatch.
const fs = require('fs');
const FILE = 'web-legal/legal.html';
let raw = fs.readFileSync(FILE, 'utf8');
let lines = raw.split('\n');

function rep(s, from, to, n) {
  const count = s.split(from).length - 1;
  if (count !== n) throw new Error(`EXPECT ${n} of [${from.slice(0, 60)}...] got ${count}`);
  return s.split(from).join(to);
}

// ---------- TEMPLATE (line 179, JSON-encoded) ----------
const tpl = lines[178];
let h = JSON.parse(tpl);

// 3.1 — lang on the template <html>
h = rep(h, '<!DOCTYPE html>\n<html><head>', '<!DOCTYPE html>\n<html lang="ru"><head>', 1);

// 3.2 + 3.5 — <meta description> + @media print, injected into <helmet>.
// NOTE: no <title> in the helmet on purpose — this bundle's helmet re-applies its
// title on every render (after componentDidUpdate), which would clobber the per-tab
// title. JS owns document.title instead (componentDidMount/Update); the no-JS/crawler
// title lives in the outer wrapper <title> below.
h = rep(h,
  '<helmet>\n<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<helmet>\n'
  + '<meta name="description" content="Политика конфиденциальности и Пользовательское соглашение HealthRoutine: данные хранятся на устройстве, E2E-резервная копия, ИИ-разбор еды выключен по умолчанию.">\n'
  + '<style>@media print{ .legal-topbar{display:none !important;} .toc-rail{display:none !important;} .legal-grid{padding:0 !important;} main{max-width:none !important; padding-top:0 !important;} }</style>\n'
  + '<link rel="preconnect" href="https://fonts.googleapis.com">',
  1);

// 3.5 helper — class the sticky top bar so print CSS can hide it
h = rep(h,
  '<!-- TOP BAR -->\n  <div style="position:sticky; top:0; z-index:50;',
  '<!-- TOP BAR -->\n  <div class="legal-topbar" style="position:sticky; top:0; z-index:50;',
  1);

// 3.3 — tablist role on the tab group
h = rep(h,
  '<div class="topbar-tabs" style="display:flex; gap:4px; background:#FFFFFF; border:1px solid #EEDDD4; border-radius:13px; padding:4px;">',
  '<div class="topbar-tabs" role="tablist" aria-label="Выбор документа" style="display:flex; gap:4px; background:#FFFFFF; border:1px solid #EEDDD4; border-radius:13px; padding:4px;">',
  1);

// 3.3 — tab roles + aria-selected + aria-controls on the two buttons
h = rep(h,
  '<button onclick="{{ showPrivacy }}" style="{{ privTabStyle }}">',
  '<button onclick="{{ showPrivacy }}" role="tab" id="tab-privacy" aria-selected="{{ privSelected }}" aria-controls="legal-panel" style="{{ privTabStyle }}">',
  1);
h = rep(h,
  '<button onclick="{{ showTerms }}" style="{{ termsTabStyle }}">',
  '<button onclick="{{ showTerms }}" role="tab" id="tab-terms" aria-selected="{{ termsSelected }}" aria-controls="legal-panel" style="{{ termsTabStyle }}">',
  1);

// 3.3 — tabpanel role on the content <main>
h = rep(h,
  '<main style="flex:1; min-width:0; max-width:760px; padding-top:52px;">',
  '<main id="legal-panel" role="tabpanel" aria-labelledby="{{ activeTabId }}" tabindex="0" style="flex:1; min-width:0; max-width:760px; padding-top:52px;">',
  1);

// §1-B — deep-link: init state.tab from URL
h = rep(h,
  "state = { tab: 'privacy' };",
  "state = { tab: (typeof location !== 'undefined' && (location.pathname.indexOf('terms') !== -1 || new URLSearchParams(location.search).get('tab') === 'terms')) ? 'terms' : 'privacy' };",
  1);

// §1-B + 3.2 — per-tab document.title on initial (deep-link) load. The helmet
// carries no <title> (see above), so document.title set here and in the click
// handlers below is not clobbered by re-render. componentDidUpdate is left as-is
// (this bundle's framework doesn't reliably invoke it for the title set).
const PRIV_TITLE = "'HealthRoutine — Политика конфиденциальности'";
const TERMS_TITLE = "'HealthRoutine — Пользовательское соглашение'";
h = rep(h,
  'componentDidMount() { this.setupSpy(); }',
  `componentDidMount() { document.title = this.state.tab === 'terms' ? ${TERMS_TITLE} : ${PRIV_TITLE}; this.setupSpy(); }`,
  1);

// Bonus (pre-existing bug, confirmed on the pristine bundle): this framework
// invokes componentDidUpdate with prevState === undefined, so `prevState.tab`
// throws a TypeError on every tab switch. Guard it so the legal page doesn't
// spew console errors. (Behaviour otherwise unchanged.)
h = rep(h,
  'if (prevState.tab !== this.state.tab) {',
  'if (prevState && prevState.tab !== this.state.tab) {',
  1);

// 3.3 — add aria/title bindings to renderVals
h = rep(h,
  'return {\n      isPrivacy, isTerms,\n      showPrivacy:',
  "return {\n      isPrivacy, isTerms,\n      privSelected: isPrivacy ? 'true' : 'false',\n      termsSelected: isTerms ? 'true' : 'false',\n      activeTabId: isPrivacy ? 'tab-privacy' : 'tab-terms',\n      showPrivacy:",
  1);

// §1-B — deep-link: update URL (+ title) on tab switch
// scrollTo(0) restores the author's intended scroll-to-top on switch (the
// componentDidUpdate that was meant to do it never runs — see guard above).
h = rep(h,
  "showPrivacy: () => this.setState({ tab: 'privacy' }),",
  `showPrivacy: () => { try { history.replaceState(null, '', '/privacy'); } catch (e) {} document.title = ${PRIV_TITLE}; window.scrollTo({ top: 0, behavior: 'auto' }); this.setState({ tab: 'privacy' }); },`,
  1);
h = rep(h,
  "showTerms: () => this.setState({ tab: 'terms' }),",
  `showTerms: () => { try { history.replaceState(null, '', '/terms'); } catch (e) {} document.title = ${TERMS_TITLE}; window.scrollTo({ top: 0, behavior: 'auto' }); this.setState({ tab: 'terms' }); },`,
  1);

// 3.6 — active TOC link colour: small text, lift #D8513A (3.74:1) before the global grey pass
h = rep(h,
  "l.style.color = on ? '#D8513A' : '#8A6E63';",
  "l.style.color = on ? '#C2451F' : '#75584C';",
  1);

// 3.6 — global grey lifts to >=4.5:1 on the cream/white grounds
const grey1 = (h.split('#8A6E63').length - 1);
h = h.split('#8A6E63').join('#75584C');   // 4.29 -> 5.92 (cream)
const grey2 = (h.split('#B89684').length - 1);
h = h.split('#B89684').join('#7D6053');   // 2.49 -> 5.25 (cream)
console.log(`grey #8A6E63 replaced: ${grey1}, #B89684 replaced: ${grey2}`);

// re-encode and write back into line 179
lines[178] = JSON.stringify(h).replace(/<\//g, '<\\u002F');

// ---------- OUTER WRAPPER (plain-text lines 1-177) ----------
raw = lines.join('\n');

// 3.1 — lang on the outer <html>
raw = rep(raw, '<!DOCTYPE html>\n<html>\n<head>', '<!DOCTYPE html>\n<html lang="ru">\n<head>', 1);

// 3.2 — real outer <title> (crawler-visible before JS)
raw = rep(raw,
  '<title>Bundled Page</title>',
  '<title>HealthRoutine — Конфиденциальность и Пользовательское соглашение</title>',
  1);

// 3.4 — meaningful <noscript> with a raw-text fallback link
raw = rep(raw,
  '      This page requires JavaScript to display.',
  '      Для интерактивной версии нужен JavaScript. Тексты доступны напрямую: <a href="/legal/PRIVACY_POLICY.md">Политика конфиденциальности</a> · <a href="/legal/TERMS_OF_USE.md">Пользовательское соглашение</a>.',
  1);

fs.writeFileSync(FILE, raw);
console.log('OK — all replacements applied with exact counts.');
