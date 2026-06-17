import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { Win } from '@/lib/core/db/schema';
import { addWin, listWins } from '@/lib/core/db/settings';
import { useTheme } from '@/lib/theme/theme';

/// Celebrate progress: log a quick win and reread past ones. Rewards are
/// feedback, not pressure — no targets and no judgment here.
export default function WinsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
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

  const rows: RowSpec[] = (items ?? []).map((w) => ({
    key: String(w.id),
    title: w.message,
    subtitle: formatDate(w.ts),
    right: (
      <Pressable
        onPress={() => onShare(w.message)}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingLeft: 12 })}
      >
        <Text style={[styles.share, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('wins.share')}
        </Text>
      </Pressable>
    ),
  }));

  return (
    <Screen>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder={t('wins.addPlaceholder')}
        style={styles.input}
      />
      <PrimaryButton
        label={t('wins.add')}
        onPress={onAdd}
        disabled={db == null || text.trim().length === 0 || saving}
        style={styles.add}
      />

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('wins.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('wins.empty')}</Text>
      ) : (
        <View style={styles.list}>
          <ListGroup rows={rows} />
        </View>
      )}
    </Screen>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  input: { marginTop: 4, marginBottom: 12 },
  add: { marginBottom: 16 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { marginTop: 4 },
  share: { fontSize: 13 },
});
