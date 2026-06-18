import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { quickMeals, saveParsedEntry, todayMacroTotals, type QuickMeal } from '@/lib/core/db/food';
import { ensureSettings } from '@/lib/core/db/settings';
import { proteinInsight } from '@/lib/core/insights/proteinInsight';
import type { MealDraft, Minerals, NutritionItem, Region } from '@/lib/core/services/foodParser';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { recomputeDraft, withItemGrams } from '@/lib/core/services/mealDraft';
import { capturePhoto } from '@/lib/core/services/photoProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { type Theme, useTheme } from '@/lib/theme/theme';

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];

/// Text/voice → parse → two-tier honest result (exact per-100g + approximate
/// whole-dish total) → confirm grams → save.
export default function FoodLogScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  // The Home mic FAB deep-links here with ?voice=1 to start dictation at once.
  const { voice } = useLocalSearchParams<{ voice?: string }>();
  // Region setting ('auto' until settings load); the active region honors it,
  // falling back to device locale (resolveRegion).
  const [regionSetting, setRegionSetting] = useState<'auto' | 'RU' | 'US'>('auto');
  const region: Region = resolveRegion(regionSetting);

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  // The original estimated grams per item, for the S/M/L presets.
  const [baseGrams, setBaseGrams] = useState<number[]>([]);
  // Today's protein-so-far + personal target, for the honest "what it means"
  // line shown once a meal is parsed (the meaning-rules library).
  const [proteinTarget, setProteinTarget] = useState(0);
  const [todayProteinG, setTodayProteinG] = useState(0);
  const [hideCalories, setHideCalories] = useState(false);
  const [quick, setQuick] = useState<{ recents: QuickMeal[]; favorites: QuickMeal[] }>({
    recents: [],
    favorites: [],
  });
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  // Origin of the current draft, so the saved entry's `source` is honest.
  const [source, setSource] = useState<'text' | 'voice' | 'photo'>('text');
  const autoStarted = useRef(false);

  function setFreshDraft(d: MealDraft | null) {
    setDraft(d);
    setBaseGrams(d ? d.items.map((it) => it.grams) : []);
  }

  // Probe the on-device recognizer once; off-device this stays false and the
  // mic button never shows (text entry is the fallback). Stop on unmount.
  useEffect(() => {
    let active = true;
    const speech = getSpeechService();
    void speech.initialize().then((ok) => {
      if (active) setSpeechAvailable(ok);
    });
    return () => {
      active = false;
      void speech.stop();
    };
  }, []);

  async function toggleListening() {
    const speech = getSpeechService();
    if (listening) {
      await speech.stop();
      setListening(false);
      return;
    }
    setFreshDraft(null);
    setSource('voice');
    setListening(true);
    await speech.listen(
      (transcript, isFinal) => {
        setText(transcript);
        if (isFinal) setListening(false);
      },
      // Always clear the listening state when the session ends, even with no
      // final result (no match / error / timeout / denied permission).
      () => setListening(false),
    );
  }

  // Honor a ?voice=1 deep-link once the recognizer is known to be available.
  useEffect(() => {
    if (voice === '1' && speechAvailable && !autoStarted.current) {
      autoStarted.current = true;
      void toggleListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, speechAvailable]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      const [settings, totals, quickAdd] = await Promise.all([
        ensureSettings(db),
        todayMacroTotals(db),
        quickMeals(db),
      ]);
      if (!active) return;
      setProteinTarget(settings.targetProteinG);
      setTodayProteinG(totals.proteinG);
      setHideCalories(settings.hideCalories);
      setRegionSetting(settings.region);
      setQuick(quickAdd);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  /// One tap re-loads a past meal as an already-confirmed draft (no parse) — the
  /// user still reviews and saves.
  function onQuickPick(meal: QuickMeal) {
    setText(meal.rawText);
    setSource('text');
    const item: NutritionItem = {
      name_ru: meal.rawText,
      name_en: meal.rawText,
      grams: 100,
      grams_source: 'confirmed',
      confidence: 1,
      per100: { source: 'estimate', kcal: meal.kcal, prot: meal.proteinG, fat: meal.fatG, carb: meal.carbG, minerals: {} },
      scaled: { kcal: meal.kcal, prot: meal.proteinG, fat: meal.fatG, carb: meal.carbG, minerals: {} },
      approximate: false,
    };
    setFreshDraft(recomputeDraft(region, [item]));
  }

  async function onParse() {
    if (text.trim().length === 0) return;
    setParsing(true);
    try {
      setFreshDraft(await getFoodParser().parse(text, region));
    } finally {
      setParsing(false);
    }
  }

  // Photo → downscale + EXIF strip → backend vision → same two-tier draft.
  async function onPhoto() {
    if (parsing || listening) return;
    const photo = await capturePhoto('camera');
    if (!photo) return;
    setSource('photo');
    setParsing(true);
    try {
      setFreshDraft(await getFoodParser().parsePhoto(photo, region));
    } finally {
      setParsing(false);
    }
  }

  function onItemGrams(index: number, grams: number) {
    setDraft((prev) => (prev ? withItemGrams(prev, index, grams) : prev));
  }

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    try {
      await saveParsedEntry(db, { rawText: text, source, draft });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TextField
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (!listening) setSource('text');
        }}
        placeholder={t('food.inputPlaceholder')}
        multiline
        style={styles.input}
      />
      {speechAvailable ? (
        <Pressable
          onPress={toggleListening}
          style={({ pressed }) => [
            styles.micButton,
            {
              borderColor: listening ? theme.primary : theme.separator,
              backgroundColor: listening ? theme.primary : theme.card,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.micText, { color: listening ? theme.onPrimary : theme.primary }, theme.font.bodySemiBold]}>
            {listening ? t('food.voiceListening') : t('food.voice')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPhoto}
        disabled={parsing || listening}
        style={({ pressed }) => [
          styles.micButton,
          { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed || parsing || listening ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.micText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('food.photo')}</Text>
      </Pressable>
      <PrimaryButton
        label={parsing ? t('food.parsing') : t('food.parse')}
        onPress={onParse}
        disabled={parsing || listening || text.trim().length === 0}
      />

      {draft == null && (quick.favorites.length > 0 || quick.recents.length > 0) ? (
        <View style={styles.quick}>
          {(
            [
              { label: t('food.favorites'), meals: quick.favorites },
              { label: t('food.recent'), meals: quick.recents },
            ] as const
          ).map((group) =>
            group.meals.length === 0 ? null : (
              <View key={group.label} style={styles.quickGroup}>
                <Text style={[styles.quickLabel, { color: theme.subtle }, theme.font.heading]}>
                  {group.label.toUpperCase()}
                </Text>
                <View style={styles.quickWrap}>
                  {group.meals.map((m, i) => (
                    <Pressable
                      key={i}
                      onPress={() => onQuickPick(m)}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }, theme.font.bodySemiBold]}>
                        {m.rawText}
                      </Text>
                      <Text style={[styles.chipMacro, { color: theme.subtle }, theme.font.body]}>
                        {t('macros.protein')} {Math.round(m.proteinG)} {t('units.g')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ),
          )}
        </View>
      ) : null}

      {draft == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.empty')}</Text>
      ) : draft.items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.needHelp')}</Text>
      ) : (
        <View style={styles.results}>
          {draft.items.map((item, i) => (
            <ItemCard
              key={i}
              item={item}
              baseGrams={baseGrams[i] ?? item.grams}
              hideCalories={hideCalories}
              theme={theme}
              onGrams={(g) => onItemGrams(i, g)}
            />
          ))}

          <Card style={[styles.totalCard, { borderColor: theme.separator }]}>
            <View style={styles.totalHead}>
              <Text style={[styles.totalLabel, { color: theme.text }, theme.font.bodySemiBold]}>{t('food.total')}</Text>
              {draft.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
            </View>
            <Text style={[styles.totalValue, { color: theme.text }, theme.font.bodyMedium]}>
              {hideCalories
                ? `${t('macros.protein')} ${draft.totals.prot} ${t('units.g')}`
                : `${draft.totals.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${draft.totals.prot} ${t('units.g')} · ${t('macros.fat')} ${draft.totals.fat} · ${t('macros.carbs')} ${draft.totals.carb}`}
            </Text>
            {draft.approximate ? (
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('food.disclaimer')}</Text>
            ) : null}
            {draft.flags.has_estimate ? (
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('food.estimateNote')}</Text>
            ) : null}
          </Card>

          {proteinTarget > 0 ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {proteinInsight(todayProteinG + draft.totals.prot, proteinTarget)}
            </Text>
          ) : null}
          <PrimaryButton
            label={saving ? t('food.saving') : t('food.save')}
            onPress={onSave}
            disabled={saving || db == null}
          />
          {db == null ? (
            <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.dbUnavailable')}</Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function ApproxBadge({ theme, label }: { theme: Theme; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: theme.card, borderColor: theme.primary }]}>
      <Text style={[styles.badgeText, { color: theme.primary }, theme.font.bodySemiBold]}>{label}</Text>
    </View>
  );
}

function mineralLine(item: NutritionItem, t: (k: string) => string): string {
  const parts: string[] = [];
  for (const key of MINERAL_KEYS) {
    const v = item.per100.minerals[key];
    if (typeof v === 'number' && v > 0) parts.push(`${t(`food.minerals.${key}`)} ${Math.round(v)}`);
  }
  return parts.join(' · ');
}

function ItemCard({
  item,
  baseGrams,
  hideCalories,
  theme,
  onGrams,
}: {
  item: NutritionItem;
  baseGrams: number;
  hideCalories: boolean;
  theme: Theme;
  onGrams: (grams: number) => void;
}) {
  const { t } = useTranslation();
  const minerals = mineralLine(item, t);
  const presets: { label: string; grams: number }[] = [
    { label: t('food.presetLess'), grams: Math.max(5, Math.round(baseGrams * 0.6)) },
    { label: t('food.presetMid'), grams: Math.max(5, Math.round(baseGrams)) },
    { label: t('food.presetMore'), grams: Math.max(5, Math.round(baseGrams * 1.6)) },
  ];

  return (
    <Card style={styles.item}>
      <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]}>{item.name_ru}</Text>

      {/* Per-100g composition — EXACT, presented as fact. */}
      <Text style={[styles.per100Label, { color: theme.subtle }, theme.font.body]}>
        {t('food.per100')} · {t(`food.source.${item.per100.source}`)}
      </Text>
      <Text style={[styles.per100Value, { color: theme.text }, theme.font.body]}>
        {hideCalories
          ? `${t('macros.protein')} ${item.per100.prot} · ${t('macros.fat')} ${item.per100.fat} · ${t('macros.carbs')} ${item.per100.carb}`
          : `${item.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${item.per100.prot} · ${t('macros.fat')} ${item.per100.fat} · ${t('macros.carbs')} ${item.per100.carb}`}
      </Text>
      {minerals.length > 0 ? (
        <Text style={[styles.minerals, { color: theme.subtle }, theme.font.body]}>{minerals}</Text>
      ) : null}

      {/* Confirm grams → flips the item out of "approximate". */}
      <View style={styles.gramsRow}>
        <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>{t('food.grams')}</Text>
        <View style={styles.presets}>
          {presets.map((p) => {
            const active = Math.round(item.grams) === p.grams;
            return (
              <Pressable
                key={p.label}
                onPress={() => onGrams(p.grams)}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: active ? theme.primary : theme.card,
                    borderColor: active ? theme.primary : theme.separator,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.presetText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          value={String(Math.round(item.grams))}
          onChangeText={(v) => onGrams(toNumber(v))}
          keyboardType="numeric"
          style={styles.gramsInput}
        />
        <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
      </View>

      {/* Scaled component total — approximate until grams confirmed. */}
      <View style={styles.itemTotalRow}>
        <Text style={[styles.itemTotal, { color: theme.text }, theme.font.bodyMedium]}>
          {hideCalories
            ? `${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`
            : `${item.scaled.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`}
        </Text>
        {item.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
      </View>
    </Card>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
  micButton: { borderRadius: 999, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  micText: { fontSize: 15 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  item: { marginBottom: 10 },
  itemName: { fontSize: 15, marginBottom: 6 },
  per100Label: { fontSize: 11, marginBottom: 2 },
  per100Value: { fontSize: 13, marginBottom: 2 },
  minerals: { fontSize: 11, marginBottom: 8, lineHeight: 16 },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  gramsLabel: { fontSize: 12 },
  presets: { flexDirection: 'row', gap: 6 },
  preset: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  presetText: { fontSize: 12 },
  gramsInput: { width: 64, paddingVertical: 8, fontSize: 14, textAlign: 'center' },
  gramsUnit: { fontSize: 12 },
  itemTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  itemTotal: { fontSize: 14 },
  totalCard: { marginTop: 4, marginBottom: 8 },
  totalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  totalLabel: { fontSize: 15 },
  totalValue: { fontSize: 14 },
  disclaimer: { fontSize: 11, marginTop: 8, lineHeight: 16 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11 },
  proteinNote: { fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  quick: { marginTop: 16 },
  quickGroup: { marginBottom: 14 },
  quickLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
