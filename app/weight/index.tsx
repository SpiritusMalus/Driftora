import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DeviceHealthCard } from '@/components/DeviceHealthCard';
import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { WeightRow } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { listWeights, syncWeighIns, upsertWeight } from '@/lib/core/db/weight';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { bmiCategory, bmiValue } from '@/lib/core/insights/bodyMetrics';
import { weightValid } from '@/lib/core/insights/bodySetup';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// «Вес» — ONE object in the app-wide section order (2026-08-22, «в весе прям
/// нагромождено всё»): hero → input → what it means → history. Everything that
/// was configuration (the КБЖУ plan, the measured burn, body parameters, manual
/// targets) moved to «План питания» /plan, and the vitamins reference table is
/// gone — «Еда» already shows those norms against what was actually eaten.
///
/// The weekly ritual this screen is built around: open → type one number →
/// immediately SEE what it means. Logging stays low-pressure (optional, echoed
/// where typed); the plan row below carries the payoff — the day target the new
/// weight feeds — without dragging its whole form onto this screen.
export default function WeightScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [items, setItems] = useState<WeightRow[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // «120.0 кг — записано ✓» under the save button; cleared when typing again.
  const [weightAck, setWeightAck] = useState<string | null>(null);
  // Extended device import: null = settings not loaded yet (card hidden), else
  // the healthImportExtended flag.
  const [extendedOn, setExtendedOn] = useState<boolean | null>(null);
  // Read-only echoes of the plan the /plan screen owns: the height BMI needs and
  // the targets currently driving «Еду».
  const [heightCm, setHeightCm] = useState(0);
  const [targets, setTargets] = useState<{
    kcal: number;
    prot: number;
    fat: number;
    carb: number;
    setAt: number | null;
  } | null>(null);
  const [openBmi, setOpenBmi] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        // Settings FIRST — the extended-import flag decides whether to pull the
        // day's scale weigh-in before listing (device rows never overwrite a
        // manual day, see upsertDeviceWeight).
        const s = await ensureSettings(db);
        if (!active) return;
        setExtendedOn(s.healthImportExtended);
        setHeightCm(s.heightCm);
        setTargets({
          kcal: s.targetKcal,
          prot: s.targetProteinG,
          fat: s.targetFatG,
          carb: s.targetCarbG,
          setAt: s.targetsSetAt,
        });
        if (s.healthImportExtended) {
          await syncWeighIns(db, getHealthService(), 1).catch(() => {});
        }
        const list = await listWeights(db, 30);
        if (!active) return;
        setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onSaveWeight() {
    const kg = toNumber(text);
    // Same bounds as the body-setup wizard — a slipped decimal («9.4» for 94)
    // must not silently poison the trend, BMI and the day plan.
    if (!db || !weightValid(kg)) return;
    setSaving(true);
    try {
      // Delta vs the previous DIFFERENT day (a same-day re-weigh overwrites, so
      // comparing against it would always read «0.0 с прошлого раза»).
      const today = toDayString(new Date());
      const prev = (items ?? []).find((w) => w.date !== today) ?? null;
      await upsertWeight(db, new Date(), kg);
      setText('');
      const delta = prev ? kg - prev.weightKg : 0;
      setWeightAck(
        prev && Math.abs(delta) >= 0.05
          ? t('weight.savedDelta', { kg: kg.toFixed(1), delta: signedKg(delta) })
          : t('weight.savedNow', { kg: kg.toFixed(1) }),
      );
      setItems(await listWeights(db, 30));
    } finally {
      setSaving(false);
    }
  }

  const points: WeightPoint[] = (items ?? []).map((w) => ({ date: w.date, weightKg: w.weightKg }));
  const trend = summarizeWeightTrend(points);
  const trendLine = (() => {
    if (!trend) return null;
    const abs = Math.abs(trend.deltaKg).toFixed(1);
    const days = trend.spanDays;
    if (trend.direction === 'steady') return t('weight.trend.steady', { days, abs });
    if (trend.direction === 'down') return t('weight.trend.down', { days, abs });
    return t('weight.trend.up', { days, abs });
  })();

  const valid = weightValid(toNumber(text));
  // Out-of-range typed input (likely a slipped decimal) — say why Save is dead.
  const rangeIssue = text.trim().length > 0 && toNumber(text) > 0 && !valid;

  const latestKg = items != null && items.length > 0 ? items[0].weightKg : 0;
  const bmi = bmiValue(latestKg, heightCm);

  const rows: RowSpec[] = (items ?? []).map((w) => ({
    key: w.date,
    title: formatDay(w.date),
    // Provenance, always visible («никакой тихой магии»): typed vs scale. The
    // scale's body-fat % rides on the same row when it was measured.
    subtitle: w.source === 'device' ? t('weight.source.device') : t('weight.source.manual'),
    right: (
      <Text style={[styles.rowKg, { color: theme.text }, theme.font.bodySemiBold]}>
        {w.weightKg.toFixed(1)} {t('weight.unit')}
        {w.bodyFatPct != null ? ` · ${w.bodyFatPct.toFixed(1)}%` : ''}
      </Text>
    ),
  }));

  // The payoff of a weigh-in, one line: what the day target IS right now. Only a
  // DELIBERATE goal counts (targetsSetAt) — the untouched 2000/120/70/200
  // defaults are not a plan, same rule as Home and the food day.
  const planRow: RowSpec[] = [
    {
      key: 'plan',
      icon: 'flag-outline',
      tint: theme.primary,
      iconBg: theme.primarySoft,
      title: t('weight.planRow.title'),
      subtitle:
        targets != null && targets.setAt != null
          ? t('weight.planRow.summary', {
              kcal: Math.round(targets.kcal),
              prot: Math.round(targets.prot),
              fat: Math.round(targets.fat),
              carb: Math.round(targets.carb),
            })
          : t('weight.planRow.empty'),
      onPress: () => router.push('/plan'),
    },
  ];

  const bmiSummary =
    bmi != null
      ? t('weight.bmi.summary', { value: bmi.toFixed(1), category: t(`weight.bmi.category.${bmiCategory(bmi)}`) })
      : latestKg <= 0
        ? t('weight.bmi.needWeightShort')
        : t('weight.bmi.needHeightShort');

  return (
    <Screen>
      {/* ── 1. HERO — the current weight is the point of the screen. The trend
             rides right under it (single weigh-ins are noise), unifying with the
             «Шаги» hero. ── */}
      <View style={styles.hero}>
        {latestKg > 0 ? (
          <>
            <View style={styles.heroRow}>
              <Text style={[styles.heroNum, { color: theme.text }, theme.font.display]}>
                {latestKg.toFixed(1)}
              </Text>
              <Text style={[styles.heroUnit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
            </View>
            {trendLine ? (
              <>
                <Text style={[styles.heroTrend, { color: theme.subtle }, theme.font.bodyMedium]}>{trendLine}</Text>
                <Text style={[styles.heroNote, { color: theme.subtle }, theme.font.body]}>{t('weight.note')}</Text>
              </>
            ) : null}
          </>
        ) : (
          <Text style={[styles.heroEmpty, { color: theme.subtle }, theme.font.body]}>{t('weight.hero.empty')}</Text>
        )}
      </View>

      {/* ── 2. The ritual: type today's weight, see it acknowledged. ── */}
      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (weightAck) setWeightAck(null);
          }}
          placeholder={t('weight.placeholder')}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
      </View>
      <PrimaryButton
        label={saving ? t('weight.saving') : t('weight.save')}
        onPress={onSaveWeight}
        disabled={db == null || !valid || saving}
        style={styles.save}
      />
      {rangeIssue ? (
        <Text style={[styles.weightAck, { color: theme.subtle }, theme.font.body]}>{t('weight.rangeHint')}</Text>
      ) : null}
      {/* Transient echo of the number just typed (with its delta), so it doesn't
          silently vanish into the history list. */}
      {weightAck ? (
        <Text style={[styles.weightAck, { color: theme.accent }, theme.font.bodyMedium]}>{weightAck}</Text>
      ) : null}

      {/* AUTOMATIC weigh-ins — smart-scale import via Здоровье / Health Connect.
          Shown until connected (extendedOn); afterwards the source tags on the
          history rows carry the honesty and the screen stays quiet. */}
      {db != null && extendedOn === false ? (
        <DeviceHealthCard
          explainer={t('device.weightExplainer')}
          onConnected={async () => {
            await syncWeighIns(db, getHealthService(), 30).catch(() => {});
            setItems(await listWeights(db, 30));
            setExtendedOn(true);
          }}
        />
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.dbUnavailable')}</Text>
      ) : (
        <>
          {/* ── 3. What the number MEANS: the day target it feeds (one row into
                 «План питания») and BMI as one quiet line. ── */}
          <View style={styles.planGroup}>
            <ListGroup rows={planRow} />
          </View>

          <Section
            title={t('weight.bmi.title')}
            summary={bmiSummary}
            open={openBmi}
            onToggle={() => setOpenBmi((v) => !v)}
            theme={theme}
          >
            {bmi != null ? (
              <>
                <Text style={[styles.bmiValue, { color: theme.text }, theme.font.bodySemiBold]}>
                  {t('weight.bmi.value', {
                    value: bmi.toFixed(1),
                    category: t(`weight.bmi.category.${bmiCategory(bmi)}`),
                  })}
                </Text>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.bmi.current', { kg: latestKg.toFixed(1), cm: Math.round(heightCm) })}
                </Text>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('weight.bmi.ranges')}</Text>
              </>
            ) : (
              <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                {latestKg <= 0 ? t('weight.bmi.needWeight') : t('weight.bmi.needHeight')}
              </Text>
            )}
            <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
              {t('weight.bmi.disclaimer')}
            </Text>
          </Section>

          {/* ── 4. History, ALWAYS open — same as «Шаги». It is what the screen
                 is for; folding it away was the old screen's inversion. ── */}
          <SectionHeader>{t('weight.sections.history.title')}</SectionHeader>
          {items == null || items.length === 0 ? (
            <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('weight.empty')}</Text>
          ) : (
            <ListGroup rows={rows} />
          )}
        </>
      )}
    </Screen>
  );
}

