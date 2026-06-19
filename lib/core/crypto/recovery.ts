import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64 } from 'tweetnacl-util';
import { scrypt } from 'scrypt-js';

import { keyPairMatches, publicKeyFromPrivateKey, type E2EEKeyPair } from './e2ee';

/**
 * Recovery layer for HealthRoutine — the user-held fallback that lets a backup be
 * restored on a NEW device WITHOUT any server. Two artefacts are produced:
 *
 *  1. A **recovery phrase** (`generateRecoveryPhrase`) — 18 random bytes rendered
 *     as 4 groups of 6 url-safe base64 chars. Ported verbatim from LawDocs
 *     `E2EEClient.generateRecoveryPhrase` (only the RNG source changes: expo-crypto
 *     via `installExpoCryptoRng`/`nacl.randomBytes` instead of WebCrypto).
 *  2. A **phrase-wrapped master key** (`wrapMasterKey` / `unwrapMasterKey`) — the
 *     X25519 private key encrypted under a key derived from the phrase, so it can
 *     be embedded in a backup file (see `lib/core/db/backup.ts` recovery header)
 *     and unwrapped on a fresh device by re-entering the phrase.
 *
 * Everything here is PURE JS (tweetnacl + scrypt-js), so it runs unchanged in
 * React Native (Hermes) AND in jest/node — NO native module, NO dev build.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ADR — symmetric wrap of the master key (LawDocs porting decision)
 * ──────────────────────────────────────────────────────────────────────────
 * LawDocs `createPasswordProtectedBackup` used WebCrypto **PBKDF2(200k, SHA-256)
 * → AES-GCM-256**. WebCrypto (`crypto.subtle`, `getRandomValues`) does not exist
 * in React Native, so per the task brief (§Crypto-in-RN, Option A) we keep the
 * stack pure-JS and swap to:
 *   - **KDF: scrypt** (`scrypt-js`, pure JS) with parameters N=2^15 (32768),
 *     r=8, p=1, dkLen=32. scrypt is memory-hard (stronger than PBKDF2 against
 *     GPU/ASIC brute force) and `scrypt-js` needs no native build. N=2^15 is the
 *     interactive-login reference from the scrypt paper / libsodium
 *     `OPSLIMIT/MEMLIMIT_INTERACTIVE` ballpark — a few hundred ms on a phone,
 *     acceptable for a one-shot recovery unlock.
 *   - **AEAD: `nacl.secretbox`** (XSalsa20-Poly1305) instead of AES-GCM — already
 *     in tweetnacl, same primitive the Phase-1 bulk layer uses.
 * The KDF params are written INTO the blob (see `KDF_PARAMS`/format below) so a
 * future parameter bump can still open old blobs.
 *
 * WRAPPED-KEY BLOB FORMAT (versioned, self-describing):
 *
 *   base64(
 *     version[1]        = 0x01
 *     logN[1]           = 15            // scrypt cost: N = 2^logN
 *     r[1]              = 8
 *     p[1]              = 1
 *     salt[16]                          // random per wrap
 *     secretbox_nonce[24]
 *     ciphertext[N+16]                  // secretbox(privateKeyBytes), Poly1305 tag
 *   )
 *
 * The private key is stored as its RAW 32 bytes (decoded from base64) before
 * encryption, so the blob never contains the base64 key text in any form.
 * A WRONG phrase makes `nacl.secretbox.open` return null → we throw.
 */

const FORMAT_VERSION = 0x01;

// scrypt cost parameters. logN=15 → N=32768 (memory-hard, interactive). r/p are
// the standard scrypt defaults. dkLen=32 = secretbox key length.
const SCRYPT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DERIVED_KEY_LENGTH = nacl.secretbox.keyLength; // 32

