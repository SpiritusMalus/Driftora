import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/lib/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/// A dashboard section tile. Tappable when [onPress] is provided.
export function SectionCard({
  icon,
  title,
  subtitle,
  theme,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  theme: ThemeColors;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: theme.iconBg }]}>
        <Ionicons name={icon} size={22} color={theme.icon} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.subtle }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.subtle} />
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  body: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13, marginTop: 2 },
});
