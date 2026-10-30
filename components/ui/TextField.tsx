import { type ComponentProps } from 'react';
import { type StyleProp, StyleSheet, TextInput, type TextStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The existing native input in the shared paper/ink treatment. Font size,
/// multiline behavior and platform insets remain unchanged.
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
          backgroundColor: theme.fill,
          borderColor: theme.separator,
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
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
  },
  ios: {
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: 14 },
});
