import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';

import { decryptBlob, encryptBlob } from '../crypto/e2ee';
import { unwrapMasterKey, wrapMasterKey } from '../crypto/recovery';
import { type BackupDocument } from './backup';

/**
 * The on-disk backup FILE envelope — the layer that ties a Phase-1 encrypted
 * backup body to the Phase-2 recovery header, so a backup can be restored on a
 * FRESH device with nothing but the file + the recovery phrase (no server, no
 * separate key-file).
 *
 * Phase 1 wrote a raw `encryptBlob(masterPublicKey)` of the table JSON straight
 * to the file. Phase 2 wraps that same ciphertext in a tiny, versioned, TEXT
 * (base64-JSON) envelope that ALSO carries the master private key wrapped under
 * the recovery phrase. Restore order on a new device:
 *
 *   parse envelope → unwrap master key with phrase → decryptBlob body → JSON →
 *   importAllTables.
 *
 * ── Backward compatibility ───────────────────────────────────────────────────
 * `parseBackupFile` accepts BOTH shapes:
 *   - NEW: the JSON envelope below (magic `"hr-backup"`), and
 *   - OLD: a raw Phase-1 binary `encryptBlob` (no envelope) — detected because it
 *     is not valid envelope JSON. Old backups still restore on the SAME device
 *     (whose master key is already in secure-store); they simply carry no recovery
 *     header, so they can't be moved to a new device via phrase. This keeps every
 *     backup a user already saved readable.
 *
 * The envelope is intentionally JSON+base64 (not packed binary): a backup file is
 * tiny relative to the data, human-inspectable for debugging, and trivially
 * forward-extensible (add a field, bump `formatVersion`). The two heavy fields —
 * `body` and `recovery` — are themselves opaque base64 ciphertext.
 */

/// Magic + version for the Phase-2 envelope. Bump `formatVersion` on a
/// non-additive change; `parseBackupFile` rejects an unknown major version.
const BACKUP_FILE_MAGIC = 'hr-backup';
export const BACKUP_FILE_FORMAT_VERSION = 2;

/// The JSON envelope written to the backup file (then UTF-8 bytes → file).
interface BackupFileEnvelope {
  magic: typeof BACKUP_FILE_MAGIC;
  formatVersion: number;
  /// The Phase-1 ciphertext (`encryptBlob` of the table JSON), base64. Encrypted
  /// to the device master PUBLIC key — unchanged from Phase 1, just relocated.
  body: string;
  /// The master PRIVATE key wrapped under the user's recovery phrase
  /// (`wrapMasterKey`), base64. Present only when a phrase was set at backup time;
  /// absent for a body-only backup. This is what makes new-device restore possible.
  recovery?: string;
  /// Informational only.
  createdAt: string;
}

/**
 * Builds a Phase-2 backup file (UTF-8 bytes of the JSON envelope) from the table
 * document, the master keypair, and — optionally — a recovery phrase.
 *
 *  - The body is `encryptBlob(json, masterPublicKey)` exactly as in Phase 1.
 *  - If `phrase` is given, the master PRIVATE key is wrapped under it and embedded
 *    as `recovery`, enabling restore on a device that doesn't yet hold the key.
 *
 * The plaintext table JSON and the raw private key never appear in the output:
 * `body` is sealed to the public key, `recovery` is scrypt+secretbox over the
 * private key. (Asserted in tests.)
 */
export async function buildBackupFile(
  doc: BackupDocument,
  master: { publicKey: string; privateKey: string },
  phrase?: string,
): Promise<Uint8Array> {
  const json = JSON.stringify(doc);
  const body = encryptBlob(decodeUTF8(json), master.publicKey);

  const envelope: BackupFileEnvelope = {
    magic: BACKUP_FILE_MAGIC,
    formatVersion: BACKUP_FILE_FORMAT_VERSION,
    body: encodeBase64(body),
    createdAt: new Date().toISOString(),
  };
  if (phrase && phrase.length > 0) {
    envelope.recovery = await wrapMasterKey(master.privateKey, phrase);
  }

  return decodeUTF8(JSON.stringify(envelope));
}

/// The parsed, still-encrypted contents of a backup file: the body ciphertext and
/// (if present) the phrase-wrapped key. `legacy` flags an old Phase-1 raw blob.
export interface ParsedBackupFile {
  bodyCiphertext: Uint8Array;
  /// base64 wrapped-key blob, or null if this file carries no recovery header.
  recovery: string | null;
  /// true when the file is a pre-Phase-2 raw `encryptBlob` (no envelope).
  legacy: boolean;
}

/**
 * Parses a backup file's bytes into its encrypted parts, accepting BOTH the
 * Phase-2 envelope and a legacy Phase-1 raw blob (see the module doc). Does NOT
 * decrypt — the caller supplies the key/phrase (see `decryptBackupFile`).
 *
 * @throws if the bytes are a Phase-2 envelope with an unknown format version.
 */
export function parseBackupFile(fileBytes: Uint8Array): ParsedBackupFile {
  // Try the JSON envelope first. A legacy raw blob is binary ciphertext that
  // virtually never decodes to valid UTF-8 JSON with our magic, so a failed parse
  // (or a missing magic) cleanly falls through to the legacy path.
  const envelope = tryParseEnvelope(fileBytes);
  if (envelope) {
    if (envelope.formatVersion !== BACKUP_FILE_FORMAT_VERSION) {
      throw new Error(
        `backup file: unsupported format version ${String(envelope.formatVersion)} (this build reads ${BACKUP_FILE_FORMAT_VERSION})`,
      );
    }
    return {
      bodyCiphertext: decodeBase64(envelope.body),
      recovery: typeof envelope.recovery === 'string' ? envelope.recovery : null,
      legacy: false,
    };
  }

  // Legacy Phase-1 file: the whole thing is the encryptBlob body.
  return { bodyCiphertext: fileBytes, recovery: null, legacy: true };
}

/**
 * Decrypts a parsed backup file's body to the table document, given the master
 * PRIVATE key. Use this when the device already holds the master key (same-device
 * restore, or after `recoverMasterKeyFromFile`).
 *
 * @throws if the key is wrong / the body is corrupt, or the decrypted bytes are
 *   not a valid backup document.
 */
export function decryptBackupBody(parsed: ParsedBackupFile, privateKeyB64: string): BackupDocument {
  const plaintext = decryptBlob(parsed.bodyCiphertext, privateKeyB64);
  return JSON.parse(encodeUTF8(plaintext)) as BackupDocument;
}

/**
 * Recovers the master PRIVATE key from a backup file's recovery header using the
 * recovery phrase — the new-device path. Returns the private key (base64) so the
 * caller can both install it into secure-store AND decrypt the body.
 *
 * @throws if the file has no recovery header, or the phrase is wrong.
 */
export async function recoverMasterKeyFromFile(
  parsed: ParsedBackupFile,
  phrase: string,
): Promise<string> {
  if (!parsed.recovery) {
    throw new Error('backup file: no recovery header (cannot recover key from phrase)');
  }
  return unwrapMasterKey(parsed.recovery, phrase);
}

function tryParseEnvelope(fileBytes: Uint8Array): BackupFileEnvelope | null {
  let text: string;
  try {
    text = encodeUTF8(fileBytes);
  } catch {
    return null;
  }
  // Cheap pre-check: an envelope starts with '{'. Skips JSON.parse on binary.
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<BackupFileEnvelope>;
    if (obj && obj.magic === BACKUP_FILE_MAGIC && typeof obj.body === 'string') {
      return obj as BackupFileEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}
