import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings } from '@/lib/core/db/settings';
import {
  activateLicense,
  billingOrigin,
  fetchBillingStatus,
  fetchPlans,
  finishCheckout,
  forgetLicense,
  reportPaywallShown,
  RETURN_PATH,
  startCheckout,
  storedLicenseKey,
  type BillingStatus,
  type Plan,
} from '@/lib/core/services/billing';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// «Подписка» — buy, restore and inspect the AI subscription.
///
/// THE WHOLE POINT OF THIS SCREEN'S SHAPE: buying must not feel like leaving the
/// app. The plan is picked natively, the payment is created natively, only
/// ЮKassa's hosted card form appears — in a modal WebView, because card data
/// must never touch this app and 3-D Secure is a redirect by design. When the
/// form redirects to the return page, the modal closes itself, the licence key
/// is collected and activated in the background, and the user simply sees their
/// subscription turn on. Nothing is copied by hand.
///
/// The manual key field stays anyway, for the person who paid on the website (or
/// is moving their subscription to a second phone). It is the fallback, not the
/// path.
///
/// Everything here is gated on the cross-border AI consent, like every other
/// network call in the app (lib/core/services/billing.ts) — a subscription that
/// raises the AI ceiling is meaningless to someone who has not turned AI on.

/**
 * Is this the payment flow arriving back at OUR return page?
 *
 * The WebView closes and the licence is collected the moment this says yes, so it
 * has to mean the real page and not merely a URL that mentions it: the previous
 * `url.includes('/billing/done')` also matched `https://elsewhere.example/?next=/billing/done`.
 * Origin and path are therefore compared exactly (query and fragment ignored —
 * ЮKassa appends its own). Falls back to `false` on anything unparseable, and on a
 * build with no server configured, where there is no origin to be returned to.
 */
