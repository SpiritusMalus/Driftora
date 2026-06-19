import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { legalDocText, type LegalDoc } from '@/lib/legal/documents';
import { useTheme } from '@/lib/theme/theme';

import { Markdown } from './Markdown';

/// In-app reader for a bundled legal document (Terms / Privacy). A full-screen
/// modal so it can open over the blocking offer gate (TASK §A) and from
/// Settings rows (§D). Read-only — accepting happens on the gate, not here.
export function LegalReader({
  doc,
  visible,
  onClose,
}: {
  doc: LegalDoc | null;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const title = doc === 'terms' ? t('legal.terms') : t('legal.privacy');

  return (
    <Modal visible={visible && doc != null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.text }, theme.font.heading]}>
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.close, { color: theme.primary }, theme.font.bodySemiBold]}>
              {t('legal.close')}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator
        >
          {doc != null ? <Markdown source={legalDocText(doc)} /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, flex: 1, paddingRight: 12 },
  close: { fontSize: 16 },
  content: { paddingHorizontal: 18, paddingTop: 12 },
});