const SALT_LENGTH = 16;
const SECRETBOX_NONCE_LENGTH = nacl.secretbox.nonceLength; // 24
const HEADER_LENGTH = 1 + 1 + 1 + 1 + SALT_LENGTH; // version|logN|r|p|salt = 20

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
 * Generates a recovery phrase: 18 random bytes → url-safe base64 → 4 groups of 6
 * chars joined by " — ". 18 bytes = 144 bits of entropy (well above the 128-bit
 * floor). Shown to the user ONCE; we never store it. Ported from LawDocs
 * `E2EEClient.generateRecoveryPhrase`, with `nacl.randomBytes` as the entropy
 * source (wired to expo-crypto on-device via `installExpoCryptoRng`, and to
 * node's CSPRNG in jest — see `e2ee.ts`).
 */
export function generateRecoveryPhrase(): string {
  const bytes = nacl.randomBytes(18);
  // url-safe base64 without padding: 18 bytes → exactly 24 chars.
  const b64 = encodeBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return [b64.slice(0, 6), b64.slice(6, 12), b64.slice(12, 18), b64.slice(18, 24)].join(' — ');
}

/**
 * Normalizes a phrase for KDF input so display formatting never affects the key:
 * trims, collapses internal whitespace (incl. the " — " separators) and lowercases
 * nothing (the phrase is base64 → case-sensitive). We DON'T lowercase — base64 is
 * case-sensitive — but we DO strip the decorative separators so a user re-typing
 * "abc def ghi jkl" (spaces) unlocks a blob wrapped from "abc — def — ghi — jkl".
 */
function normalizePhrase(phrase: string): Uint8Array {
  const compact = phrase
    .replace(/—/g, ' ') // em-dash separators → space
    .replace(/\s+/g, '') // drop ALL whitespace, leaving just the base64 chars
    .trim();
  return decodeUTF8(compact);
}

/**
 * Derives the 32-byte secretbox key from a phrase + salt via scrypt. Async because
 * `scrypt-js`'s memory-hard work yields to the event loop; the caller awaits.
 */
async function deriveKey(phrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const pw = normalizePhrase(phrase);
  const N = 1 << SCRYPT_LOG_N;
  return scrypt(pw, salt, N, SCRYPT_R, SCRYPT_P, DERIVED_KEY_LENGTH);
}

/**
 * Wraps the X25519 master private key under a recovery phrase, producing the
 * versioned base64 blob documented above. The private key is encrypted as its raw
 * 32 bytes; the phrase is stretched with scrypt and the result feeds
 * `nacl.secretbox`. A fresh salt + nonce are drawn per call, so the same key+phrase
 * wraps to different bytes every time.
 *
 * @throws if `privateKeyB64` is not valid base64.
 */
export async function wrapMasterKey(privateKeyB64: string, phrase: string): Promise<string> {
  const privateKeyBytes = decodeBase64(privateKeyB64);
  if (privateKeyBytes.length !== nacl.box.secretKeyLength) {
    throw new Error('recovery: invalid private key length');
  }

  const salt = nacl.randomBytes(SALT_LENGTH);
  const key = await deriveKey(phrase, salt);

  const nonce = nacl.randomBytes(SECRETBOX_NONCE_LENGTH);
  const ciphertext = nacl.secretbox(privateKeyBytes, nonce, key);

  const header = new Uint8Array([FORMAT_VERSION, SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P]);
  return encodeBase64(concatBytes(header, salt, nonce, ciphertext));
}

/**
 * Unwraps a blob produced by [wrapMasterKey], returning the X25519 private key
 * (base64). Reads the KDF parameters from the blob header (forward-compatible),
 * re-derives the key from the supplied phrase, and opens the secretbox.
 *
 * @throws if the phrase is wrong (secretbox tag fails), the blob is corrupt, or
 *   its format version is unknown.
 */
export async function unwrapMasterKey(blobB64: string, phrase: string): Promise<string> {
  let packed: Uint8Array;
  try {
    packed = decodeBase64(blobB64);
  } catch {
    throw new Error('recovery: malformed wrapped-key blob');
  }
  if (packed.length < HEADER_LENGTH + SECRETBOX_NONCE_LENGTH + nacl.secretbox.overheadLength) {
    throw new Error('recovery: wrapped-key blob too short');
  }

  const version = packed[0];
  if (version !== FORMAT_VERSION) {
    throw new Error(`recovery: unsupported wrapped-key version ${String(version)}`);
  }
  const logN = packed[1];
  const r = packed[2];
  const p = packed[3];
  const salt = packed.slice(4, 4 + SALT_LENGTH);
  const nonce = packed.slice(HEADER_LENGTH, HEADER_LENGTH + SECRETBOX_NONCE_LENGTH);
  const ciphertext = packed.slice(HEADER_LENGTH + SECRETBOX_NONCE_LENGTH);

  // Re-derive with the params recorded in the blob (not the current constants),
  // so a blob wrapped under older params still opens after a parameter bump.
  const N = 1 << logN;
  const pw = normalizePhrase(phrase);
  const key = await scrypt(pw, salt, N, r, p, DERIVED_KEY_LENGTH);

  const privateKeyBytes = nacl.secretbox.open(ciphertext, nonce, key);
  if (!privateKeyBytes) {
    throw new Error('recovery: wrong recovery phrase (could not unwrap key)');
  }
  return encodeBase64(privateKeyBytes);
}

/**
 * The JSON shape of an exported key-file — the power-user fallback that carries
 * the master key directly (no phrase). Identical to LawDocs `downloadKeyFile`
 * output: `{ privateKey, publicKey, createdAt }`. This file IS the secret — anyone
 * holding it can decrypt the user's backups, so the UI warns accordingly.
 */
export interface KeyFile {
  privateKey: string; // base64
  publicKey: string; // base64
  createdAt: string; // ISO-8601
}

/**
 * Serializes the master keypair to the key-file JSON string. Ported from LawDocs
 * `E2EEClient.downloadKeyFile`, minus the browser Blob/anchor plumbing — the
 * native file write + share-sheet lives in the screen (`app/settings/recovery.tsx`).
 */
export function serializeKeyFile(pair: E2EEKeyPair): string {
  const file: KeyFile = {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parses + validates an imported key-file. Mirrors LawDocs `recoverViaKeyFile`'s
 * checks (minus the server account-binding, which HealthRoutine has no server for):
 *  - valid JSON with both keys present,
 *  - the private key actually derives the public key (`keyPairMatches`),
 * so a corrupt or mismatched file is rejected before it touches secure storage.
 *
 * Returns the validated keypair; the caller installs it (see
 * `keystore.installMasterKeyPair`).
 *
 * @throws Error with a human-readable, i18n-key-friendly `code` on any problem.
 */
export function parseKeyFile(jsonText: string): E2EEKeyPair {
  let data: Partial<KeyFile>;
  try {
    data = JSON.parse(jsonText) as Partial<KeyFile>;
  } catch {
    throw new RecoveryFileError('invalidFormat');
  }
  if (typeof data.privateKey !== 'string' || data.privateKey.length === 0) {
    throw new RecoveryFileError('noPrivateKey');
  }
  if (typeof data.publicKey !== 'string' || data.publicKey.length === 0) {
    // Tolerate a missing public key by deriving it, but only if the private key
    // is well-formed; otherwise the derive throws and we surface a clear error.
    try {
      data.publicKey = publicKeyFromPrivateKey(data.privateKey);
    } catch {
      throw new RecoveryFileError('noPublicKey');
    }
  }
  if (!keyPairMatches(data.privateKey, data.publicKey)) {
    throw new RecoveryFileError('mismatch');
  }
  return { privateKey: data.privateKey, publicKey: data.publicKey };
}

/**
 * A typed error for key-file import problems. `code` maps 1:1 to an i18n key under
 * `recovery.keyFileError.*`, so the screen can localize without string matching.
 */
export type RecoveryFileErrorCode = 'invalidFormat' | 'noPrivateKey' | 'noPublicKey' | 'mismatch';

export class RecoveryFileError extends Error {
  readonly code: RecoveryFileErrorCode;
  constructor(code: RecoveryFileErrorCode) {
    super(`recovery key-file error: ${code}`);
    this.name = 'RecoveryFileError';
    this.code = code;
  }
}

/** Exported for tests / format checks: the fixed wrapped-key header length. */
export const WRAPPED_KEY_HEADER_BYTES = HEADER_LENGTH;
export const RECOVERY_SCRYPT_LOG_N = SCRYPT_LOG_N;
