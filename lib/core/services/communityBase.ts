/// Whether the backend's SHARED food base is actually on — learned from the
/// `X-Community-Base` header that /food/search responses carry. `null` until a
/// search has answered (older servers never send it). Drives ONLY copy honesty:
/// with the base off, the empty state must not promise «появится для остальных»
/// — the contribute route drops the row, and a promise the app can't keep is
/// worse than none. Module-level on purpose: it's a fact about the backend, not
/// about any one screen, and it changes at most once per server deploy.
let available: boolean | null = null;

export function setCommunityBaseAvailable(v: boolean): void {
  available = v;
}

export function communityBaseAvailable(): boolean | null {
  return available;
}