/// A card that folds to a single line: title + live one-line summary + chevron.
/// The summary carries the useful number, so opening is usually unnecessary.
function Section({
  title,
  summary,
  open,
  onToggle,
  children,
  theme,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  theme: Theme;
}) {
  return (
    <Card style={styles.sectionCard}>
      <Pressable onPress={onToggle} style={styles.sectionHeader} hitSlop={6}>
        <Text style={[styles.sectionTitle, { color: theme.text }, theme.font.bodySemiBold]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.sectionSummary, { color: theme.subtle }, theme.font.body]}>
          {summary}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </Card>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/// '+0.4' / '-0.4' — the sign IS the message, so it is always printed.
function signedKg(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

/// Local calendar day as 'YYYY-MM-DD' (matches the weights table's day key).
function toDayString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

const styles = StyleSheet.create({
  // Hero — current weight big, trend riding under it (mirrors the «Шаги» hero).
  hero: { marginTop: 8, marginBottom: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroNum: { fontSize: 40, lineHeight: 44 },
  heroUnit: { fontSize: 15 },
  heroTrend: { fontSize: 14, lineHeight: 19, marginTop: 6 },
  heroNote: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  heroEmpty: { fontSize: 15, lineHeight: 21 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 6 },
  weightAck: { fontSize: 14, textAlign: 'center', marginBottom: 10 },
  planGroup: { marginTop: 4, marginBottom: 12 },
  note: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  bmiValue: { fontSize: 15, marginTop: 2 },
  disclaimer: { fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  rowKg: { fontSize: 16 },
  sectionCard: { marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 15 },
  sectionSummary: { fontSize: 13, flex: 1, textAlign: 'right' },
  sectionBody: { marginTop: 12 },
});
