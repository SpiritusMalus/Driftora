import { describe, expect, it } from '@jest/globals';
import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

import {
  decryptBlob,
  encryptBlob,
  generateKeyPair,
  KEY_BLOB_BYTES,
  keyPairMatches,
  publicKeyFromPrivateKey,
  SECRETBOX_NONCE_BYTES,
} from '@/lib/core/crypto/e2ee';

describe('e2ee keypair', () => {
  it('generates a usable X25519 keypair whose public key derives from the private key', () => {
    const pair = generateKeyPair();
    expect(pair.privateKey).not.toEqual(pair.publicKey);
    expect(keyPairMatches(pair.privateKey, pair.publicKey)).toBe(true);
    expect(publicKeyFromPrivateKey(pair.privateKey)).toBe(pair.publicKey);
  });

  it('keyPairMatches rejects a mismatched or malformed key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(keyPairMatches(a.privateKey, b.publicKey)).toBe(false);
    expect(keyPairMatches('not-base64!!', a.publicKey)).toBe(false);
    expect(keyPairMatches(a.privateKey, '')).toBe(false);
  });
});

describe('encryptBlob / decryptBlob', () => {
  it('round-trips arbitrary bytes', () => {
    const pair = generateKeyPair();
    const payloads = [
      new Uint8Array(0),
      new Uint8Array([0]),
      decodeUTF8('hello мир 🌍'),
      nacl.randomBytes(1),
      nacl.randomBytes(5000),
    ];
    for (const bytes of payloads) {
      const blob = encryptBlob(bytes, pair.publicKey);
      const out = decryptBlob(blob, pair.privateKey);
      expect(Array.from(out)).toEqual(Array.from(bytes));
    }
  });

  it('a wrong private key throws (cannot decrypt)', () => {
    const pair = generateKeyPair();
    const attacker = generateKeyPair();
    const blob = encryptBlob(decodeUTF8('secret diary'), pair.publicKey);
    expect(() => decryptBlob(blob, attacker.privateKey)).toThrow();
  });

  it('the same plaintext encrypts to different ciphertext each time (fresh nonce + ephemeral key)', () => {
    const pair = generateKeyPair();
    const bytes = decodeUTF8('same input');
    const a = encryptBlob(bytes, pair.publicKey);
    const b = encryptBlob(bytes, pair.publicKey);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    // ...yet both decrypt back to the same plaintext.
    expect(encodeUTF8(decryptBlob(a, pair.privateKey))).toBe('same input');
    expect(encodeUTF8(decryptBlob(b, pair.privateKey))).toBe('same input');
  });

  it('the on-wire layout matches the documented LawDocs offsets (key_blob[104] | secretbox_nonce[24] | ciphertext)', () => {
    expect(KEY_BLOB_BYTES).toBe(104);
    expect(SECRETBOX_NONCE_BYTES).toBe(24);
    const pair = generateKeyPair();
    const plaintext = nacl.randomBytes(64);
    const blob = encryptBlob(plaintext, pair.publicKey);
    // key_blob(104) + secretbox_nonce(24) + ciphertext(plaintext + Poly1305 tag 16).
    expect(blob.length).toBe(104 + 24 + plaintext.length + 16);

    // The key_blob's inner box must open to a 32-byte symmetric key with the
    // recipient private key — proving the 24|32|48 sub-layout is honored.
    const boxNonce = blob.slice(0, 24);
    const ephemeralPub = blob.slice(24, 56);
    const wrappedKey = blob.slice(56, 104);
    const symKey = nacl.box.open(
      wrappedKey,
      boxNonce,
      ephemeralPub,
      decodeBase64Local(pair.privateKey),
    );
    expect(symKey).not.toBeNull();
    expect(symKey!.length).toBe(32);
  });

  it('the blob contains no plaintext (ciphertext does not embed the cleartext bytes)', () => {
    const pair = generateKeyPair();
    const secret = 'TOP-SECRET-DIARY-MARKER-9f3a';
    const blob = encryptBlob(decodeUTF8(secret), pair.publicKey);
    // The raw secret string must not appear anywhere in the encrypted bytes.
    const blobAsLatin1 = Array.from(blob)
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(blobAsLatin1.includes(secret)).toBe(false);
  });

  it('rejects an invalid recipient public key length', () => {
    expect(() => encryptBlob(new Uint8Array([1, 2, 3]), 'AAAA')).toThrow();
  });

  it('rejects a truncated blob', () => {
    const pair = generateKeyPair();
    expect(() => decryptBlob(new Uint8Array(10), pair.privateKey)).toThrow();
  });
});

// Local base64 decode to avoid importing tweetnacl-util twice with a different name.
function decodeBase64Local(b64: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { decodeBase64 } = require('tweetnacl-util');
  return decodeBase64(b64);
}
