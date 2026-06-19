import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useTheme } from '@/lib/theme/theme';

/// Reusable just-in-time consent dialog (TASK §B/§C). A centered card with a
/// title, an explanatory body, a primary confirm and a plain decline. Used for
/// both the food→AI text consent and the stronger photo→AI warning — the copy
/// (provider, country, what is / isn't sent) is passed in from i18n, never
/// hard-coded here.
export function ConsentModal({
  visible,
  title,
  body,
  confirmLabel,
  declineLabel,
  declineCaption,
  onConfirm,
  onDecline,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  declineLabel: string;
  declineCaption?: string;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.separator }]}>
          <Text style={[styles.title, { color: theme.text }, theme.font.heading]}>{title}</Text>
          <Text style={[styles.body, { color: theme.text }, theme.font.body]}>{body}</Text>

          <PrimaryButton label={confirmLabel} onPress={onConfirm} style={styles.confirm} />

          <Pressable onPress={onDecline} accessibilityRole="button" style={({ pressed }) => [styles.decline, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.declineText, { color: theme.primary }, theme.font.bodySemiBold]}>{declineLabel}</Text>
          </Pressable>
          {declineCaption ? (
            <Text style={[styles.caption, { color: theme.subtle }, theme.font.body]}>{declineCaption}</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
  },
  title: { fontSize: 18, marginBottom: 10, lineHeight: 24 },
  body: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
  confirm: { marginBottom: 4 },
  decline: { paddingVertical: 12, alignItems: 'center' },
  declineText: { fontSize: 15 },
  caption: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
