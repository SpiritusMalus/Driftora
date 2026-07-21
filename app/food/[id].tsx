import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ItemCard } from '@/components/food/ItemCard';
import { MealChips } from '@/components/food/MealChips';
import { ApproxBadge } from '@/components/food/nutrientViews';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { needsAiConsent } from '@/lib/core/consent/consent';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  confirmFoodEntry,
  deleteFoodEntry,
  draftFromStoredEntry,
  getFoodEntry,
  repeatFoodEntry,
  updateFoodEntry,
} from '@/lib/core/db/food';
import type { FoodEntry } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { mealTypeForEntry, type MealType } from '@/lib/core/insights/mealType';
import type { MealDraft, NutritionAlternative, Region } from '@/lib/core/services/foodParser';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import {
  removeDraftItem,
  withItemAlternative,
  withItemGrams,
  withItemManualMacros,
  withItemReplacement,
} from '@/lib/core/services/mealDraft';
import { useTheme } from '@/lib/theme/theme';

/// View one logged food entry and edit it — now with the SAME dish card the log
/// screen uses (`ItemCard`): the eaten amount is the hero, weight is a one-tap
/// portion chip (or a custom field), «Другой вариант» opens a manual DB search,
/// and the × in the card header drops a dish. A stored entry keeps no parse
/// provenance, so it carries no alternatives — «Другой вариант» is a fresh DB
/// search rather than a re-run of the auto-match. Grams/replacement reuse the
/// same recompute math as the log screen.
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
  const [aiConsentVersion, setAiConsentVersion] = useState('');
  // Honour the log screen's «скрыть калории» comfort here too, so a user who
  // hid them doesn't get them back the moment they open a saved entry to edit.
  const [hideCalories, setHideCalories] = useState(false);
  const [busy, setBusy] = useState(false);
  // The update/repeat write threw — without a visible line the tap looks
  // ignored and the user leaves sure the change landed.
  const [saveIssue, setSaveIssue] = useState(false);
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
      setAiConsentVersion(settings.aiFoodParseConsentVersion);
      setHideCalories(settings.hideCalories);
      // Opening the entry IS the deferred review of an adopted (background)
      // parse — rest the «≈ проверьте» pill. Fire-and-forget: reading must not
      // wait on a write.
      if (!detail.entry.confirmed && detail.entry.parseStatus == null) void confirmFoodEntry(db, entryId);
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

  // Stored entries carry no ranked alternatives, so this never fires in practice
  // — wired only to satisfy the shared card's contract.
  function onSelectAlternative(index: number, altIndex: number) {
    setDraft((prev) => (prev ? withItemAlternative(prev, index, altIndex) : prev));
  }

  // Only reachable on a DB miss / manual / ai-estimate item; a stored dish is
  // tagged 'history', so this stays dormant here too.
  function onManualMacros(index: number, macros: { kcal: number; prot: number; fat: number; carb: number }) {
    setDraft((prev) => (prev ? withItemManualMacros(prev, index, macros) : prev));
  }

  // Manual DB search for one dish («Другой вариант») — same source as the log
  // screen: online when AI is configured AND consented AT THE CURRENT
  // disclosure version (a stale consent falls back to the offline stub, the
  // same rule the parse paths follow).
  function onSearch(query: string): Promise<NutritionAlternative[]> {
    const consentCurrent =
      aiConsent &&
      !needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion });
    return getFoodParser(consentCurrent).searchFoods(query, region);
  }

  async function onUpdate() {
    if (!db || !draft || !entry) return;
    setBusy(true);
    setSaveIssue(false);
    try {
      await updateFoodEntry(db, entryId, { rawText: rawText.trim(), source: entry.source, draft, meal });
      router.back();
    } catch {
      setBusy(false);
      setSaveIssue(true);
    }
  }

  /// One tap: log this meal again as of NOW and return to the day list, where
  /// the fresh copy is visibly at the top — the numbers were confirmed once.
  async function onRepeat() {
    if (!db) return;
    setBusy(true);
    setSaveIssue(false);
    try {
      await repeatFoodEntry(db, entryId);
      router.back();
    } catch {
      setBusy(false);
      setSaveIssue(true);
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
          <Text style={[styles.noItems, { color: theme.subtle }, theme.font.body]}>{t('food.entryNoItems')}</Text>
        ) : (
          draft.items.map((item, i) => (
            <ItemCard
              key={i}
              item={item}
              hideCalories={hideCalories}
              theme={theme}
              onGrams={(g) => onGrams(i, g)}
              onManualMacros={(m) => onManualMacros(i, m)}
              onSelectAlternative={(altIndex) => onSelectAlternative(i, altIndex)}
              onSearch={onSearch}
              onReplace={(alt) => onReplace(i, alt)}
              onRemove={() => onRemove(i)}
            />
          ))
        )}
      </View>

      {/* Meal total — the live sum being edited, so it leads big like each dish's
          eaten amount (mirrors the log screen's total hero). No micro breakdown:
          a stored entry carries no per-mineral data. */}
      {draft.items.length > 0 ? (
        <Card style={[styles.totalCard, { borderColor: theme.separator }]}>
          <Text style={[styles.totalLabel, { color: theme.subtle }, theme.font.body]}>{t('food.total')}</Text>
          <View style={styles.totalHeroRow}>
            <Text style={[styles.totalValue, { color: theme.text }, theme.font.bodySemiBold]}>
              {hideCalories ? draft.totals.prot : draft.totals.kcal}
            </Text>
            <Text style={[styles.totalUnit, { color: theme.subtle }, theme.font.body]}>
              {hideCalories
                ? `${t('macros.protein').toLowerCase()} ${t('units.g')}`
                : `${t('units.kcal')} · ${t('macros.protein')} ${draft.totals.prot} ${t('units.g')} · ${t('macros.fat')} ${draft.totals.fat} · ${t('macros.carbs')} ${draft.totals.carb}`}
            </Text>
            {draft.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
          </View>
        </Card>
      ) : null}

      {/* Re-file the entry under another meal — fixes the clock's wrong guess
          (a late breakfast the day list had filed under «Обед»). */}
      {meal != null ? (
        <View style={styles.mealChips}>
          <MealChips value={meal} onChange={setMeal} />
        </View>
      ) : null}

      <PrimaryButton label={t('food.update')} onPress={onUpdate} disabled={busy} style={styles.update} />
      {saveIssue ? (
        <Text style={[styles.saveIssue, { color: theme.primary }, theme.font.bodyMedium]}>
          {t('food.saveFailed')}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void onRepeat()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('food.repeatNow')}
        style={({ pressed }) => [styles.repeatBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.repeatText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('food.repeatNow')}</Text>
      </Pressable>
      {/* Destructive + irreversible → the quietest control on the screen: a
          hairline outline and taupe text, not the coral it used to share with
          the primary/repeat actions. */}
      <Pressable
        onPress={onDelete}
        disabled={busy}
        style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.subtle }, theme.font.body]}>{t('food.delete')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, marginBottom: 4 },
  titleInput: { marginBottom: 12 },
  // ItemCard spaces itself with its own marginBottom, so no gap here.
  results: { marginBottom: 2 },
  noItems: { fontSize: 13, marginTop: 4 },
  totalCard: { marginTop: 10, marginBottom: 4 },
  totalLabel: { fontSize: 12, marginBottom: 2 },
  totalHeroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  totalValue: { fontSize: 26 },
  totalUnit: { fontSize: 13, flexShrink: 1 },
  mealChips: { marginTop: 14 },
  update: { marginTop: 16 },
  saveIssue: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  repeatBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  repeatText: { fontSize: 15 },
  deleteBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteText: { fontSize: 14 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});
