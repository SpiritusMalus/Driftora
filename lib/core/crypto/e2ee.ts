import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

/**
 * End-to-end crypto for Driftora — ported from the LawDocs `e2ee-client.ts`
 * TweetNaCl model (the project's protocol/file format are reused; only the bulk
 * layer differs — see below). `tweetnacl` + `tweetnacl-util` are pure JS, so this
 * module runs unchanged in React Native (Hermes) AND in jest/node.
 *
 * The master key is an **X25519 keypair** (`nacl.box`). The public key wraps a
 * per-backup symmetric key; the private key (held only in expo-secure-store, see
 * `lib/core/db/keystore.ts`) unwraps it. This is the portable key — distinct from
 * the device-local SQLCipher key, which never leaves the device.
 *
 * ENCRYPTED-BLOB FORMAT (preserves the LawDocs `key_blob` layout; the bulk layer
 * is `nacl.secretbox` instead of AES-GCM, so the whole thing is pure-JS / no
 * WebCrypto — see `LawDocs/backend/app/services/e2ee_file.py` for the original):
 *
 *   key_blob[104] = box_nonce[24] | ephemeralPub[32] | box(symKey_32)[48]
 *   secretbox_nonce[24]
 *   secretbox_ciphertext[N + 16]   // Poly1305 tag included
 *
 * (LawDocs' key_blob was 104 bytes because its inner box wrapped a 32-byte AES
 * key the same way — 24+32+48. We wrap a 32-byte secretbox key identically, so
 * the key_blob is byte-for-byte the same construction; only the trailing bulk
 * layer changed from AES-GCM[12-byte IV] to secretbox[24-byte nonce].)
 *
 * Anonymous-box wrapping: a fresh ephemeral sender keypair per blob, so the
 * recipient public key is the only long-lived input — no sender identity leaks.
 */

const NONCE_LENGTH = nacl.box.nonceLength; // 24
const PUBLIC_KEY_LENGTH = nacl.box.publicKeyLength; // 32
const SECRETBOX_KEY_LENGTH = nacl.secretbox.keyLength; // 32
const SECRETBOX_NONCE_LENGTH = nacl.secretbox.nonceLength; // 24
// box(32-byte key) = 32 + nacl.box.overheadLength(16) = 48.
const WRAPPED_KEY_LENGTH = SECRETBOX_KEY_LENGTH + nacl.box.overheadLength; // 48
// key_blob = box_nonce[24] | ephemeralPub[32] | wrappedKey[48] = 104? No — 24+32+48 = 104.
const KEY_BLOB_LENGTH = NONCE_LENGTH + PUBLIC_KEY_LENGTH + WRAPPED_KEY_LENGTH; // 104

export interface E2EEKeyPair {
  publicKey: string; // base64
  privateKey: string; // base64
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Wires TweetNaCl's PRNG to `expo-crypto.getRandomBytes` (React Native has no
 * `crypto.getRandomValues`, which is TweetNaCl's default source). Idempotent and
 * defensive: on node/jest — where `expo-crypto` can't load but `crypto.getRandomValues`
 * exists — it is a no-op and TweetNaCl keeps its working default. Call once at app
 * startup (see `keystore.getOrCreateMasterKeyPair`, which calls it before any key op).
 *
 * Returns `true` if the expo-crypto PRNG was installed, `false` if it left the
 * default in place (either because expo-crypto was unavailable or it was already
 * wired). Never throws.
 */
let rngWired = false;
export function installExpoCryptoRng(): boolean {
  if (rngWired) return true;
  try {
    // Lazy require so jest/node never has to resolve the native module: if it
    // isn't there we keep TweetNaCl's default (crypto.getRandomValues), which
    // works under node and is only absent on-device — where this require succeeds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as { getRandomBytes(n: number): Uint8Array };
    if (typeof Crypto?.getRandomBytes !== 'function') return false;
    nacl.setPRNG((out: Uint8Array, n: number) => {
      const bytes = Crypto.getRandomBytes(n);
      out.set(bytes.subarray(0, n));
    });
    rngWired = true;
    return true;
  } catch {
    // expo-crypto not present (node/jest) — TweetNaCl's default PRNG stays.
    return false;
  }
}

/** Generates an X25519 keypair. The private key MUST never leave the device. */
export function generateKeyPair(): E2EEKeyPair {
  const pair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(pair.publicKey),
    privateKey: encodeBase64(pair.secretKey),
  };
}

/**
 * Verifies a private key matches a public key. X25519 derives the public key
 * deterministically from the private key, so we re-derive and constant-time
 * compare. Returns false on any malformed input (bad base64, wrong length).
 */
