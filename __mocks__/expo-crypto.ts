/// Test stub for the native `expo-crypto` module (mapped in via the jest
/// `moduleNameMapper`). The app uses `getRandomBytes` for the SQLCipher key and,
/// via `installExpoCryptoRng`, as TweetNaCl's PRNG. Node has a working CSPRNG, so
/// we delegate to it — keeping randomness real (non-zero, distinct) without the
/// native module.
export function getRandomBytes(byteCount: number): Uint8Array {
  const out = new Uint8Array(byteCount);
  // globalThis.crypto.getRandomValues exists in node 18+/jsdom; fall back to a
  // simple fill only if somehow absent (never in this test env).
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < byteCount; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
