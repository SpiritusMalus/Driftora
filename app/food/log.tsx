import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { saveParsedEntry, todayMacroTotals } from '@/lib/core/db/food';
import { ensureSettings } from '@/lib/core/db/settings';
import { proteinInsight } from '@/lib/core/insights/proteinInsight';
import type { FoodParseResult, ParsedFoodItem } from '@/lib/core/services/foodParser';
import { getFoodParser } from '@/lib/core/services/foodParserProvider';
import { colors, type ThemeColors } from '@/lib/theme/colors';

interface MacroLabels {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
}

/// Text → parse (offline stub) → editable confirm list → save.
export default function FoodLogScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const router = useRouter();
  const db = useDatabase();

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<FoodParseResult | null>(null);
  // Today's protein-so-far + personal target, for the honest "what it means"
  // line shown once a meal is parsed (the meaning-rules library).
  const [proteinTarget, setProteinTarget] = useState(0);
  const [todayProteinG, setTodayProteinG] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      const [settings, totals] = await Promise.all([ensureSettings(db), todayMacroTotals(db)]);
      if (!active) return;
      setProteinTarget(settings.targetProteinG);
      setTodayProteinG(totals.proteinG);
    })();
    return () => {
      active = false;
    };
  }, [db]);

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
      await saveParsedEntry(db, { rawText: text, source: 'text', result });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t('food.inputPlaceholder')}
        placeholderTextColor={theme.subtle}
        multiline
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
        ]}
      />
      <PrimaryButton
        label={parsing ? t('food.parsing') : t('food.parse')}
        onPress={onParse}
        disabled={parsing || text.trim().length === 0}
        theme={theme}
      />

      {result == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('food.empty')}</Text>
      ) : result.items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('food.needHelp')}</Text>
      ) : (
        <View style={styles.results}>
          {result.items.map((item, i) => (
            <ItemEditor
              key={i}
              item={item}
              labels={labels}
              theme={theme}
              onChange={(p) => patchItem(i, p)}
            />
          ))}
          <View style={[styles.totalRow, { borderColor: theme.border }]}>
            <Text style={[styles.totalLabel, { color: theme.text }]}>{t('food.total')}</Text>
            <Text style={[styles.totalValue, { color: theme.text }]}>
              {result.kcal} {labels.kcal} · {labels.protein} {result.proteinG} {t('units.g')}
            </Text>
          </View>
          {proteinTarget > 0 ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }]}>
              {proteinInsight(todayProteinG + result.proteinG, proteinTarget)}
            </Text>
          ) : null}
          <Text style={[styles.stubNote, { color: theme.subtle }]}>{t('food.stubNote')}</Text>
          <PrimaryButton
            label={saving ? t('food.saving') : t('food.save')}
            onPress={onSave}
            disabled={saving || db == null}
            theme={theme}
          />
          {db == null ? (
            <Text style={[styles.hint, { color: theme.subtle }]}>{t('food.dbUnavailable')}</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function ItemEditor({
  item,
  labels,
  theme,
  onChange,
}: {
  item: ParsedFoodItem;
  labels: MacroLabels;
  theme: ThemeColors;
  onChange: (patch: Partial<ParsedFoodItem>) => void;
}) {
  return (
    <View style={[styles.item, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <TextInput
        value={item.name}
        onChangeText={(v) => onChange({ name: v })}
        style={[styles.itemName, { color: theme.text }]}
      />
      <View style={styles.macroRow}>
        <MacroField label={labels.kcal} value={item.kcal} theme={theme} onChange={(n) => onChange({ kcal: n })} />
        <MacroField label={labels.protein} value={item.proteinG} theme={theme} onChange={(n) => onChange({ proteinG: n })} />
        <MacroField label={labels.fat} value={item.fatG} theme={theme} onChange={(n) => onChange({ fatG: n })} />
        <MacroField label={labels.carbs} value={item.carbG} theme={theme} onChange={(n) => onChange({ carbG: n })} />
      </View>
      {item.assumptions ? (
        <Text style={[styles.assumptions, { color: theme.subtle }]}>{item.assumptions}</Text>
      ) : null}
    </View>
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
  theme: ThemeColors;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.macroField}>
      <Text style={[styles.macroLabel, { color: theme.subtle }]}>{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={(v) => onChange(toNumber(v))}
        keyboardType="numeric"
        style={[styles.macroInput, { color: theme.text, borderColor: theme.border }]}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  theme,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.primary, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
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
  content: { padding: 16 },
  input: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  item: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 10,
  },
  itemName: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macroField: { flex: 1 },
  macroLabel: { fontSize: 11, marginBottom: 2 },
  macroInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
  },
  assumptions: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  totalLabel: { fontSize: 15, fontWeight: '600' },
  totalValue: { fontSize: 14 },
  stubNote: { fontSize: 11, fontStyle: 'italic', marginBottom: 12 },
  proteinNote: { fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
});
