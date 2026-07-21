import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { ApproxBadge, NutrientDetail } from '@/components/food/nutrientViews';
import { normalizeChoiceName } from '@/lib/core/services/foodChoice';
import type { NutritionAlternative, NutritionItem } from '@/lib/core/services/foodParser';
import { type Theme } from '@/lib/theme/theme';

export function ItemCard({
  item,
  hideCalories,
  theme,
  onGrams,
  onManualMacros,
  onSelectAlternative,
  onSearch,
  onReplace,
  onRemove,
}: {
  item: NutritionItem;
  hideCalories: boolean;
  theme: Theme;
  onGrams: (grams: number) => void;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
  onSelectAlternative: (altIndex: number) => void;
  onSearch: (query: string) => Promise<NutritionAlternative[]>;
  onReplace: (replacement: NutritionAlternative) => void;
  // Drop this dish: on the edit screen — from the saved entry; on the log
  // screen — from the fresh parse draft (device feedback 2026-07-20:
  // «добавил лишнее и удалить нельзя»). The × shows only when passed.
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  // The card title = what the user logged (or the DB name after an explicit
  // re-pick). The matched DB row, when it differs, is shown on the «Как в базе»
  // line below — not crammed into the title in parens (which read as «молоко
  // 1.8% (молоко 3.2%)» → «почему 3.2%?»).
  const titleName = item.userChosen && item.matched_name ? item.matched_name : item.name_ru;
  // TRANSPARENCY: which DB row the numbers actually describe — shown on its own
  // «Как в базе: …» line whenever it differs from the title the user sees. We
  // deliberately DON'T suppress it just because it looks like a translation of
  // the input (the old `!== name_en` check hid «Protein Pudding» for a typed
  // «протеиновый пудинг» — so the card echoed the user's own words back and gave
  // no evidence of WHAT it matched, device report 2026-07-15 «непонятно что
  // выдал»). Only an exact repeat of the title is dropped. The row name usually
  // carries the preparation/brand, so the user can judge the baseline instead of
  // guessing; to change it they pick another match or re-parse a clearer query.
  const matchedLabel =
    item.matched_name && normalizeChoiceName(item.matched_name) !== normalizeChoiceName(titleName)
      ? item.matched_name
      : null;
  // The "per 100 g · <source>" line shows the DB row itself (the footnote's promise).
  const dbPer100 = item.per100;
  // A full DB miss: the resolver's coarse placeholder. We show NO fabricated
  // numbers for it — only an honest "not in our database" + manual entry.
  const isMiss = item.per100.source === 'estimate';
  // Other DB matches the user can switch to. Low confidence in the auto-pick
  // opens the list proactively; otherwise it hides behind a "не то?" toggle.
  const alternatives = item.alternatives ?? [];
  // REFEREE signal: the server only injects an `ai_estimate` alternative when a
  // DB match grossly contradicted the model's expectation for this food (a
  // likely wrong-product match, e.g. «мясное рагу» → pure «Beef, stew meat»).
  // We warn and open the picker so the inflated numbers aren't taken at face value.
  const refereeFlagged = alternatives.some((a) => a.per100.source === 'ai_estimate');
  // ONE «Другой вариант» disclosure unifies the DB alternatives AND manual search
  // (they both answer «take a different product»). Opens itself when the auto-pick
  // is shaky (low confidence or a referee flag) so the choice isn't buried.
  const [otherOpen, setOtherOpen] = useState(item.confidence < 0.5 || refereeFlagged);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NutritionAlternative[] | null>(null);
  const grams = Math.round(item.grams);
  const PORTIONS = [100, 200, 250];

  async function runSearch() {
    const q = searchText.trim();
    if (q.length === 0) return;
    setSearching(true);
    try {
      setSearchResults(await onSearch(q));
    } finally {
      setSearching(false);
    }
  }

  // The eaten total is the HERO — it's what the user is logging. Per-100g and the
  // source drop to a small grey line; the DB match, alternatives and manual search
  // collapse under one «Другой вариант». Honesty (source, «≈», wrong-product note)
  // stays, only quieter.
  const sourceInLine =
    item.per100.source === 'ai_estimate' || item.per100.source === 'manual'
      ? '' // already shown as the header badge — no need to repeat
      : ` · ${t(`food.source.${item.per100.source}`)}`;
  const per100Line = hideCalories
    ? `${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`
    : `${dbPer100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`;

  return (
    <Card style={styles.item}>
      {/* Header: what the user logged + one estimate/manual flag (DB source is
          quieter, on the grey line below). */}
      <View style={styles.itemHead}>
        <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]} numberOfLines={2}>
          {titleName}
        </Text>
        {item.per100.source === 'ai_estimate' || item.per100.source === 'manual' ? (
          <View style={[styles.badge, { borderColor: theme.primary }]}>
            <Text style={[styles.badgeText, { color: theme.primary }, theme.font.body]}>
              {t(`food.source.${item.per100.source}`)}
            </Text>
          </View>
        ) : null}
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('food.removeItem')}
            style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="close" size={18} color={theme.subtle} />
          </Pressable>
        ) : null}
      </View>

      {isMiss ? (
        <Text style={[styles.notInDb, { color: theme.subtle }, theme.font.body]}>{t('food.notInDb')}</Text>
      ) : (
        <>
          {/* HERO — the eaten amount, big and first. */}
          <View style={styles.heroRow}>
            <Text style={[styles.heroValue, { color: theme.text }, theme.font.bodySemiBold]}>
              {hideCalories ? item.scaled.prot : item.scaled.kcal}
            </Text>
            <Text style={[styles.heroUnit, { color: theme.subtle }, theme.font.body]}>
              {hideCalories
                ? `${t('macros.protein').toLowerCase()} · ${t('food.forGrams', { grams })}`
                : `${t('units.kcal')} · ${t('food.forGrams', { grams })} · ${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`}
            </Text>
            {item.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
          </View>

          {/* Provenance: WHAT DB row the numbers came from + its source, on its
              own labelled line so «непонятно что выдал» can't happen — the user
              sees the actual matched entry, not just their own words echoed. */}
          {matchedLabel ? (
            <Text style={[styles.matchedLine, { color: theme.subtle }, theme.font.body]}>
              {t('food.matchedAs', { name: matchedLabel })}
              {sourceInLine}
            </Text>
          ) : null}
          {/* Secondary grey line: the per-100g baseline (+ source when no matched
              line above already carries it). */}
          <Text style={[styles.per100Line, { color: theme.subtle }, theme.font.body]}>
            {t('food.per100')} {per100Line}
            {matchedLabel ? '' : sourceInLine}
          </Text>

          {/* Full micro breakdown, collapsed. */}
          <NutrientDetail values={item.scaled} caption={t('food.detail.basis', { grams })} theme={theme} />

          {/* HONESTY notes — only when they apply. */}
          {item.dry_basis ? (
            <View style={[styles.dryBasisNote, { borderColor: theme.primary, backgroundColor: theme.card }]}>
              <Text style={[styles.dryBasisText, { color: theme.text }, theme.font.body]}>{t('food.dryBasis')}</Text>
            </View>
          ) : null}
          {refereeFlagged ? (
            <View style={[styles.dryBasisNote, { borderColor: theme.primary, backgroundColor: theme.card }]}>
              <Text style={[styles.dryBasisText, { color: theme.text }, theme.font.body]}>
                {t('food.refereeMismatch')}
              </Text>
            </View>
          ) : null}
        </>
      )}

      {/* Manual per-100g entry — on a DB miss (enter real numbers) and over an AI
          estimate (correct the guess → source flips to honest 'manual'). */}
      {isMiss || item.per100.source === 'manual' || item.per100.source === 'ai_estimate' ? (
        <ManualMacros item={item} isMiss={isMiss} theme={theme} onManualMacros={onManualMacros} />
      ) : null}

      {/* WEIGHT — the main thing users adjust. When the weight was GUESSED (not
          given), say so prominently right above the chips: the assumed grams
          drive the whole number, and a 10px italic footnote was too easy to miss
          (device report 2026-07-15). Tapping a chip / editing confirms the
          weight → grams_source flips to 'confirmed' and this note disappears. */}
      {item.grams_source === 'estimated' ? (
        <View style={[styles.gramsGuessNote, { borderColor: theme.primary, backgroundColor: theme.card }]}>
          <Text style={[styles.gramsGuessText, { color: theme.text }, theme.font.body]}>
            {t('food.gramsGuessed', { grams })}
          </Text>
        </View>
      ) : null}
      {/* Quick-set chips + a custom field. */}
      <View style={styles.portionRow}>
        {PORTIONS.map((p) => {
          const active = grams === p;
          return (
            <Pressable
              key={p}
              onPress={() => onGrams(p)}
              style={({ pressed }) => [
                styles.portionChip,
                {
                  borderColor: active ? theme.primary : theme.separator,
                  backgroundColor: theme.card,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[styles.portionChipText, { color: active ? theme.primary : theme.subtle }, theme.font.body]}
              >
                {p} {t('units.g')}
              </Text>
            </Pressable>
          );
        })}
        <TextField
          value={String(grams)}
          onChangeText={(v) => onGrams(toNumber(v))}
          keyboardType="numeric"
          style={styles.gramsInput}
        />
        <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
      </View>

      {/* ONE «Другой вариант» — DB alternatives (from the parse) AND manual search
          in the same disclosure. Opens itself on a shaky auto-pick. */}
      <View style={styles.altWrap}>
        <Pressable onPress={() => setOtherOpen((s) => !s)} hitSlop={6}>
          <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
            {otherOpen
              ? t('food.otherOption.hide')
              : alternatives.length > 0
                ? t('food.otherOption.openCount', { count: alternatives.length })
                : t('food.otherOption.open')}
          </Text>
        </Pressable>
        {otherOpen ? (
          <View style={styles.altList}>
            {alternatives.map((alt, j) => (
              <Pressable
                key={`a-${alt.name}-${j}`}
                onPress={() => onSelectAlternative(j)}
                style={({ pressed }) => [
                  styles.altRow,
                  { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.altName, { color: theme.text }, theme.font.body]} numberOfLines={2}>
                  {alt.name}
                </Text>
                <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                  {hideCalories
                    ? `${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`
                    : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`}
                </Text>
              </Pressable>
            ))}
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
                <Text style={[styles.cookChipText, { color: theme.primary }, theme.font.body]}>
                  {searching ? t('food.manualSearch.searching') : t('food.manualSearch.action')}
                </Text>
              </Pressable>
            </View>
            {searchResults != null && searchResults.length === 0 && !searching ? (
              <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                {t('food.manualSearch.empty')}
              </Text>
            ) : null}
            {(searchResults ?? []).map((alt, j) => (
              <Pressable
                key={`s-${alt.name}-${j}`}
                onPress={() => {
                  onReplace(alt);
                  setOtherOpen(false);
                  setSearchResults(null);
                  setSearchText('');
                }}
                style={({ pressed }) => [
                  styles.altRow,
                  { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.altName, { color: theme.text }, theme.font.body]} numberOfLines={2}>
                  {alt.name}
                </Text>
                <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                  {hideCalories
                    ? `${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`
                    : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/// Per-100g macro entry for a DB miss (and editing it afterwards). Keeps its own
/// input strings so partial typing isn't clobbered by re-renders; every change
/// pushes the parsed macros up via `onManualMacros` (→ source becomes 'manual').
function ManualMacros({
  item,
  isMiss,
  theme,
  onManualMacros,
}: {
  item: NutritionItem;
  isMiss: boolean;
  theme: Theme;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
}) {
  const { t } = useTranslation();
  // Seed from the current per100 when the user is editing already-entered manual
  // macros; blank on a fresh miss so nothing fabricated is shown.
  const init = (n: number) => (isMiss ? '' : String(n));
  const [kcal, setKcal] = useState(init(item.per100.kcal));
  const [prot, setProt] = useState(init(item.per100.prot));
  const [fat, setFat] = useState(init(item.per100.fat));
  const [carb, setCarb] = useState(init(item.per100.carb));

  function push(next: { kcal: string; prot: string; fat: string; carb: string }) {
    onManualMacros({
      kcal: toNumber(next.kcal),
      prot: toNumber(next.prot),
      fat: toNumber(next.fat),
      carb: toNumber(next.carb),
    });
  }

  const fields: { key: 'kcal' | 'prot' | 'fat' | 'carb'; label: string; value: string; set: (v: string) => void }[] = [
    { key: 'kcal', label: t('units.kcal'), value: kcal, set: setKcal },
    { key: 'prot', label: t('macros.protein'), value: prot, set: setProt },
    { key: 'fat', label: t('macros.fat'), value: fat, set: setFat },
    { key: 'carb', label: t('macros.carbs'), value: carb, set: setCarb },
  ];

  return (
    <View style={styles.manualWrap}>
      <Text style={[styles.manualLabel, { color: theme.subtle }, theme.font.body]}>{t('food.enterMacros')}</Text>
      <View style={styles.manualRow}>
        {fields.map((f) => (
          <View key={f.key} style={styles.manualField}>
            <Text style={[styles.manualFieldLabel, { color: theme.subtle }, theme.font.body]}>{f.label}</Text>
            <TextField
              value={f.value}
              onChangeText={(v) => {
                f.set(v);
                push({ kcal, prot, fat, carb, [f.key]: v });
              }}
              keyboardType="numeric"
              // An em-dash, not «0»: four zeros in a row read as pre-filled
              // data («болванки»), while a dash reads as awaiting input.
              placeholder="—"
              style={styles.manualInput}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const styles = StyleSheet.create({
  item: { marginBottom: 10 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  itemName: { fontSize: 15, flex: 1 },
  removeBtn: { padding: 2 },
  // HERO: the eaten amount — big number + small unit, first thing in the card.
  heroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  heroValue: { fontSize: 26 },
  heroUnit: { fontSize: 13, flexShrink: 1 },
  // Quiet secondary: matched DB row (provenance) + per-100g baseline + source.
  matchedLine: { fontSize: 12, marginBottom: 2, lineHeight: 17 },
  per100Line: { fontSize: 12, marginBottom: 2, lineHeight: 17 },
  // Prominent «weight was guessed» note — a bordered box above the chips, not a
  // tiny footnote, because the assumed grams drive the whole number.
  gramsGuessNote: { marginTop: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  gramsGuessText: { fontSize: 12, lineHeight: 17 },
  // Quick-set weight chips.
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  portionChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  portionChipText: { fontSize: 13 },
  dryBasisNote: { marginTop: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  dryBasisText: { fontSize: 12, lineHeight: 17 },
  cookChipText: { fontSize: 12 },
  notInDb: { fontSize: 13, marginBottom: 6, lineHeight: 18 },
  manualWrap: { marginTop: 4, marginBottom: 4 },
  manualLabel: { fontSize: 12, marginBottom: 6 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualField: { flex: 1 },
  manualFieldLabel: { fontSize: 11, marginBottom: 2 },
  manualInput: { textAlign: 'center' },
  gramsInput: { width: 64, paddingVertical: 8, fontSize: 14, textAlign: 'center' },
  gramsUnit: { fontSize: 12 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11 },
  altWrap: { marginTop: 8 },
  altToggle: { fontSize: 13 },
  altList: { gap: 6, marginTop: 6 },
  // Name on its own line, macros beneath — a side-by-side row let the long
  // «… ккал · Белок … · по базе FatSecret» string squeeze the name down to
  // «Rice C…» (device report 2026-07-18). Stacked, the name gets the full width.
  altRow: { gap: 2, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  altName: { fontSize: 13 },
  altMacros: { fontSize: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1 },
  searchBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
});
