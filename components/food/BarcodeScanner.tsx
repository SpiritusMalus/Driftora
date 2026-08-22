import { useIsFocused } from '@react-navigation/native';
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
 * АКЦЕНТ ВСЕГДА НА ТОМ, ЧТО СЕЙЧАС ДЕЛАЕТ ЧЕЛОВЕК. Пока он целится — ярко
 * только окно рамки, всё вокруг притемнено. Как только код найден, целиться уже
 * не нужно: превью гаснет целиком, а вперёд выходит карточка результата с
 * ответом и следующим шагом. Экран в каждый момент показывает ОДНУ вещь, ради
 * которой он открыт.
 *
 * ЧЕЛОВЕК НИЧЕГО НЕ ДОДЕЛЫВАЕТ ЗА НАС. Если у кода нет состава, сервер сам
 * доискивает его по названию товара, а в крайнем случае берёт честно помеченную
 * оценку — просьбы «сфотографируйте этикетку» здесь нет и быть не должно
 * (владелец, 2026-08-22: «никто не будет сидеть отфоткивать что-то
 * дополнительно»). Единственный тупик — код, которого не знает вообще никто; там
 * мы просто говорим об этом и продолжаем сканировать.
 *
 * ЧТО ЗДЕСЬ НЕ ПРОИСХОДИТ. Кадры никуда не уходят: распознавание делает сам
 * телефон (на Android — ML Kit, на iOS — AVFoundation), наружу летят только
 * цифры кода. Фотография не сохраняется и не отправляется — этот экран вообще
 * не умеет делать снимки. И модель здесь не участвует: код опознаёт товар
 * точно, поэтому разбор из квоты не тратится.
 *
 * ПОЧЕМУ КОДУ МОЖНО ДОВЕРЯТЬ. Последняя цифра EAN-13 — контрольная, декодер
 * проверяет её сам, а сервер проверяет ещё раз. Искажённое считывание
 * отбрасывается вместо того, чтобы превратиться в чужой продукт: это то, чего
 * не даёт распознавание цифр глазами модели.
 */

/** Символики, которые реально встречаются на еде. QR и прочее не нужны. */
const FOOD_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/** Пауза после принятого кода — иначе один и тот же код сработает десятки раз. */
const RESCAN_PAUSE_MS = 2000;

/**
 * Рамка в долях кадра — ЕДИНСТВЕННЫЙ источник правды. И стили, и проверка
 * попадания считаются отсюда: если развести их по разным местам, нарисованная
 * рамка и та, по которой фильтруется код, однажды разъедутся молча.
 */
const RETICLE = { left: 0.08, right: 0.92, top: 0.3, bottom: 0.7 };
/** Запас вокруг рамки: человек целится рукой, а не микрометром. */
const RETICLE_SLACK = 0.06;

const pct = (v: number): `${number}%` => `${Math.round(v * 100)}%`;

/** Чем закончился поиск по коду — карточка поверх превью объясняет каждый исход. */
export type BarcodeOutcome =
  | { kind: 'found'; name: string; kcal: number }
  /** Товар опознан, но состава не нашлось нигде (и оценку взять не вышло —
   *  например, кончился дневной запас разборов). Говорить «код неизвестен»
   *  здесь было бы неправдой: мы знаем, ЧТО это. */
  | { kind: 'identified'; name: string }
  /** Кода не знает вообще никто — единственный настоящий тупик. */
  | { kind: 'missing' }
  /** Источник не ответил — это НЕ «такого продукта не существует». */
  | { kind: 'unavailable' };

