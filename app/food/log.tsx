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
import type { FoodParseResult, ParsedFoodItem } from '@/lib/core/services/foodParser';
import { getFoodParser } from '@/lib/core/services/foodParserProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { type Theme, useTheme } from '@/lib/theme/theme';

interface MacroLabels {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
}

/// Text → parse (offline stub) → editable confirm list → save.
export default function FoodLogScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  // The Home mic FAB deep-links here with ?voice=1 to start dictation at once.
  const { voice } = useLocalSearchParams<{ voice?: string }>();

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<FoodParseResult | null>(null);
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
  // Records whether the current draft came from voice, so the saved entry's
  // `source` is honest ('voice' vs 'text').
  const [usedVoice, setUsedVoice] = useState(false);
  const autoStarted = useRef(false);

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
    setResult(null);
    setUsedVoice(true);
    setListening(true);
    await speech.listen((transcript, isFinal) => {
      setText(transcript);
      if (isFinal) setListening(false);
    });
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
      setQuick(quickAdd);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  /// One tap re-loads a past meal into the editable confirm list (no typing, no
  /// parse) — the user still reviews and saves.
  function onQuickPick(meal: QuickMeal) {
    setText(meal.rawText);
    setUsedVoice(false);
    setResult({
      items: [
        {
          name: meal.rawText,
          qtyG: null,
          kcal: meal.kcal,
          proteinG: meal.proteinG,
          fatG: meal.fatG,
          carbG: meal.carbG,
          assumptions: '',
        },
      ],
      kcal: meal.kcal,
      proteinG: meal.proteinG,
      fatG: meal.fatG,
      carbG: meal.carbG,
      confidence: 'high',
      needsClarification: false,
      clarifyQuestion: null,
    });
  }

  const labels: MacroLabels = {
    kcal: t('units.kcal'),
    protein: t('macros.protein'),
    fat: t('macros.fat'),
    carbs: t('macros.carbs'),
  };

  async function onParse() {
    if (text.trim().length === 0) return;
    setParsing(true);
    try {
      setResult(await getFoodParser().parse(text));
    } finally {
      setParsing(false);
    }
  }

  function patchItem(index: number, patch: Partial<ParsedFoodItem>) {
    setResult((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
      return { ...prev, items, ...sumItems(items) };
    });
  }

  async function onSave() {
    if (!result || !db) return;
    setSaving(true);
    try {
      await saveParsedEntry(db, { rawText: text, source: usedVoice ? 'voice' : 'text', result });
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
          if (!listening) setUsedVoice(false);
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
      <PrimaryButton
        label={parsing ? t('food.parsing') : t('food.parse')}
        onPress={onParse}
        disabled={parsing || listening || text.trim().length === 0}
      />

      {result == null && (quick.favorites.length > 0 || quick.recents.length > 0) ? (
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

      {result == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.empty')}</Text>
      ) : result.items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.needHelp')}</Text>
      ) : (
        <View style={styles.results}>
          {result.items.map((item, i) => (
            <ItemEditor
              key={i}
              item={item}
              labels={labels}
              hideCalories={hideCalories}
              theme={theme}
              onChange={(p) => patchItem(i, p)}
            />
          ))}
          <View style={[styles.totalRow, { borderColor: theme.separator }]}>
            <Text style={[styles.totalLabel, { color: theme.text }, theme.font.bodySemiBold]}>{t('food.total')}</Text>
            <Text style={[styles.totalValue, { color: theme.text }, theme.font.bodyMedium]}>
              {hideCalories
                ? `${labels.protein} ${result.proteinG} ${t('units.g')}`
                : `${result.kcal} ${labels.kcal} · ${labels.protein} ${result.proteinG} ${t('units.g')}`}
            </Text>
          </View>
          {proteinTarget > 0 ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {proteinInsight(todayProteinG + result.proteinG, proteinTarget)}
            </Text>
          ) : null}
          <Text style={[styles.stubNote, { color: theme.subtle }, theme.font.body]}>{t('food.stubNote')}</Text>
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

function ItemEditor({
  item,
  labels,
  hideCalories,
  theme,
  onChange,
}: {
  item: ParsedFoodItem;
  labels: MacroLabels;
  hideCalories: boolean;
  theme: Theme;
  onChange: (patch: Partial<ParsedFoodItem>) => void;
}) {
  return (
    <Card style={styles.item}>
      <TextField value={item.name} onChangeText={(v) => onChange({ name: v })} style={styles.itemName} />
      <View style={styles.macroRow}>
        {!hideCalories && (
          <MacroField label={labels.kcal} value={item.kcal} theme={theme} onChange={(n) => onChange({ kcal: n })} />
        )}
        <MacroField label={labels.protein} value={item.proteinG} theme={theme} onChange={(n) => onChange({ proteinG: n })} />
        <MacroField label={labels.fat} value={item.fatG} theme={theme} onChange={(n) => onChange({ fatG: n })} />
        <MacroField label={labels.carbs} value={item.carbG} theme={theme} onChange={(n) => onChange({ carbG: n })} />
      </View>
      {item.assumptions ? (
        <Text style={[styles.assumptions, { color: theme.subtle }, theme.font.body]}>{item.assumptions}</Text>
      ) : null}
    </Card>
  );
}

function MacroField({
  label,
  value,
  theme,
  onChange,
}: {
  label: string;
  value: number;
  theme: Theme;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.macroField}>
      <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <TextField
        value={String(value)}
        onChangeText={(v) => onChange(toNumber(v))}
        keyboardType="numeric"
        style={styles.macroInput}
      />
    </View>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function sumItems(items: ParsedFoodItem[]) {
  const r = (n: number) => Math.round(n * 10) / 10;
  return items.reduce(
    (acc, i) => ({
      kcal: r(acc.kcal + i.kcal),
      proteinG: r(acc.proteinG + i.proteinG),
      fatG: r(acc.fatG + i.fatG),
      carbG: r(acc.carbG + i.carbG),
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
  micButton: { borderRadius: 999, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  micText: { fontSize: 15 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  item: { marginBottom: 10 },
  itemName: { marginBottom: 10 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macroField: { flex: 1 },
  macroLabel: { fontSize: 11, marginBottom: 3 },
  macroInput: { paddingVertical: 8, fontSize: 14 },
  assumptions: { fontSize: 11, marginTop: 8, fontStyle: 'italic', lineHeight: 16 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  totalLabel: { fontSize: 15 },
  totalValue: { fontSize: 14 },
  stubNote: { fontSize: 11, fontStyle: 'italic', marginBottom: 12 },
  proteinNote: { fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  quick: { marginTop: 16 },
  quickGroup: { marginBottom: 14 },
  quickLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
