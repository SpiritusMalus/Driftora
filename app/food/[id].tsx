import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

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
import type { MealDraft } from '@/lib/core/services/foodParser';
import { withItemGrams } from '@/lib/core/services/mealDraft';
import { resolveRegion } from '@/lib/core/services/foodParserProvider';
import { ensureSettings } from '@/lib/core/db/settings';
import { useTheme } from '@/lib/theme/theme';

function toNumber(v: string): number {
  const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/// View one logged food entry, edit each item's grams (macros rescale live),
/// re-save, or delete it. Grams editing reuses the same recompute math as the
/// log screen; provenance isn't stored, so this is portion editing, not a
/// re-parse (by design for v1).
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
  const [baseGrams, setBaseGrams] = useState<number[]>([]);
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
      const d = draftFromStoredEntry(resolveRegion(settings.region), detail.items);
      setEntry(detail.entry);
      setRawText(detail.entry.rawText);
      setDraft(d);
      setBaseGrams(d.items.map((it) => it.grams));
    })();
    return () => {
      active = false;
    };
  }, [db, entryId]);

  function onGrams(index: number, grams: number) {
    setDraft((prev) => (prev ? withItemGrams(prev, index, grams) : prev));
  }

  async function onUpdate() {
    if (!db || !draft || !entry) return;
    setBusy(true);
    try {
      await updateFoodEntry(db, entryId, { rawText: rawText.trim(), source: entry.source, draft });
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
        {draft.items.map((item, i) => {
          const base = baseGrams[i] ?? item.grams;
          const presets = [
            { label: t('food.presetLess'), grams: Math.max(5, Math.round(base * 0.6)) },
            { label: t('food.presetMid'), grams: Math.max(5, Math.round(base)) },
            { label: t('food.presetMore'), grams: Math.max(5, Math.round(base * 1.6)) },
          ];
          return (
            <Card key={i} style={styles.item}>
              <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]}>{item.name_ru}</Text>
              <Text style={[styles.itemMacros, { color: theme.subtle }, theme.font.body]}>
                {item.scaled.kcal} {t('units.kcal')} · {t('macros.protein')} {item.scaled.prot} · {t('macros.fat')}{' '}
                {item.scaled.fat} · {t('macros.carbs')} {item.scaled.carb}
              </Text>
              <View style={styles.gramsRow}>
                <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>{t('food.grams')}</Text>
                <View style={styles.presets}>
                  {presets.map((p) => {
                    const active = Math.round(item.grams) === p.grams;
                    return (
                      <Pressable
                        key={p.label}
                        onPress={() => onGrams(i, p.grams)}
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
                  onChangeText={(v) => onGrams(i, toNumber(v))}
                  keyboardType="numeric"
                  style={styles.gramsInput}
                />
                <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
              </View>
            </Card>
          );
        })}
      </View>

      <Text style={[styles.total, { color: theme.text }, theme.font.bodySemiBold]}>
        {t('food.total')}: {draft.totals.kcal} {t('units.kcal')} · {t('macros.protein')} {draft.totals.prot}{' '}
        {t('units.g')}
      </Text>

      <PrimaryButton label={t('food.update')} onPress={onUpdate} disabled={busy} style={styles.update} />
      <Pressable
        onPress={() => void onRepeat()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('food.repeatNow')}
        style={({ pressed }) => [styles.repeatBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('food.repeatNow')}
        </Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('food.delete')}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, marginBottom: 4 },
  titleInput: { marginBottom: 12 },
  results: { gap: 10 },
  item: {},
  itemName: { fontSize: 15 },
  itemMacros: { fontSize: 13, marginTop: 4 },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  gramsLabel: { fontSize: 12 },
  presets: { flexDirection: 'row', gap: 6 },
  preset: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  presetText: { fontSize: 12 },
  gramsInput: { width: 64 },
  gramsUnit: { fontSize: 12 },
  total: { fontSize: 15, marginTop: 16 },
  update: { marginTop: 16 },
  repeatBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteText: { fontSize: 15 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});
