import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/lib/theme/colors';
import { fonts } from '@/lib/theme/typography';

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
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    // Soft warm elevation from the Ember mockup.
    shadowColor: '#2A1A14',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  body: { flex: 1 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, marginTop: 3, lineHeight: 18 },
});
