/// Canonical PUBLIC legal URLs — hosted centrally at family-pie (studio host).
/// HR does not run its own legal site; the wording canon lives in
/// `legal/*.md` + `lib/legal/documents.ts` and the family-pie page mirrors it.
/// `combined` is the single page; `/terms` + `/privacy` deep-link its tabs.
export const LEGAL_URL = {
  combined: 'https://family-pie.ru/driftora/legal',
  terms: 'https://family-pie.ru/driftora/terms',
  privacy: 'https://family-pie.ru/driftora/privacy',
} as const;

/// Neutral studio landing page (not a purchase/steering link — iOS-safe).
export const SITE_URL = 'https://family-pie.ru';
