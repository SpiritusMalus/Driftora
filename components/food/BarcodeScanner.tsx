import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/**
 * СКАНЕР ШТРИХКОДА — отдельный способ ввода, а не побочный эффект фотографии.
 *
 * Отдельный он потому, что съёмка тут другая: камера смотрит на упаковку, а не
 * на тарелку, кадр держат близко и ровно, и система заранее знает, что ищет.
 * Рамка — не украшение: декодер возвращает координаты найденного кода, и код за
 * пределами рамки игнорируется, иначе на полке магазина в кадр попадёт соседний
 * товар и мы молча запишем не то.
 *
 * ЧТО ЗДЕСЬ НЕ ПРОИСХОДИТ. Кадры никуда не уходят: распознавание делает сам
 * телефон (на Android — ML Kit, на iOS — AVFoundation), наружу летят только 13
 * цифр. Фотография не сохраняется и не отправляется — этот экран вообще не
 * умеет делать снимки. И модель здесь не участвует: код опознаёт товар точно,
 * поэтому разбор из квоты не тратится.
 *
 * ПОЧЕМУ КОД МОЖНО ДОВЕРЯТЬ. Последняя цифра EAN-13 — контрольная, декодер
 * проверяет её сам, а сервер проверяет ещё раз. Искажённое считывание
 * отбрасывается вместо того, чтобы превратиться в чужой продукт: это то, чего
 * не даёт распознавание цифр глазами модели.
 */

/** Символики, которые реально встречаются на еде. QR и прочее не нужны. */
const FOOD_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/** Пауза после успешного кода — иначе один и тот же код сработает десятки раз. */
const RESCAN_PAUSE_MS = 2000;

export function BarcodeScanner({
  onCode,
  busy,
  status,
}: {
  /** Найденный код (уже отфильтрованный по рамке). */
  onCode: (code: string) => void;
  /** Идёт поиск по коду — камера продолжает работать, но новые коды не берём. */
  busy: boolean;
  /** Подпись под рамкой: подсказка, «ищу…», или honest-объяснение промаха. */
  status?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [torch, setTorch] = useState(false);
  /// Момент последнего принятого кода — окно тишины после попадания.
  const acceptedAt = useRef(0);

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      const now = Date.now();
      if (busy || now - acceptedAt.current < RESCAN_PAUSE_MS) return;
      if (!insideReticle(result, frame)) return;
      acceptedAt.current = now;
      // Короткий отклик в руку: глаза заняты упаковкой, а не экраном.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onCode(result.data);
    },
    [busy, frame, onCode],
  );

  if (!permission) {
    return <View style={[styles.placeholder, { backgroundColor: theme.card, borderColor: theme.separator }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.card, borderColor: theme.separator }]}>
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.barcode.permission')}</Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={({ pressed }) => [
            styles.permissionBtn,
            { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.permissionText, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('food.barcode.allow')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.viewport, { borderColor: theme.separator }]}
        onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...FOOD_BARCODES] }}
          onBarcodeScanned={onScanned}
        />
        {/* Затемнение вокруг рамки: четыре полосы вместо одной маски —
            прозрачную «дырку» в React Native иначе не сделать. */}
        <View style={[styles.shade, styles.shadeTop]} pointerEvents="none" />
        <View style={[styles.shade, styles.shadeBottom]} pointerEvents="none" />
        <View style={[styles.shade, styles.shadeLeft]} pointerEvents="none" />
        <View style={[styles.shade, styles.shadeRight]} pointerEvents="none" />
        {/* Сама рамка — широкая и низкая, под пропорции штрихкода. */}
        <View style={[styles.reticle, { borderColor: busy ? theme.primary : '#ffffff' }]} pointerEvents="none">
          {busy ? <ActivityIndicator color={theme.primary} /> : null}
        </View>
        <Pressable
          onPress={() => setTorch((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('food.barcode.torch')}
          style={({ pressed }) => [styles.torch, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={styles.torchIcon}>{torch ? '🔦' : '💡'}</Text>
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
        {status ?? t('food.barcode.hint')}
      </Text>
    </View>
  );
}

/** Доли кадра, которые занимает рамка (см. стили — держим в одном месте). */
const RETICLE = { left: 0.08, right: 0.92, top: 0.3, bottom: 0.7 };

/**
 * Код попал В РАМКУ. Декодер возвращает углы найденного кода (`cornerPoints`) в
 * координатах кадра; берём его центр и требуем, чтобы он лежал внутри рамки с
 * небольшим запасом. Без этой проверки рамка была бы просто рисунком, а на полке
 * магазина в кадр попадает и соседний товар.
 *
 * Если координат нет (некоторые платформы их не дают), код принимается: лучше
 * сработать, чем не сработать вовсе — человек и так целится рамкой.
 */
function insideReticle(result: BarcodeScanningResult, frame: { width: number; height: number }): boolean {
  const points = result.cornerPoints;
  if (!points || points.length === 0 || frame.width === 0 || frame.height === 0) return true;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const slack = 0.06;
  return (
    cx >= (RETICLE.left - slack) * frame.width &&
    cx <= (RETICLE.right + slack) * frame.width &&
    cy >= (RETICLE.top - slack) * frame.height &&
    cy <= (RETICLE.bottom + slack) * frame.height
  );
}

const SHADE = 'rgba(0, 0, 0, 0.55)';

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  viewport: { height: 260, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  placeholder: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  // Затемнение вокруг рамки — в тех же долях, что и RETICLE выше.
  shade: { position: 'absolute', backgroundColor: SHADE },
  shadeTop: { left: 0, right: 0, top: 0, height: '30%' },
  shadeBottom: { left: 0, right: 0, bottom: 0, height: '30%' },
  shadeLeft: { left: 0, top: '30%', bottom: '30%', width: '8%' },
  shadeRight: { right: 0, top: '30%', bottom: '30%', width: '8%' },
  reticle: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '30%',
    bottom: '30%',
    borderWidth: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  torch: { position: 'absolute', right: 10, top: 10, padding: 6 },
  torchIcon: { fontSize: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  permissionBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  permissionText: { fontSize: 13 },
});
