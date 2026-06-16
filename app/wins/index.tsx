import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { Win } from '@/lib/core/db/schema';
import { addWin, listWins } from '@/lib/core/db/settings';
import { colors } from '@/lib/theme/colors';

/// Celebrate progress: log a quick win and reread past ones. Rewards are
/// feedback, not pressure — no targets and no judgment here.
export default function WinsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();

  const [items, setItems] = useState<Win[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listWins(db);
        if (active) setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onShare(message: string) {
    await Share.share({ message });
  }

  async function onAdd() {
    const message = text.trim();
    if (!db || message.length === 0) return;
    setSaving(true);
    try {
      await addWin(db, 'manual', message);
      setText('');
      setItems(await listWins(db));
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
        placeholder={t('wins.addPlaceholder')}
        placeholderTextColor={theme.subtle}
        style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border }]}
      />
      <Pressable
        onPress={onAdd}
        disabled={db == null || text.trim().length === 0 || saving}
        style={({ pressed }) => [
          styles.addBtn,
          {
            backgroundColor: theme.primary,
            opacity: db == null || text.trim().length === 0 || saving ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={styles.addText}>{t('wins.add')}</Text>
      </Pressable>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('wins.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('wins.empty')}</Text>
      ) : (
        items.map((w) => (
          <View key={w.id} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.rowBody}>
              <Text style={[styles.message, { color: theme.text }]}>{w.message}</Text>
              <Text style={[styles.date, { color: theme.subtle }]}>{formatDate(w.ts)}</Text>
            </View>
            <Pressable
              onPress={() => onShare(w.message)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingLeft: 12 })}
            >
              <Text style={[styles.share, { color: theme.primary }]}>{t('wins.share')}</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  addBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  addText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  rowBody: { flex: 1 },
  message: { fontSize: 15 },
  date: { fontSize: 12, marginTop: 4 },
  share: { fontSize: 13, fontWeight: '600' },
});
