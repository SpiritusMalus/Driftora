import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/lib/theme/motion';
import { useTheme } from '@/lib/theme/theme';
import { WaitScene } from './WaitScene';

/// Модальное окно ожидания разбора: сцена-виньетка в карточке по центру,
/// остальной экран притемнён (владелец, 2026-08-22: «когда считается что-то —
/// выводить окошко с нашей анимацией, остальное затемнять» — текста на экране
/// стало много, и инлайновые спиннеры в нём тонули). Рендерится ПОВЕРХ скролла
/// (absoluteFill у родителя), перехватывает касания: во время разбора все
/// кнопки и так выключены, а тап по полупустому фону во время ожидания только
/// путал бы.
export function WaitOverlay({ label }: { label: string }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Мгновенно при reduced motion; иначе короткий fade — резкое затемнение
    // всего экрана без перехода читается как сбой, не как состояние.
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity, reduced]);
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.scrim, { opacity }]}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.separator }]}>
        {/* WaitScene уже несёт кадр на миллиметровке + спиннер и подпись. */}
        <WaitScene label={label} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Один и тот же чёрный полупрозрачный скрим в обеих темах: на светлой он
  // затемняет, на тёмной — притапливает; карточка на theme.background
  // контрастна и там и там.
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 14,
  },
});
