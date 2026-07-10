import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { BodyMindCard } from '@/components/ui/BodyMindCard';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { MoodScale } from '@/components/ui/MoodScale';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { bestBodyMindFromDb } from '@/lib/core/db/bodyMind';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals } from '@/lib/core/db/food';
import { listMoods, logMood } from '@/lib/core/db/mood';
import type { MoodRow } from '@/lib/core/db/schema';
import { getSleepForDay } from '@/lib/core/db/sleep';
import { getStepsRow } from '@/lib/core/db/steps';
import {
  MIN_PAIRED_DAYS,
  type BodyMindSignal,
  type SignalAssociation,
} from '@/lib/core/insights/bodyMind';
import { sleepBand, sleepHours } from '@/lib/core/insights/sleepInsight';
import { useTheme } from '@/lib/theme/theme';

/// The MIND side of the app in one place («разделить тренировки и психику»,
/// device feedback 2026-07-10): the one-tap mood check-in, the Body↔Mind
/// insight it feeds, the thought diary, the sleep signal (only once real data
/// exists — sleep is passive and many users never track it), and the check-in
/// history. Home links here through a single calm row.
export default function MoodScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [items, setItems] = useState<MoodRow[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [best, setBest] = useState<SignalAssociation | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [proteinG, setProteinG] = useState(0);
  const [diaryCount, setDiaryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const [list, bestLink, stepsRow, sleep, tot, diaryN] = await Promise.all([
          listMoods(db, 30),
          bestBodyMindFromDb(db),
          getStepsRow(db),
          getSleepForDay(db),
          todayMacroTotals(db),
          countDiaryEntries(db),
        ]);
        if (!active) return;
        setItems(list);
        setSelected(list.length > 0 ? list[0].value : null);
        setBest(bestLink);
        setSteps(stepsRow != null ? Number(stepsRow.steps) : null);
        setSleepMin(sleep);
        setProteinG(tot.proteinG);
        setDiaryCount(diaryN);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onPick(value: number) {
    if (!db || saving) return;
    setSaving(true);
    setSelected(value);
    try {
      await logMood(db, value);
      setItems(await listMoods(db, 30));
    } finally {
      setSaving(false);
    }
  }

  // The signal the insight speaks about (steps / sleep / protein), and today's
  // value + glyph for its body column. Defaults to steps while still forming.
  const heroSignal: BodyMindSignal = best?.signal ?? 'steps';
  const signalNoun = t(`home.hero.signalNoun.${heroSignal}`);

  // Map the structured Body↔Mind result onto the presentational card. Every
  // honesty state is preserved: building placeholder below the gate, an honest
  // no-link line, and the "association, not cause" caption on real findings.
  const hero = ((): {
    eyebrow: string;
    accent?: string;
    headline: string;
    basis?: string;
    caption?: string;
  } => {
    const eyebrow = t('home.hero.eyebrow');
    const result = best?.result;
    if (!result || result.kind === 'insufficient') {
      const remaining = Math.max(1, MIN_PAIRED_DAYS - (result?.pairedDays ?? 0));
      return {
        eyebrow,
        headline: t(buildingKey(remaining), { days: remaining, signal: signalNoun }),
        caption: t('home.hero.buildingCaption'),
      };
    }
    const basis = t('home.bodyMind.basis', { days: result.pairedDays, signal: signalNoun });
    if (result.kind === 'no_link') {
      return {
        eyebrow,
        headline: t(`bodyMind.hero.signalNoLink.${heroSignal}`),
        basis,
        caption: t('home.hero.caption'),
      };
    }
    const dir = result.direction === 'more_better' ? 'better' : 'worse';
    return {
      eyebrow,
      accent: t('bodyMind.hero.accent', { gap: result.moodGap }),
      headline: t(`bodyMind.hero.signal.${heroSignal}.${dir}`, { gap: result.moodGap }),
      basis,
      caption: t('home.hero.caption'),
    };
  })();

  const bodyColValue = ((): string => {
    if (heroSignal === 'sleep') {
      return sleepMin != null ? `${sleepHours(sleepMin)} ${t('units.h')}` : '—';
    }
    if (heroSignal === 'protein') {
      return `${Math.round(proteinG)} ${t('units.g')}`;
    }
    return steps != null ? formatSteps(steps) : '—';
  })();

  const diaryRow: RowSpec = {
    key: 'diary',
    icon: 'sparkles-outline',
    tint: theme.primary,
    iconBg: theme.scheme === 'light' ? '#FBE2D9' : '#3A241B',
    title: t('home.feeders.diary'),
    subtitle: diaryCount > 0 ? t('home.feeders.diaryCount', { count: diaryCount }) : t('home.feeders.diaryCta'),
    onPress: () => router.push('/diary'),
  };
  // Sleep appears ONLY once the OS health store actually delivered a night —
  // a permanent «нет данных» row was dead weight («сон ваще не отслеживаем»).
  const sleepRow: RowSpec | null =
    sleepMin != null
      ? {
          key: 'sleep',
          icon: 'moon-outline',
          tint: theme.primary,
          iconBg: theme.scheme === 'light' ? '#E9E2FA' : '#272138',
          title: t('home.feeders.sleep'),
          subtitle: `${sleepHours(sleepMin)} ${t('units.h')} — ${t(`home.sleep.meaning.${sleepBand(sleepMin)}`)}`,
        }
      : null;

  const historyRows: RowSpec[] = (items ?? []).map((m) => ({
    key: String(m.id),
    title: formatDate(m.ts),
    right: <Text style={[styles.value, { color: theme.text }, theme.font.bodyBold]}>{m.value}/10</Text>,
  }));

  return (
    <Screen>
      <Text style={[styles.prompt, { color: theme.text }, theme.font.bodySemiBold]}>
        {t('mood.prompt')}
      </Text>
      <View style={styles.scaleWrap}>
        <MoodScale selected={selected} onPick={onPick} disabled={db == null || saving} variant="grid" />
      </View>
      <Text style={[styles.scale, { color: theme.subtle }, theme.font.body]}>{t('mood.scale')}</Text>

      {/* The insight this check-in feeds — moved off Home with the rest of the
          mind side, honesty states intact. */}
      <View style={styles.hero}>
        <BodyMindCard
          eyebrow={hero.eyebrow}
          accent={hero.accent}
          headline={hero.headline}
          basis={hero.basis}
          caption={hero.caption}
          bodyLabel={t(`home.bodyMindCol.bodySignal.${heroSignal}`)}
          bodyValue={bodyColValue}
          bodyIcon={SIGNAL_ICON[heroSignal]}
          mindLabel={t('home.bodyMindCol.mind')}
          mindValue={selected != null ? `${selected}/10` : '—'}
        />
      </View>

      <View style={styles.rows}>
        <ListGroup rows={sleepRow ? [diaryRow, sleepRow] : [diaryRow]} />
      </View>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('mood.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('mood.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <ListGroup rows={historyRows} />
        </View>
      )}
    </Screen>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// Picks the plural-correct "N more days" key. i18next here is configured without
/// the plural-suffix plugin, so we branch explicitly (ru: one/few/many, en:
/// one/other) to keep the building copy grammatical.
function buildingKey(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'home.hero.buildingOne';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'home.hero.buildingFew';
  }
  return 'home.hero.buildingMany';
}

/// Thin-space thousands so "6 240" reads like the steps widget.
function formatSteps(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/// The body-column glyph for each insight signal.
const SIGNAL_ICON: Record<BodyMindSignal, 'walk-outline' | 'moon-outline' | 'nutrition-outline'> = {
  steps: 'walk-outline',
  sleep: 'moon-outline',
  protein: 'nutrition-outline',
};

const styles = StyleSheet.create({
  prompt: { fontSize: 17, marginTop: 4 },
  scaleWrap: { marginTop: 14 },
  scale: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  hero: { marginTop: 18 },
  rows: { marginTop: 16 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 16 },
  value: { fontSize: 16 },
});
