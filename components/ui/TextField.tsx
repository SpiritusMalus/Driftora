import { type ComponentProps } from 'react';
import { type StyleProp, StyleSheet, TextInput, type TextStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A themed text input. Android draws a warm-bordered white field (radius 10);
/// iOS draws a flat grouped-card field (radius 18, no border). Both use 17px
/// system/Manrope body text, matching the Ember handoff.
export function TextField({
  style,
  multiline,
  ...props
}: ComponentProps<typeof TextInput> & { style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.subtle}
      multiline={multiline}
      style={[
        theme.isIOS ? styles.ios : styles.android,
        {
          color: theme.text,
          backgroundColor: theme.card,
          borderColor: theme.cardBorder,
        },
        theme.font.body,
        multiline && styles.multiline,
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  android: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
  },
  ios: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: 14 },
});