export function keyPairMatches(privateKeyB64: string, publicKeyB64: string): boolean {
  try {
    const secret = decodeBase64(privateKeyB64);
    const expectedPublic = decodeBase64(publicKeyB64);
    const derived = nacl.box.keyPair.fromSecretKey(secret).publicKey;
    if (derived.length !== expectedPublic.length) return false;
    let diff = 0;
    for (let i = 0; i < derived.length; i++) {
      diff |= derived[i] ^ expectedPublic[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}

/** Derives the public key (base64) from a private key. X25519 — deterministic. */
export function publicKeyFromPrivateKey(privateKeyB64: string): string {
  const secret = decodeBase64(privateKeyB64);
  return encodeBase64(nacl.box.keyPair.fromSecretKey(secret).publicKey);
}

/**
 * Encrypts arbitrary bytes to a recipient public key, producing the LawDocs blob
 * layout with a `nacl.secretbox` bulk layer:
 *
 *   key_blob[104] = box_nonce[24] | ephemeralPub[32] | box(symKey_32)[48]
 *   secretbox_nonce[24] | secretbox_ciphertext
 *
 * A fresh symmetric key and a fresh ephemeral sender keypair are generated per
 * call, so the same plaintext encrypts differently every time and no sender
 * identity is embedded.
 */
export function encryptBlob(bytes: Uint8Array, recipientPublicKeyB64: string): Uint8Array {
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64);
  if (recipientPublicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error('e2ee: invalid recipient public key length');
  }

  // Per-blob symmetric key for the bulk secretbox layer.
  const symKey = nacl.randomBytes(SECRETBOX_KEY_LENGTH);

  // Wrap the symmetric key with an anonymous box to the recipient (ephemeral sender).
  const boxNonce = nacl.randomBytes(NONCE_LENGTH);
  const ephemeral = nacl.box.keyPair();
  const wrappedKey = nacl.box(symKey, boxNonce, recipientPublicKey, ephemeral.secretKey);
  const keyBlob = concatBytes(boxNonce, ephemeral.publicKey, wrappedKey);

  // Bulk-encrypt the payload with the symmetric key (XSalsa20-Poly1305).
  const secretboxNonce = nacl.randomBytes(SECRETBOX_NONCE_LENGTH);
  const ciphertext = nacl.secretbox(bytes, secretboxNonce, symKey);

  return concatBytes(keyBlob, secretboxNonce, ciphertext);
}

/**
 * Decrypts a blob produced by [encryptBlob] using the recipient private key.
 * Throws if the key is wrong or the data is corrupt (either box.open returns null).
 */
export function decryptBlob(blob: Uint8Array, privateKeyB64: string): Uint8Array {
  if (blob.length < KEY_BLOB_LENGTH + SECRETBOX_NONCE_LENGTH) {
    throw new Error('e2ee: blob too short');
  }
  const privateKey = decodeBase64(privateKeyB64);

  const keyBlob = blob.slice(0, KEY_BLOB_LENGTH);
  const secretboxNonce = blob.slice(KEY_BLOB_LENGTH, KEY_BLOB_LENGTH + SECRETBOX_NONCE_LENGTH);
  const ciphertext = blob.slice(KEY_BLOB_LENGTH + SECRETBOX_NONCE_LENGTH);

  const boxNonce = keyBlob.slice(0, NONCE_LENGTH);
  const ephemeralPub = keyBlob.slice(NONCE_LENGTH, NONCE_LENGTH + PUBLIC_KEY_LENGTH);
  const wrappedKey = keyBlob.slice(NONCE_LENGTH + PUBLIC_KEY_LENGTH);

  const symKey = nacl.box.open(wrappedKey, boxNonce, ephemeralPub, privateKey);
  if (!symKey) {
    throw new Error('e2ee: could not unwrap key (wrong key or corrupt data)');
  }

  const plaintext = nacl.secretbox.open(ciphertext, secretboxNonce, symKey);
  if (!plaintext) {
    throw new Error('e2ee: could not decrypt payload (wrong key or corrupt data)');
  }
  return plaintext;
}

/**
 * Solves a server-issued login challenge — the client half of the passwordless
 * "login by key" flow used by the sync server (`sync-server/`, lifted from
 * LawDocs). The server encrypts a random nonce TO the account's public key with an
 * anonymous box and sends the base64 blob; only the holder of the matching private
 * key can recover the nonce, which is returned (base64) as proof of possession.
 *
 * The challenge blob is exactly the LawDocs `key_blob` layout WITHOUT a bulk layer
 * (the payload IS the nonce, wrapped directly):
 *
 *   blob = box_nonce[24] | ephemeralPub[32] | nacl_box(nonce)[nonce.len + 16]
 *
 * which is the same construction `encryptBlob` uses for its wrapped symmetric key.
 * This is the TS twin of the server's `e2ee_box.encrypt_for_public_key` /
 * `tests/helpers.solve_challenge`.
 *
 * @returns the decrypted nonce as base64 — what the server's `/v1/auth/login`
 *   expects in its `nonce` field.
 * @throws if the blob is malformed/too short or the private key can't open it
 *   (wrong key / tampered challenge). NEVER sends the private key anywhere.
 */
export function solveChallenge(encryptedChallengeB64: string, privateKeyB64: string): string {
  const blob = decodeBase64(encryptedChallengeB64);
  if (blob.length < NONCE_LENGTH + PUBLIC_KEY_LENGTH + nacl.box.overheadLength) {
    throw new Error('e2ee: challenge blob too short');
  }
  const privateKey = decodeBase64(privateKeyB64);

  const boxNonce = blob.slice(0, NONCE_LENGTH);
  const ephemeralPub = blob.slice(NONCE_LENGTH, NONCE_LENGTH + PUBLIC_KEY_LENGTH);
  const wrapped = blob.slice(NONCE_LENGTH + PUBLIC_KEY_LENGTH);

  const nonce = nacl.box.open(wrapped, boxNonce, ephemeralPub, privateKey);
  if (!nonce) {
    throw new Error('e2ee: could not solve challenge (wrong key or corrupt data)');
  }
  return encodeBase64(nonce);
}

/** The fixed length of the key-wrapping header, exported for tests/format checks. */
export const KEY_BLOB_BYTES = KEY_BLOB_LENGTH;
export const SECRETBOX_NONCE_BYTES = SECRETBOX_NONCE_LENGTH;
