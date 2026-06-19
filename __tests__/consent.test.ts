import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  AI_CONSENT_VERSION,
  LEGAL_VERSION,
  acceptLegal,
  grantAiConsent,
  needsAiConsent,
  needsLegalGate,
  revokeAiConsent,
} from '@/lib/core/consent/consent';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';

async function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  await applySchema((s) => sqlite.exec(s));
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('consent defaults (ships off)', () => {
  it('a fresh install has no legal acceptance and AI consent OFF', async () => {
    const { sqlite, db } = await makeDb();
    const s = await ensureSettings(db);
    expect(s.legalAcceptedVersion).toBe('');
    expect(s.legalAcceptedAt).toBeNull();
    expect(s.aiFoodParseConsent).toBe(false);
    expect(s.aiFoodParseConsentAt).toBeNull();
    expect(s.aiFoodParseConsentVersion).toBe('');
    sqlite.close();
  });
});

describe('needsLegalGate', () => {
  it('blocks until accepted, then unblocks at the current version, re-blocks on a bump', () => {
    expect(needsLegalGate({ legalAcceptedVersion: '' })).toBe(true);
    expect(needsLegalGate({ legalAcceptedVersion: LEGAL_VERSION })).toBe(false);
    expect(needsLegalGate({ legalAcceptedVersion: 'older-version' })).toBe(true);
  });
});

describe('needsAiConsent', () => {
  it('prompts when off, or when consented at an older version', () => {
    expect(needsAiConsent({ aiFoodParseConsent: false, aiFoodParseConsentVersion: '' })).toBe(true);
    expect(needsAiConsent({ aiFoodParseConsent: true, aiFoodParseConsentVersion: AI_CONSENT_VERSION })).toBe(false);
    expect(needsAiConsent({ aiFoodParseConsent: true, aiFoodParseConsentVersion: 'older' })).toBe(true);
  });
});

describe('consent writers (audit trail)', () => {
  it('acceptLegal records the version + timestamp', async () => {
    const { sqlite, db } = await makeDb();
    await acceptLegal(db, 1_700_000_000_000);
    const s = await ensureSettings(db);
    expect(s.legalAcceptedVersion).toBe(LEGAL_VERSION);
    expect(s.legalAcceptedAt).toBe(1_700_000_000_000);
    expect(needsLegalGate(s)).toBe(false);
    sqlite.close();
  });

  it('grantAiConsent turns it on with version + timestamp; revoke reverts to the stub', async () => {
    const { sqlite, db } = await makeDb();

    await grantAiConsent(db, 1_700_000_000_000);
    let s = await ensureSettings(db);
    expect(s.aiFoodParseConsent).toBe(true);
    expect(s.aiFoodParseConsentVersion).toBe(AI_CONSENT_VERSION);
    expect(s.aiFoodParseConsentAt).toBe(1_700_000_000_000);
    expect(needsAiConsent(s)).toBe(false);

    // Toggling off reverts immediately (offline stub) and clears the timestamp.
    await revokeAiConsent(db);
    s = await ensureSettings(db);
    expect(s.aiFoodParseConsent).toBe(false);
    expect(s.aiFoodParseConsentAt).toBeNull();
    expect(needsAiConsent(s)).toBe(true);

    sqlite.close();
  });
});
