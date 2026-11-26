import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { searchSourcesDown } from '@/lib/core/services/communityBase';
import { prioritizeExactFoodNames } from '@/lib/core/services/foodChoice';
import type { NutritionAlternative } from '@/lib/core/services/foodParser';
import { useTheme } from '@/lib/theme/theme';

type SearchResult =
  | { kind: 'loading' }
  | { kind: 'found'; items: NutritionAlternative[] }
  | { kind: 'empty' | 'unavailable' };

export function ItemReplacementDialog({
  name,
  alternatives,
  hideCalories,
  onSearch,
  onSelectAlternative,
  onReplace,
  onClose,
}: {
  name: string;
  alternatives: NutritionAlternative[];
  hideCalories: boolean;
  onSearch: (query: string) => Promise<NutritionAlternative[]>;
  onSelectAlternative: (index: number) => void;
  onReplace: (replacement: NutritionAlternative) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchResult | null>(null);
  const searchRevision = useRef(0);
  const closing = useRef(false);

  async function runSearch() {
    const text = query.trim();
    if (!text || search?.kind === 'loading') return;
    const revision = ++searchRevision.current;
    setSearch({ kind: 'loading' });
    try {
      const found = await onSearch(text);
      if (revision !== searchRevision.current) return;
      setSearch(found.length
        ? { kind: 'found', items: prioritizeExactFoodNames(text, found) }
        : { kind: searchSourcesDown() ? 'unavailable' : 'empty' });
    } catch {
      if (revision === searchRevision.current) setSearch({ kind: 'unavailable' });
    }
  }

  function close() {
    if (closing.current) return;
    closing.current = true;
    searchRevision.current++;
    Keyboard.dismiss();
    onClose();
  }

  const items = search?.kind === 'found' ? search.items : search === null ? alternatives : [];
  const loading = search?.kind === 'loading';

  return (
    <Modal animationType="slide" onRequestClose={close} hardwareAccelerated>
      <KeyboardAvoidingView
        style={[styles.page, {
          backgroundColor: theme.background,
          paddingTop: insets.top + (theme.isIOS ? 0 : 8),
          paddingBottom: theme.isIOS ? insets.bottom : 0,
        }]}
        enabled={theme.isIOS}
        behavior="padding"
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }, theme.font.heading]}>
            {t('food.replaceItem')}
          </Text>
          <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
            <Text style={[styles.cancelText, { color: theme.primary }, theme.font.bodySemiBold]}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </View>
        <Text numberOfLines={2} style={[styles.current, { color: theme.subtle }, theme.font.body]}>{name}</Text>
        <View style={styles.searchRow}>
          <TextField
            value={query}
            onChangeText={(value) => {
              searchRevision.current++;
              setQuery(value);
              setSearch(null);
            }}
            onSubmitEditing={() => void runSearch()}
            accessibilityLabel={t('food.manualSearch.placeholder')}
            placeholder={t('food.manualSearch.placeholder')}
            returnKeyType="search"
            submitBehavior="submit"
            style={styles.searchInput}
          />
          <PrimaryButton
            label={t(loading ? 'food.manualSearch.searching' : 'food.manualSearch.action')}
            onPress={() => void runSearch()}
            disabled={loading || !query.trim()}
          />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
          {search?.kind === 'empty' || search?.kind === 'unavailable' ? (
            <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: theme.subtle }, theme.font.body]}>
              {t(`food.manualSearch.${search.kind}`)}
            </Text>
          ) : null}
          {items.map((candidate, index) => (
            <Pressable
              key={`${candidate.name}-${index}`}
              accessibilityRole="button"
              onPress={() => {
                if (closing.current) return;
                close();
                if (search === null) onSelectAlternative(index);
                else onReplace(candidate);
              }}
              style={({ pressed }) => [
                styles.result,
                { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.name, { color: theme.text }, theme.font.bodySemiBold]}>{candidate.name}</Text>
              <Text style={[styles.meta, { color: theme.subtle }, theme.font.body]}>
                {hideCalories
                  ? `${t('macros.protein')} ${candidate.per100.prot} · ${t(`food.source.${candidate.per100.source}`)}`
                  : `${candidate.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${candidate.per100.prot} · ${t(`food.source.${candidate.per100.source}`)}`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 22 },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  current: { fontSize: 14, marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, minWidth: 0 },
  results: { gap: 8, paddingBottom: 16 },
  result: { gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  name: { fontSize: 15 },
  meta: { fontSize: 13 },
});