function isReturnUrl(url: string): boolean {
  const origin = billingOrigin();
  if (!origin) return false;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}` === origin && parsed.pathname === RETURN_PATH;
  } catch {
    return false;
  }
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'creating' } // asking ЮKassa for a payment
  | { kind: 'paying'; url: string; paymentId: string } // hosted form on screen
  | { kind: 'settling'; paymentId: string } // paid, waiting for the licence
  | { kind: 'activating' } // manual key being checked
  | { kind: 'done' };

export default function SubscriptionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();
  // `?from=limit` marks arrivals from the quota wall/low-budget hint; everything
  // else counts as «нашёл сам». Feeds the monetization funnel in /metrics.
  const { from } = useLocalSearchParams<{ from?: string }>();

  const [aiConsent, setAiConsent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [receiptRequired, setReceiptRequired] = useState(false);
  const [sellsAnything, setSellsAnything] = useState(true);
  const [selected, setSelected] = useState<string>('');
  const [email, setEmail] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string>('');

  const reload = useCallback(async () => {
    if (db == null) return;
    const settings = await ensureSettings(db);
    const consent = settings.aiFoodParseConsent === true;
    setAiConsent(consent);
    setSavedKey(await storedLicenseKey(db));
    if (!consent) {
      setPhase({ kind: 'ready' });
      return;
    }
    const [current, list] = await Promise.all([fetchBillingStatus(db), fetchPlans(db)]);
    setStatus(current);
    if (list) {
      setPlans(list.plans);
      setReceiptRequired(list.receiptRequired);
      setSellsAnything(list.enabled);
      setSelected((prev) => prev || list.plans[0]?.id || '');
    }
    setPhase({ kind: 'ready' });
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // One beacon per screen visit, not per re-render or reload: the funnel
  // counts «показов пейволла», and a re-render is not a second show.
  const paywallReported = useRef(false);
  useEffect(() => {
    if (db == null || paywallReported.current) return;
    paywallReported.current = true;
    void reportPaywallShown(db, from === 'limit' ? 'limit' : 'menu');
  }, [db, from]);

  /** Create the payment, then hand the hosted form to the WebView. */
  const onBuy = useCallback(async () => {
    if (db == null) return;
    setError('');
    if (receiptRequired && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('subscription.errors.email'));
      return;
    }
    setPhase({ kind: 'creating' });
    const started = await startCheckout(db, {
      plan: selected,
      email: email.trim(),
      // Renewing keeps one subscription rather than opening a second one.
      licenseKey: savedKey ?? undefined,
    });
    if (!started.ok) {
      setError(t(`subscription.errors.${started.reason}`));
      setPhase({ kind: 'ready' });
      return;
    }
    setPhase({ kind: 'paying', url: started.confirmationUrl, paymentId: started.paymentId });
  }, [db, email, receiptRequired, savedKey, selected, t]);

  /** Collect + activate what the payment bought. Also the «я оплатил» retry. */
  const settle = useCallback(
    async (paymentId: string) => {
      if (db == null) return;
      setPhase({ kind: 'settling', paymentId });
      const result = await finishCheckout(db, paymentId);
      if (!result.ok) {
        // Never «оплата не прошла»: the money may well have left. The honest
        // answer is that we have not seen the licence YET, and how to retry.
        setError(t('subscription.errors.settle'));
        setPhase({ kind: 'ready' });
        return;
      }
      setStatus(result.status);
      setSavedKey(await storedLicenseKey(db));
      setPhase({ kind: 'done' });
    },
    [db, t],
  );

  const onActivateKey = useCallback(async () => {
    if (db == null) return;
    setError('');
    setPhase({ kind: 'activating' });
    const result = await activateLicense(db, keyInput);
    if (!result.ok) {
      setError(t(`subscription.errors.${result.reason}`));
      setPhase({ kind: 'ready' });
      return;
    }
    setStatus(result.status);
    setSavedKey(await storedLicenseKey(db));
    setKeyInput('');
    setPhase({ kind: 'done' });
  }, [db, keyInput, t]);

  const onForget = useCallback(async () => {
    if (db == null) return;
    await forgetLicense(db);
    setSavedKey(null);
    await reload();
  }, [db, reload]);

  if (phase.kind === 'loading') {
    return (
      <Screen>
        <ActivityIndicator style={styles.spinner} color={theme.primary} />
      </Screen>
    );
  }

  // AI off: selling here would be selling a ceiling on something switched off.
  if (aiConsent === false) {
    return (
      <Screen>
        <Hero theme={theme} lines={[t('subscription.hero'), t('subscription.heroLead')]} />
        <Card>
          <Text style={[styles.body, { color: theme.text }, theme.font.body]}>{t('subscription.aiOffBody')}</Text>
        </Card>
      </Screen>
    );
  }

  const active = status?.active === true;
  const quota = status?.quota ?? null;
  const busy = phase.kind === 'creating' || phase.kind === 'settling' || phase.kind === 'activating';
  const price = plans.find((p) => p.id === selected)?.amount ?? '';

  return (
    <Screen>
      <Hero theme={theme} lines={[t('subscription.hero'), t('subscription.heroLead')]} />

      {/* Where the user stands right now — the first question this screen answers. */}
      <Card>
        <Text style={[styles.state, { color: active ? theme.primary : theme.text }, theme.font.heading]}>
          {active ? t('subscription.stateActive') : t('subscription.stateFree')}
        </Text>
        {active && status && status.expiresAt > 0 ? (
          <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>
            {t('subscription.until', { date: new Date(status.expiresAt).toLocaleDateString() })}
          </Text>
        ) : null}
        {/* The count, in the one place a person comes to ask for it. Until this
            line existed the only way to learn the free tier's size was to spend
            it: the food screen mentions the budget at three left, and nothing
            else in the app names a number (owner feedback 2026-08-20). */}
        {quota ? (
          <>
            <Text style={[styles.quota, { color: theme.text }, theme.font.bodySemiBold]}>
              {quota.scope === 'day'
                ? t('subscription.dayLeft', { n: quota.remaining, cap: quota.cap })
                : quota.remaining > 0
                  ? t('subscription.freeLeft', { n: quota.remaining, cap: quota.cap })
                  : t('subscription.freeSpent')}
            </Text>
            {/* Said out loud because «30 разборов» is read as «30 в день» by
                default — that is what every other app means by a limit. */}
            {quota.scope === 'total' ? (
              <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>
                {t('subscription.freeShape')}
              </Text>
            ) : null}
            {!active ? (
              <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>
                {t('subscription.paidOffer', { n: quota.perDayPaid })}
              </Text>
            ) : null}
          </>
        ) : !active ? (
          /* Older server (or the meter switched off): say the shape without
             inventing a number this build cannot know. */
          <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>{t('subscription.freeNote')}</Text>
        ) : null}
      </Card>

      {phase.kind === 'done' ? (
        <Card>
          <Text style={[styles.body, { color: theme.primary }, theme.font.bodyMedium]}>
            {t('subscription.thanks')}
          </Text>
        </Card>
      ) : null}

      {!sellsAnything ? (
        <Card>
          <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>
            {t('subscription.errors.not_selling')}
          </Text>
        </Card>
      ) : (
        <>
          <SectionHeader>{active ? t('subscription.extendSection') : t('subscription.buySection')}</SectionHeader>

          {plans.map((plan) => (
            <Pressable
              key={plan.id}
              onPress={() => setSelected(plan.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === plan.id }}
              accessibilityLabel={t(`subscription.plans.${plan.id}`, { defaultValue: plan.id })}
            >
              <Card style={[styles.plan, selected === plan.id && { borderColor: theme.primary, borderWidth: 2 }]}>
                <View style={styles.planText}>
                  <Text style={[{ color: theme.text }, theme.font.bodySemiBold]}>
                    {t(`subscription.plans.${plan.id}`, { defaultValue: plan.description })}
                  </Text>
                  <Text style={[styles.small, { color: theme.subtle }, theme.font.body]}>
                    {t('subscription.planDays', { n: plan.days })}
                  </Text>
                </View>
                <Text style={[{ color: theme.text }, theme.font.bodySemiBold]}>
                  {t('subscription.rub', { n: Math.round(Number(plan.amount)) })}
                </Text>
              </Card>
            </Pressable>
          ))}

          {receiptRequired ? (
            <>
              <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>
                {t('subscription.emailLabel')}
              </Text>
              <TextField
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </>
          ) : null}

          <PrimaryButton
            label={
              phase.kind === 'creating'
                ? t('subscription.opening')
                : phase.kind === 'settling'
                  ? t('subscription.settling')
                  : t('subscription.pay', { n: Math.round(Number(price)) })
            }
            onPress={() => void onBuy()}
            disabled={busy || !selected || db == null}
            style={styles.cta}
          />
          <Text style={[styles.small, { color: theme.subtle }, theme.font.body]}>{t('subscription.payNote')}</Text>
        </>
      )}

      {error ? (
        <Text style={[styles.error, { color: theme.accent }, theme.font.bodyMedium]}>{error}</Text>
      ) : null}

      {/* Fallback for a purchase made on the website, or a second phone. */}
      <SectionHeader>{t('subscription.keySection')}</SectionHeader>
      {savedKey ? (
        <Card>
          <Text style={[styles.small, { color: theme.subtle }, theme.font.body]}>{t('subscription.savedKey')}</Text>
          <Text selectable style={[styles.key, { color: theme.text }, theme.font.bodySemiBold]}>
            {savedKey}
          </Text>
          <Pressable onPress={() => void onForget()} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.small, { color: theme.accent }, theme.font.bodyMedium]}>
              {t('subscription.forget')}
            </Text>
          </Pressable>
        </Card>
      ) : null}
      <TextField
        value={keyInput}
        onChangeText={setKeyInput}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <PrimaryButton
        label={phase.kind === 'activating' ? t('subscription.activating') : t('subscription.activate')}
        onPress={() => void onActivateKey()}
        disabled={busy || keyInput.trim().length === 0 || db == null}
        style={styles.cta}
      />
      <Text style={[styles.small, { color: theme.subtle }, theme.font.body]}>{t('subscription.keyNote')}</Text>

      {/* ЮKassa's hosted form. Full screen, cancellable, and it closes itself the
          moment the payment redirects back to us. */}
      <Modal
        visible={phase.kind === 'paying'}
        animationType="slide"
        onRequestClose={() => {
          // The platform gesture (Android hardware back / iOS swipe-dismiss) is
          // the same «closed by hand» as the ✕ button: the payment may already
          // have gone through in a step we did not see — check before concluding,
          // otherwise a paid licence is silently never collected.
          const paymentId = phase.kind === 'paying' ? phase.paymentId : '';
          if (paymentId) void settle(paymentId);
          else setPhase({ kind: 'ready' });
        }}
      >
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetBar}>
            <Text style={[{ color: theme.text }, theme.font.bodySemiBold]}>{t('subscription.payTitle')}</Text>
            <Pressable
              onPress={() => {
                // Closing by hand is not "cancelled": the payment may have gone
                // through in a step we did not see. Check before concluding.
                const paymentId = phase.kind === 'paying' ? phase.paymentId : '';
                if (paymentId) void settle(paymentId);
                else setPhase({ kind: 'ready' });
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('subscription.close')}
            >
              <Text style={[{ color: theme.primary }, theme.font.bodyMedium]}>{t('subscription.close')}</Text>
            </Pressable>
          </View>
          {phase.kind === 'paying' ? (
            <WebView
              source={{ uri: phase.url }}
              startInLoadingState
              // HTTPS ONLY, and no local files. The card form is a remote page we do
              // not control, so the WebView must not be able to reach the device:
              // `file://` origins are what turn a redirect into a read of the app's
              // own storage. `mixedContentMode: never` keeps a bank's page from
              // pulling any part of itself over plain http.
              originWhitelist={['https://*']}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              // No second window can be conjured over the form — a popup is how a
              // payment page gets impersonated.
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              // Deliberately NOT an allowlist of hosts: 3-D Secure redirects to the
              // ISSUING BANK, which is a different domain for every card, so pinning
              // to ЮKassa would decline real payments. What is refused is every
              // non-https scheme — `javascript:`, `intent:`, `file:`, custom app
              // links — which is the part that is never a legitimate step of paying.
              onShouldStartLoadWithRequest={(req) => req.url.startsWith('https://')}
              // The return page is our own and carries nothing the user needs to
              // read — seeing it would just be a flash of a second page.
              //
              // Matched by ORIGIN + PATH, not `includes`: as a substring test, any
              // page anywhere could end the flow early by carrying «/billing/done»
              // in its query string.
              onNavigationStateChange={(nav) => {
                if (isReturnUrl(nav.url)) void settle(phase.paymentId);
              }}
              renderLoading={() => <ActivityIndicator style={styles.spinner} color={theme.primary} />}
            />
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

function Hero({ theme, lines }: { theme: Theme; lines: string[] }) {
  return (
    <View style={styles.hero}>
      {lines.map((line, i) => (
        <Text
          key={line}
          style={[styles.heroLine, { color: i === 0 ? theme.heroText : theme.heroAccent }, theme.font.heading]}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 32 },
  hero: { marginBottom: 16 },
  heroLine: { fontSize: 20, lineHeight: 26 },
  state: { fontSize: 20, marginBottom: 4 },
  quota: { marginTop: 6 },
  body: { marginTop: 2 },
  small: { fontSize: 13, marginTop: 6 },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  plan: { flexDirection: 'row', alignItems: 'center' },
  planText: { flex: 1 },
  cta: { marginTop: 16 },
  error: { marginTop: 12 },
  key: { fontSize: 18, letterSpacing: 1, marginTop: 4 },
  sheet: { flex: 1 },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