export function BarcodeScanner({
  onCode,
  busy,
  outcome,
  onDismiss,
}: {
  /** Найденный код (уже отфильтрованный по рамке). */
  onCode: (code: string) => void;
  /** Идёт поиск по коду. */
  busy: boolean;
  /** Итог последнего кода; пока он на экране, новые коды не принимаются. */
  outcome: BarcodeOutcome | null;
  /** Убрать карточку и снова целиться. */
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [torch, setTorch] = useState(false);
  /// Экран ушёл в фон или его закрыли — камеру надо гасить, а не держать
  /// включённой за спиной: это и батарея, и горящий индикатор камеры.
  const focused = useIsFocused();
  /// Момент последнего принятого кода — окно тишины после попадания.
  const acceptedAt = useRef(0);

  const onScanned = useCallback(
    (result: BarcodeScanningResult) => {
      const now = Date.now();
      if (busy || outcome || now - acceptedAt.current < RESCAN_PAUSE_MS) return;
      if (!insideReticle(result, frame)) return;
      acceptedAt.current = now;
      // Короткий отклик в руку: глаза заняты упаковкой, а не экраном.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onCode(result.data);
    },
    [busy, outcome, frame, onCode],
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
          style={({ pressed }) => [styles.permissionBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
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
        {focused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: [...FOOD_BARCODES] }}
            onBarcodeScanned={onScanned}
          />
        ) : null}

        {/* ПРИЦЕЛИВАНИЕ. Ярко только окно рамки; четыре полосы вокруг вместо
            одной маски — прозрачную «дырку» в React Native иначе не вырезать. */}
        {!outcome ? (
          <>
            <View style={[styles.shade, shadeTop]} pointerEvents="none" />
            <View style={[styles.shade, shadeBottom]} pointerEvents="none" />
            <View style={[styles.shade, shadeLeft]} pointerEvents="none" />
            <View style={[styles.shade, shadeRight]} pointerEvents="none" />
            <View style={[styles.reticle, reticleBox, { borderColor: busy ? theme.primary : '#ffffff' }]} pointerEvents="none">
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
          </>
        ) : (
          /* РЕЗУЛЬТАТ. Целиться больше не нужно — гасим превью целиком и
             оставляем на виду только ответ и следующий шаг. */
          <View style={styles.resultScrim}>
            <View style={[styles.resultCard, { backgroundColor: theme.background, borderColor: theme.separator }]}>
              <Text style={[styles.resultTitle, { color: theme.text }, theme.font.bodySemiBold]} numberOfLines={3}>
                {outcome.kind === 'found' || outcome.kind === 'identified'
                  ? outcome.name
                  : t(`food.barcode.${outcome.kind}`)}
              </Text>
              {outcome.kind === 'found' ? (
                <Text style={[styles.resultSub, { color: theme.subtle }, theme.font.body]}>
                  {t('food.barcode.addedSub', { kcal: outcome.kcal })}
                </Text>
              ) : outcome.kind === 'identified' ? (
                <Text style={[styles.resultSub, { color: theme.subtle }, theme.font.body]}>
                  {t('food.barcode.identifiedSub')}
                </Text>
              ) : null}
              <View style={styles.resultActions}>
                <Pressable
                  onPress={onDismiss}
                  style={({ pressed }) => [
                    styles.resultBtn,
                    { borderWidth: 1, borderColor: theme.separator, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.resultBtnText, { color: theme.primary }, theme.font.bodySemiBold]}>
                    {t(outcome.kind === 'found' ? 'food.barcode.scanMore' : 'food.barcode.retry')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
      {!outcome ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.barcode.hint')}</Text>
      ) : null}
    </View>
  );
}

/**
 * Код попал В РАМКУ. Декодер возвращает углы найденного кода уже в координатах
 * вью (документация expo-camera: «adjusted to the dimensions of the view»), а
 * ПОРЯДОК углов на Android и iOS разный — поэтому берём центр, которому порядок
 * безразличен, и требуем, чтобы он лежал внутри рамки с запасом.
 *
 * Без этой проверки рамка была бы просто рисунком, а на полке магазина в кадр
 * попадает и соседний товар. Если координат нет вовсе, код принимается: лучше
 * сработать, чем не сработать — человек и так целится рамкой.
 */
function insideReticle(result: BarcodeScanningResult, frame: { width: number; height: number }): boolean {
  const points = result.cornerPoints;
  if (!points || points.length === 0 || frame.width === 0 || frame.height === 0) return true;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return (
    cx >= (RETICLE.left - RETICLE_SLACK) * frame.width &&
    cx <= (RETICLE.right + RETICLE_SLACK) * frame.width &&
    cy >= (RETICLE.top - RETICLE_SLACK) * frame.height &&
    cy <= (RETICLE.bottom + RETICLE_SLACK) * frame.height
  );
}

// Геометрия рамки и затемнения — вычисляется из RETICLE, чтобы нарисованное и
// проверяемое не могли разойтись.
const reticleBox = {
  left: pct(RETICLE.left),
  right: pct(1 - RETICLE.right),
  top: pct(RETICLE.top),
  bottom: pct(1 - RETICLE.bottom),
} as const;
const shadeTop = { left: 0, right: 0, top: 0, height: pct(RETICLE.top) } as const;
const shadeBottom = { left: 0, right: 0, bottom: 0, height: pct(1 - RETICLE.bottom) } as const;
const shadeLeft = {
  left: 0,
  top: pct(RETICLE.top),
  bottom: pct(1 - RETICLE.bottom),
  width: pct(RETICLE.left),
} as const;
const shadeRight = {
  right: 0,
  top: pct(RETICLE.top),
  bottom: pct(1 - RETICLE.bottom),
  width: pct(1 - RETICLE.right),
} as const;

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
  shade: { position: 'absolute', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  reticle: { position: 'absolute', borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  torch: { position: 'absolute', right: 10, top: 10, padding: 6 },
  torchIcon: { fontSize: 20 },
  // Результат гасит превью целиком: прицеливание закончилось, смотреть надо на ответ.
  resultScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  resultCard: { width: '100%', borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  resultTitle: { fontSize: 16, lineHeight: 22 },
  resultSub: { fontSize: 13, lineHeight: 18 },
  resultActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  resultBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  resultBtnText: { fontSize: 14 },
  hint: { fontSize: 13, lineHeight: 18 },
  permissionBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  permissionText: { fontSize: 13 },
});
