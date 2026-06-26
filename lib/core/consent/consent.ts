import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { AppSettings } from '../db/schema';
import { updateSettings } from '../db/settings';

/// РКН-safe consent (TASK-2026-06-19). Two SEPARATE consents, never bundled
/// (152-ФЗ bans bundled consent):
///   1. GENERAL consent to use the app — the first-launch offer gate over the
///      Terms of Use + Privacy Policy. Tracked by [LEGAL_VERSION].
///   2. SPECIFIC, opt-in consent to the cross-border food→AI transfer (meal
///      text or photo → Google Gemini, US). Tracked by [AI_CONSENT_VERSION];
///      ships off, gates the online parser.
///
/// Each version is a free-form string compared by inequality: a stored value
/// that differs from the current constant means "re-consent needed" (so a
/// policy update bumps the constant to re-prompt). Pure predicates below decide
/// when to show a gate/modal; the writers record the consent fact (epoch ms +
/// the version accepted) for the audit trail.

/// Bump when the Terms/Privacy text materially changes — re-prompts the gate.
/// `-r2`: Privacy Policy + Terms reconciled to the shipped E2E backup and the
/// opt-in (not-yet-deployed) E2E sync (docs/privacy-e2e-reconcile, 2026-06-19).
/// `2026-06-22`: synced to the finalized family-pie canon — operator identified
/// (ИП Тихоненко Е.Ю.), effective date 22.06.2026, РКН registration filled in.
export const LEGAL_VERSION = '2026-06-22';

/// Bump when the AI cross-border disclosure materially changes — re-prompts the
/// just-in-time consent the next time the user triggers an AI parse.
export const AI_CONSENT_VERSION = '2026-06-19';

/// Bump when the sync disclosure materially changes (e.g. a hosting/jurisdiction
/// change after the §G owner decision) — re-prompts the sync opt-in.
export const SYNC_CONSENT_VERSION = '2026-06-19';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// The general offer gate must show while no acceptance is stored, or the
/// stored acceptance predates the current [LEGAL_VERSION].
export function needsLegalGate(settings: Pick<AppSettings, 'legalAcceptedVersion'>): boolean {
  return settings.legalAcceptedVersion !== LEGAL_VERSION;
}

/// The just-in-time AI consent must show when consent is off, or it was granted
/// against an older [AI_CONSENT_VERSION] (re-consent on a disclosure change).
/// Note this is about *prompting*; the parser gate uses `aiFoodParseConsent`
/// alone (see foodParserProvider) so a stale-version consent never silently
/// keeps sending until the user re-confirms.
export function needsAiConsent(
  settings: Pick<AppSettings, 'aiFoodParseConsent' | 'aiFoodParseConsentVersion'>,
): boolean {
  return !settings.aiFoodParseConsent || settings.aiFoodParseConsentVersion !== AI_CONSENT_VERSION;
}

/// Records acceptance of the general Terms + Privacy offer at [LEGAL_VERSION].
export async function acceptLegal(db: AnyDb, now: number = Date.now()): Promise<void> {
  await updateSettings(db, { legalAcceptedVersion: LEGAL_VERSION, legalAcceptedAt: now });
}

/// Grants the cross-border food→AI consent, stamping the fact (epoch ms +
/// [AI_CONSENT_VERSION]) for the 152-ФЗ audit trail.
export async function grantAiConsent(db: AnyDb, now: number = Date.now()): Promise<void> {
  await updateSettings(db, {
    aiFoodParseConsent: true,
    aiFoodParseConsentAt: now,
    aiFoodParseConsentVersion: AI_CONSENT_VERSION,
  });
}

/// Revokes the food→AI consent immediately (Settings toggle off / decline) —
/// the next parse falls back to the offline stub. The captured timestamp is
/// cleared so the audit trail reflects an inactive consent.
export async function revokeAiConsent(db: AnyDb): Promise<void> {
  await updateSettings(db, { aiFoodParseConsent: false, aiFoodParseConsentAt: null });
}

/// Whether the server-backed sync opt-in must be (re-)shown: consent is off, or
/// it was granted against an older [SYNC_CONSENT_VERSION]. Like the AI gate, this
/// drives *prompting*; the sync client itself checks `syncEnabled` alone (see
/// `syncClient.assertSyncEnabled`) so a stale-version consent never silently keeps
/// transferring until the user re-confirms.
export function needsSyncConsent(
  settings: Pick<AppSettings, 'syncEnabled' | 'syncConsentVersion'>,
): boolean {
  return !settings.syncEnabled || settings.syncConsentVersion !== SYNC_CONSENT_VERSION;
}

/// Grants the server-backed sync consent, stamping the fact (epoch ms +
/// [SYNC_CONSENT_VERSION]) for the audit trail. Sync stays OFF until this is called.
export async function grantSyncConsent(db: AnyDb, now: number = Date.now()): Promise<void> {
  await updateSettings(db, {
    syncEnabled: true,
    syncConsentAt: now,
    syncConsentVersion: SYNC_CONSENT_VERSION,
  });
}

/// Revokes sync consent immediately (Settings toggle off) — the sync client then
/// refuses to push/pull. The captured timestamp is cleared so the audit trail
/// reflects an inactive consent. Local data and existing backups are untouched.
export async function revokeSyncConsent(db: AnyDb): Promise<void> {
  await updateSettings(db, { syncEnabled: false, syncConsentAt: null });
}
