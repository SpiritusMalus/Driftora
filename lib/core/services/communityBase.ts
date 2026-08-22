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

/// Did the LAST search come back empty because a nutrition source never
/// answered? Same reason this module exists: an empty list has two meanings and
/// only one of them permits «этой еды нет — впишите её». Saying that about a
/// food the server never actually got to look up is a claim we can't stand
/// behind, and it's what a single Open Food Facts timeout used to produce.
let lastSearchDegraded = false;

export function setSearchSourcesDown(v: boolean): void {
  lastSearchDegraded = v;
}

export function searchSourcesDown(): boolean {
  return lastSearchDegraded;
}
