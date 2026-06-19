import { describe, expect, it } from '@jest/globals';
import { decodeBase64 } from 'tweetnacl-util';

import { generateKeyPair, keyPairMatches } from '@/lib/core/crypto/e2ee';
import {
  generateRecoveryPhrase,
  parseKeyFile,
  RecoveryFileError,
  serializeKeyFile,
  unwrapMasterKey,
  WRAPPED_KEY_HEADER_BYTES,
  wrapMasterKey,
} from '@/lib/core/crypto/recovery';

describe('generateRecoveryPhrase', () => {
  it('produces 4 groups of 6 url-safe base64 chars joined by " — "', () => {
    const phrase = generateRecoveryPhrase();
    const groups = phrase.split(' — ');
    expect(groups).toHaveLength(4);
    for (const g of groups) {
      expect(g).toHaveLength(6);
      // url-safe base64 alphabet only (no +, /, =).
      expect(g).toMatch(/^[A-Za-z0-9\-_]{6}$/);
    }
    // 24 base64 chars total = the 18 random bytes (144 bits) we asked for.
    expect(phrase.replace(/ — /g, '')).toHaveLength(24);
  });

  it('has high entropy: many calls are distinct (no constant/degenerate output)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateRecoveryPhrase());
    // 144 bits of entropy → 200 draws must all differ.
    expect(seen.size).toBe(200);
  });
});

describe('wrapMasterKey / unwrapMasterKey', () => {
  it('round-trips the private key with the correct phrase', async () => {
    const pair = generateKeyPair();
    const phrase = generateRecoveryPhrase();
    const blob = await wrapMasterKey(pair.privateKey, phrase);
    const recovered = await unwrapMasterKey(blob, phrase);
    expect(recovered).toBe(pair.privateKey);
    // The recovered key still matches its public key.
    expect(keyPairMatches(recovered, pair.publicKey)).toBe(true);
  });

  it('a WRONG phrase throws (cannot unwrap)', async () => {
    const pair = generateKeyPair();
    const blob = await wrapMasterKey(pair.privateKey, generateRecoveryPhrase());
    await expect(unwrapMasterKey(blob, generateRecoveryPhrase())).rejects.toThrow();
    await expect(unwrapMasterKey(blob, 'totally wrong phrase')).rejects.toThrow();
  });

  it('tolerates separator/whitespace differences in the phrase (normalization)', async () => {
    const pair = generateKeyPair();
    const phrase = generateRecoveryPhrase(); // "g1 — g2 — g3 — g4"
    const blob = await wrapMasterKey(pair.privateKey, phrase);
    // Re-typed with plain spaces instead of em-dashes, plus stray whitespace.
    const groups = phrase.split(' — ');
    const retyped = `  ${groups.join('   ')}  `;
    const recovered = await unwrapMasterKey(blob, retyped);
    expect(recovered).toBe(pair.privateKey);
  });

  it('the wrapped blob contains NO plaintext key (neither base64 nor raw bytes)', async () => {
    const pair = generateKeyPair();
    const phrase = generateRecoveryPhrase();
    const blob = await wrapMasterKey(pair.privateKey, phrase);

    // The base64 private key text must not appear in the blob string.
    expect(blob.includes(pair.privateKey)).toBe(false);

    // The raw 32 key bytes must not appear contiguously in the decoded blob.
    const blobBytes = decodeBase64(blob);
    const keyBytes = decodeBase64(pair.privateKey);
    expect(containsSubsequence(blobBytes, keyBytes)).toBe(false);
  });

  it('the same key+phrase wraps differently each time (fresh salt + nonce)', async () => {
    const pair = generateKeyPair();
    const phrase = generateRecoveryPhrase();
    const a = await wrapMasterKey(pair.privateKey, phrase);
    const b = await wrapMasterKey(pair.privateKey, phrase);
    expect(a).not.toBe(b);
    // ...yet both unwrap to the same key.
    expect(await unwrapMasterKey(a, phrase)).toBe(pair.privateKey);
    expect(await unwrapMasterKey(b, phrase)).toBe(pair.privateKey);
  });

  it('the blob is self-describing: header carries version + scrypt params', async () => {
    const pair = generateKeyPair();
    const blob = await wrapMasterKey(pair.privateKey, generateRecoveryPhrase());
    const bytes = decodeBase64(blob);
    expect(bytes[0]).toBe(0x01); // version
    expect(bytes[1]).toBe(15); // logN
    expect(bytes[2]).toBe(8); // r
    expect(bytes[3]).toBe(1); // p
    // header = version|logN|r|p|salt = 20 bytes, then nonce(24) + ciphertext.
    expect(WRAPPED_KEY_HEADER_BYTES).toBe(20);
    expect(bytes.length).toBeGreaterThan(20 + 24);
  });

  it('rejects a corrupt / truncated blob', async () => {
    await expect(unwrapMasterKey('not base64 @@@', 'x')).rejects.toThrow();
    await expect(unwrapMasterKey('AAAA', 'x')).rejects.toThrow();
  });
});

describe('key-file export / import', () => {
  it('serializeKeyFile → parseKeyFile round-trips the keypair', () => {
    const pair = generateKeyPair();
    const json = serializeKeyFile(pair);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.privateKey).toBe(pair.privateKey);
    expect(parsed.publicKey).toBe(pair.publicKey);
    expect(typeof parsed.createdAt).toBe('string');

    const back = parseKeyFile(json);
    expect(back.privateKey).toBe(pair.privateKey);
    expect(back.publicKey).toBe(pair.publicKey);
  });

  it('parseKeyFile rejects a mismatched keypair (keyPairMatches guard)', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const bad = JSON.stringify({ privateKey: a.privateKey, publicKey: b.publicKey });
    expect(() => parseKeyFile(bad)).toThrow(RecoveryFileError);
    try {
      parseKeyFile(bad);
    } catch (e) {
      expect((e as RecoveryFileError).code).toBe('mismatch');
    }
  });

  it('parseKeyFile rejects corrupt JSON and missing fields with typed codes', () => {
    expect(() => parseKeyFile('{not json')).toThrow(RecoveryFileError);
    expectCode(() => parseKeyFile('{not json'), 'invalidFormat');
    expectCode(() => parseKeyFile(JSON.stringify({ publicKey: 'x' })), 'noPrivateKey');
  });

  it('parseKeyFile heals a missing public key by deriving it from the private key', () => {
    const pair = generateKeyPair();
    const onlyPriv = JSON.stringify({ privateKey: pair.privateKey });
    const parsed = parseKeyFile(onlyPriv);
    expect(parsed.publicKey).toBe(pair.publicKey);
    expect(keyPairMatches(parsed.privateKey, parsed.publicKey)).toBe(true);
  });
});

/// True if `needle` appears as a contiguous run inside `haystack`.
function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected to throw');
  } catch (e) {
    expect(e).toBeInstanceOf(RecoveryFileError);
    expect((e as RecoveryFileError).code).toBe(code);
  }
}
