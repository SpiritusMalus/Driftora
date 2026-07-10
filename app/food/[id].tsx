import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MealChips } from '@/components/food/MealChips';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  deleteFoodEntry,
  draftFromStoredEntry,
  getFoodEntry,
  repeatFoodEntry,
  updateFoodEntry,
} from '@/lib/core/db/food';
import type { FoodEntry } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { mealTypeForEntry, type MealType } from '@/lib/core/insights/mealType';
import type { MealDraft, NutritionAlternative, NutritionItem, Region } from '@/lib/core/services/foodParser';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { removeDraftItem, withItemGrams, withItemReplacement } from '@/lib/core/services/mealDraft';
import { useTheme } from '@/lib/theme/theme';

function toNumber(v: string): number {
  // Accept a decimal comma (ru keyboard) and keep the fractional part. The old
  // `parseInt` after stripping every non-digit turned "70,5" into 705 — a 10×
  // portion. Normalize comma→dot, drop stray unit text, then parse as a float
  // (matches the log screen's toNumber).
  const n = parseFloat(v.replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/// View one logged food entry and edit it: fix each dish's grams (macros rescale
/// live), remove a dish you changed your mind about, or replace one with another
/// via manual DB search. Grams/replacement reuse the same recompute math as the
/// log screen. A stored entry keeps no parse provenance, so "replace" is a fresh
/// DB search rather than re-running the auto-match.
export default function FoodEntryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);

  const [entry, setEntry] = useState<FoodEntry | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [rawText, setRawText] = useState('');
  // Meal-of-day chips: start from the stored pick; old rows without one show
  // the same keyword/clock guess the day list uses, so what's edited here
  // matches what the user saw there.
  const [meal, setMeal] = useState<MealType | null>(null);
  const [region, setRegion] = useState<Region>('RU');
  const [aiConsent, setAiConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db || !Number.isFinite(entryId)) return;
      const [detail, settings] = await Promise.all([getFoodEntry(db, entryId), ensureSettings(db)]);
      if (!active) return;
      if (!detail) {
        setMissing(true);
        return;
      }
      const r = resolveRegion(settings.region);
      const d = draftFromStoredEntry(r, detail.items);
      setEntry(detail.entry);
      setRawText(detail.entry.rawText);
      setMeal(detail.entry.meal ?? mealTypeForEntry(detail.entry.rawText, detail.entry.ts));
      setDraft(d);
      setRegion(r);
      setAiConsent(settings.aiFoodParseConsent);
    })();
    return () => {
      active = false;
    };
  }, [db, entryId]);

  function onGrams(index: number, grams: number) {
    setDraft((prev) => (prev ? withItemGrams(prev, index, grams) : prev));
  }

  function onRemove(index: number) {
    setDraft((prev) => (prev ? removeDraftItem(prev, index) : prev));
  }

  function onReplace(index: number, replacement: NutritionAlternative) {
    setDraft((prev) => (prev ? withItemReplacement(prev, index, replacement) : prev));
  }

  // Manual DB search for one dish ("заменить другим") — same source as the log
  // screen: online when AI is configured AND consented, else the offline stub.
  function onSearch(query: string): Promise<NutritionAlternative[]> {
    return getFoodParser(aiConsent).searchFoods(query, region);
  }

  async function onUpdate() {
    if (!db || !draft || !entry) return;
    setBusy(true);
    try {
      await updateFoodEntry(db, entryId, { rawText: rawText.trim(), source: entry.source, draft, meal });
      router.back();
    } catch {
      setBusy(false);
    }
  }

  /// One tap: log this meal again as of NOW and return to the day list, where
  /// the fresh copy is visibly at the top — the numbers were confirmed once.
  async function onRepeat() {
    if (!db) return;
    setBusy(true);
    try {
      await repeatFoodEntry(db, entryId);
      router.back();
    } catch {
      setBusy(false);
    }
  }

  function onDelete() {
    Alert.alert(t('food.deleteTitle'), t('food.deleteConfirm'), [
      { text: t('food.deleteCancel'), style: 'cancel' },
      {
        text: t('food.delete'),
        style: 'destructive',
        onPress: () => {
          if (!db) return;
          setBusy(true);
          void (async () => {
            try {
              await deleteFoodEntry(db, entryId);
              router.back();
            } catch {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  if (missing) {
    return (
      <Screen>
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.entryGone')}</Text>
      </Screen>
    );
  }
  if (!draft) {
    return <Screen>{null}</Screen>;
  }

  return (
    <Screen>
      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('food.entryLabel')}</Text>
      <TextField value={rawText} onChangeText={setRawText} placeholder={t('food.untitled')} style={styles.titleInput} />

      <View style={styles.results}>
        {draft.items.length === 0 ? (
          <Text style={[styles.itemMacros, { color: theme.subtle }, theme.font.body]}>{t('food.entryNoItems')}</Text>
        ) : (
          draft.items.map((item, i) => (
            <ItemEditor
              key={i}
              item={item}
              onGrams={(g) => onGrams(i, g)}
              onRemove={() => onRemove(i)}
              onSearch={onSearch}
              onReplace={(alt) => onReplace(i, alt)}
            />
          ))
        )}
      </View>

      <Text style={[styles.total, { color: theme.text }, theme.font.bodySemiBold]}>
        {t('food.total')}: {draft.totals.kcal} {t('units.kcal')} · {t('macros.protein')} {draft.totals.prot}{' '}
        {t('units.g')}
      </Text>

      {/* Re-file the entry under another meal — fixes the clock's wrong guess
          (a late breakfast the day list had filed under «Обед»). */}
      {meal != null ? (
        <View style={styles.mealChips}>
          <MealChips value={meal} onChange={setMeal} />
        </View>
      ) : null}

      <PrimaryButton label={t('food.update')} onPress={onUpdate} disabled={busy} style={styles.update} />
      <Pressable
        onPress={() => void onRepeat()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('food.repeatNow')}
        style={({ pressed }) => [styles.repeatBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('food.repeatNow')}</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('food.delete')}</Text>
      </Pressable>
    </Screen>
  );
}

/// One editable dish card: live macros, a numeric grams field (the S/M/L presets
/// were dropped — an imprecise metric), a remove control, and a collapsible
/// manual DB search that swaps this dish for another the user picks.
function ItemEditor({
  item,
  onGrams,
  onRemove,
  onSearch,
  onReplace,
}: {
  item: NutritionItem;
  onGrams: (grams: number) => void;
  onRemove: () => void;
  onSearch: (query: string) => Promise<NutritionAlternative[]>;
  onReplace: (replacement: NutritionAlternative) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NutritionAlternative[] | null>(null);

  async function runSearch() {
    const q = searchText.trim();
    if (q.length === 0) return;
    setSearching(true);
    try {
      setResults(await onSearch(q));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]}>{item.name_ru}</Text>
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('food.removeItem')}
          style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="close" size={18} color={theme.subtle} />
        </Pressable>
      </View>

      <Text style={[styles.itemMacros, { color: theme.subtle }, theme.font.body]}>
        {item.scaled.kcal} {t('units.kcal')} · {t('macros.protein')} {item.scaled.prot} · {t('macros.fat')}{' '}
        {item.scaled.fat} · {t('macros.carbs')} {item.scaled.carb}
      </Text>

      <View style={styles.gramsRow}>
        <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>{t('food.grams')}</Text>
        <TextField
          value={String(Math.round(item.grams))}
          onChangeText={(v) => onGrams(toNumber(v))}
          keyboardType="numeric"
          style={styles.gramsInput}
        />
        <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
      </View>

      <Pressable onPress={() => setSearchOpen((s) => !s)} hitSlop={6} style={styles.replaceToggle}>
        <Text style={[styles.replaceToggleText, { color: theme.primary }, theme.font.body]}>
          {searchOpen ? t('food.manualSearch.hide') : t('food.replaceItem')}
        </Text>
      </Pressable>

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <View style={styles.searchRow}>
            <TextField
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={runSearch}
              placeholder={t('food.manualSearch.placeholder')}
              style={styles.searchInput}
            />
            <Pressable
              onPress={runSearch}
              disabled={searching || searchText.trim().length === 0}
              style={({ pressed }) => [
                styles.searchBtn,
                { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed || searching ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.searchBtnText, { color: theme.primary }, theme.font.body]}>
                {searching ? t('food.manualSearch.searching') : t('food.manualSearch.action')}
              </Text>
            </Pressable>
          </View>
          {results != null && results.length === 0 && !searching ? (
            <Text style={[styles.itemMacros, { color: theme.subtle }, theme.font.body]}>
              {t('food.manualSearch.empty')}
            </Text>
          ) : null}
          {(results ?? []).map((alt, j) => (
            <Pressable
              key={`${alt.name}-${j}`}
              onPress={() => {
                onReplace(alt);
                setSearchOpen(false);
                setResults(null);
                setSearchText('');
              }}
              style={({ pressed }) => [
                styles.resultRow,
                { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.resultName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                {alt.name}
              </Text>
              <Text style={[styles.itemMacros, { color: theme.subtle }, theme.font.body]}>
                {alt.per100.kcal} {t('units.kcal')} · {t('macros.protein')} {alt.per100.prot}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, marginBottom: 4 },
  titleInput: { marginBottom: 12 },
  results: { gap: 10 },
  item: {},
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemName: { flex: 1, fontSize: 15 },
  removeBtn: { padding: 2 },
  itemMacros: { fontSize: 13, marginTop: 4 },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  gramsLabel: { fontSize: 12 },
  gramsInput: { width: 64 },
  gramsUnit: { fontSize: 12 },
  replaceToggle: { marginTop: 10 },
  replaceToggleText: { fontSize: 13 },
  searchWrap: { marginTop: 8, gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1 },
  searchBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  searchBtnText: { fontSize: 13 },
  resultRow: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  resultName: { fontSize: 14 },
  total: { fontSize: 15, marginTop: 16 },
  mealChips: { marginTop: 14 },
  update: { marginTop: 16 },
  repeatBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteText: { fontSize: 15 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});
