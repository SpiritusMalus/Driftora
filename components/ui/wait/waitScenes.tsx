import { Animated, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { type Theme } from '@/lib/theme/theme';
import {
  samplePath,
  travelTransforms,
  useLoop,
  useSwing,
  windowOpacity,
  withAngles,
} from './waitAnim';

/// The wait-scene fleet (owner selection 2026-08-21): nine little nautical /
/// signal-room vignettes, one shown at random per parse, all drawn from theme
/// tokens so they live in both «миллиметровка» worlds (paper + blueprint).
/// Geometry is computed from the measured width so wave loops tile seamlessly
/// in real pixels — a viewBox scale would break the «shift by one wavelength»
/// trick that makes the loops invisible.

export interface SceneProps {
  w: number;
  h: number;
  theme: Theme;
  reduced: boolean;
}

const WAVELEN = 40;

function wavePathD(width: number, y: number, amp: number): string {
  let d = `M0,${y}`;
  for (let x = 0; x < width + WAVELEN; x += WAVELEN) {
    d += ` q${WAVELEN / 4},${-amp} ${WAVELEN / 2},0 t${WAVELEN / 2},0`;
  }
  return d;
}

/** One drifting wave line, shifting by exactly one wavelength per loop. */
function Waves({
  w,
  y,
  amp,
  color,
  width,
  opacity,
  loop,
}: {
  w: number;
  y: number;
  amp: number;
  color: string;
  width: number;
  opacity: number;
  loop: Animated.Value;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: [{ translateX: loop.interpolate({ inputRange: [0, 1], outputRange: [0, -WAVELEN] }) }],
      }}
    >
      <Svg width={w + WAVELEN} height={y + amp + 4}>
        <Path d={wavePathD(w, y, amp)} fill="none" stroke={color} strokeWidth={width} opacity={opacity} />
      </Svg>
    </Animated.View>
  );
}

/** The paper boat, origami fold in the brand red. `s` scales the whole hull. */
function Boat({ s, theme, redFold = true }: { s: number; theme: Theme; redFold?: boolean }) {
  const W = 88 * s;
  const H = 52 * s;
  return (
    <Svg width={W} height={H}>
      <Path
        d={`M${4 * s},${34 * s} L${84 * s},${34 * s} L${73 * s},${49 * s} L${15 * s},${49 * s} Z`}
        fill={theme.card}
        stroke={theme.text}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <Path
        d={`M${44 * s},${3 * s} L${84 * s},${34 * s} M${44 * s},${3 * s} L${4 * s},${34 * s}`}
        fill="none"
        stroke={theme.text}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <Path
        d={`M${44 * s},${3 * s} L${44 * s},${34 * s}`}
        fill="none"
        stroke={redFold ? theme.primary : theme.text}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Gentle bob+roll wrapper — the shared boat idle. */
function Rock({ children, swing, style }: { children: React.ReactNode; swing: Animated.Value; style?: object }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          transform: [
            { translateY: swing.interpolate({ inputRange: [0, 1], outputRange: [1.5, -2.5] }) },
            { rotate: swing.interpolate({ inputRange: [0, 1], outputRange: ['-3.4deg', '3.2deg'] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Small instrument caption in the mono voice. */
function Mono({ x, y, theme, children }: { x: number; y: number; theme: Theme; children: string }) {
  return (
    <Text
      style={[
        { position: 'absolute', left: x, top: y, fontSize: 11, color: theme.subtle },
        theme.font.display,
      ]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------- № 3 Курс —
export function SceneCourse({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(4600, reduced);
  const seg1 = {
    p0: [0.13 * w, 0.72 * h] as [number, number],
    c1: [0.25 * w, 0.5 * h] as [number, number],
    c2: [0.33 * w, 0.38 * h] as [number, number],
    p1: [0.47 * w, 0.36 * h] as [number, number],
  };
  const seg2 = {
    p0: seg1.p1,
    c1: [0.62 * w, 0.34 * h] as [number, number],
    c2: [0.74 * w, 0.4 * h] as [number, number],
    p1: [0.85 * w, 0.55 * h] as [number, number],
  };
  const pts = samplePath([seg1, seg2], 9);
  const d = `M${seg1.p0[0]},${seg1.p0[1]} C${seg1.c1[0]},${seg1.c1[1]} ${seg1.c2[0]},${seg1.c2[1]} ${seg1.p1[0]},${seg1.p1[1]} C${seg2.c1[0]},${seg2.c1[1]} ${seg2.c2[0]},${seg2.c2[1]} ${seg2.p1[0]},${seg2.p1[1]}`;
  const cross = (x: number, y: number) => `M${x - 4},${y - 4} l8,8 M${x + 4},${y - 4} l-8,8`;
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path d={d} fill="none" stroke={theme.primary} strokeWidth={1.8} strokeDasharray="3 7" strokeLinecap="round" opacity={0.75} />
        <Path
          d={`${cross(seg1.p0[0], seg1.p0[1])} ${cross(seg1.p1[0], seg1.p1[1])} ${cross(seg2.p1[0], seg2.p1[1])}`}
          stroke={theme.text}
          strokeWidth={1.6}
          opacity={0.85}
        />
      </Svg>
      {!reduced ? (
        <Animated.View style={{ position: 'absolute', left: -8, top: -8, width: 16, height: 16, transform: travelTransforms(loop, pts) }}>
          <Svg width={16} height={16}>
            <Path d="M2,3 L14,8 L2,13 L5,8 Z" fill={theme.primary} />
          </Svg>
        </Animated.View>
      ) : null}
      <Mono x={0.05 * w} y={0.08 * h} theme={theme}>58.3N</Mono>
      <Mono x={0.78 * w} y={0.82 * h} theme={theme}>24.7E</Mono>
    </View>
  );
}

// -------------------------------------------------------------- № 4 Эхолот —
export function SceneSonar({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(4000, reduced);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(h / 2 - 10, 62);
  const blip = (frac: number, r: number) => {
    const a = frac * 2 * Math.PI;
    return { left: cx + r * Math.sin(a) - 3, top: cy - r * Math.cos(a) - 3, frac };
  };
  const blips = [blip(0.34, R * 0.55), blip(0.78, R * 0.75)];
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Circle cx={cx} cy={cy} r={R * 0.4} fill="none" stroke={theme.accent} strokeWidth={1} opacity={0.5} />
        <Circle cx={cx} cy={cy} r={R * 0.7} fill="none" stroke={theme.accent} strokeWidth={1} opacity={0.4} />
        <Circle cx={cx} cy={cy} r={R} fill="none" stroke={theme.accent} strokeWidth={1.4} opacity={0.6} />
        <Path
          d={`M${cx},${cy - R - 4} l0,6 M${cx},${cy + R - 2} l0,6 M${cx - R - 4},${cy} l6,0 M${cx + R - 2},${cy} l6,0`}
          stroke={theme.accent}
          strokeWidth={1.4}
          opacity={0.6}
        />
        <Circle cx={cx} cy={cy} r={3} fill={theme.primary} />
      </Svg>
      {!reduced ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: cx - R,
            top: cy - R,
            width: 2 * R,
            height: 2 * R,
            transform: [{ rotate: loop.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
          }}
        >
          <Svg width={2 * R} height={2 * R}>
            <Path d={`M${R},${R} L${R},0 A${R},${R} 0 0 1 ${R + 0.5 * R},${R - 0.866 * R} Z`} fill={theme.primary} opacity={0.14} />
            <Line x1={R} y1={R} x2={R} y2={0} stroke={theme.primary} strokeWidth={2} />
          </Svg>
        </Animated.View>
      ) : null}
      {blips.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: b.left,
            top: b.top,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.text,
            opacity: reduced ? 0.8 : windowOpacity(loop, b.frac, b.frac + 0.14, 0),
          }}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- № 5 Маяк —
export function SceneLighthouse({ w, h, theme, reduced }: SceneProps) {
  const beam = useSwing(5000, reduced);
  const lamp = useSwing(2500, reduced);
  const rock = useSwing(3200, reduced);
  const waves = useLoop(3400, reduced);
  const lx = 0.2 * w;
  const ly = 0.3 * h;
  const B = 0.5 * w;
  const baseY = 0.72 * h;
  const topY = 0.4 * h;
  return (
    <View style={{ width: w, height: h }}>
      {!reduced ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: lx - B,
            top: ly - B,
            width: 2 * B,
            height: 2 * B,
            transform: [{ rotate: beam.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '20deg'] }) }],
          }}
        >
          <Svg width={2 * B} height={2 * B}>
            <Path d={`M${B},${B} L${2 * B},${B - 0.16 * B} L${2 * B},${B + 0.16 * B} Z`} fill={theme.text} opacity={0.09} />
            <Path d={`M${B},${B} L${2 * B},${B - 0.16 * B} M${B},${B} L${2 * B},${B + 0.16 * B}`} stroke={theme.text} strokeWidth={1} opacity={0.22} />
          </Svg>
        </Animated.View>
      ) : null}
      <Svg width={w} height={h} style={{ position: 'absolute' }}>
        <Path
          d={`M${lx - 12},${baseY} L${lx - 7},${topY} L${lx + 7},${topY} L${lx + 12},${baseY} Z`}
          fill={theme.card}
          stroke={theme.text}
          strokeWidth={2}
        />
        <Path
          d={`M${lx - 10.4},${baseY - 0.09 * h} L${lx + 10.4},${baseY - 0.09 * h} M${lx - 9.3},${baseY - 0.18 * h} L${lx + 9.3},${baseY - 0.18 * h}`}
          stroke={theme.primary}
          strokeWidth={2.4}
        />
        <Path
          d={`M${lx - 7},${topY} L${lx - 7},${topY - 12} L${lx + 7},${topY - 12} L${lx + 7},${topY} M${lx - 10},${topY - 12} L${lx + 10},${topY - 12}`}
          fill="none"
          stroke={theme.text}
          strokeWidth={2}
        />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          left: lx - 4,
          top: ly - 4,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.primary,
          opacity: reduced ? 1 : lamp.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        }}
      />
      <Rock swing={rock} style={{ position: 'absolute', left: 0.66 * w, top: 0.62 * h }}>
        <Boat s={0.42} theme={theme} redFold={false} />
      </Rock>
      <Waves w={w} y={0.86 * h} amp={7} color={theme.subtle} width={1.6} opacity={0.9} loop={waves} />
    </View>
  );
}

// ------------------------------------------------------------ № 6 Морзянка —
export function SceneMorse({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(2400, reduced);
  const key = useSwing(1100, reduced);
  const y = 0.42 * h;
  const P = 150;
  const mark = (x: number, dash: boolean, k: string) =>
    dash ? (
      <Rect key={k} x={x} y={y - 2.5} width={14} height={5} rx={2.5} fill={theme.text} />
    ) : (
      <Circle key={k} cx={x + 3} cy={y} r={3} fill={theme.text} />
    );
  const pattern = [0, 14, 42, 56, 84, 112, 126].map((x, i) => ({ x, dash: i === 2 || i === 4 || i === 6 }));
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path d={`M${0.07 * w},${0.72 * h} L${0.33 * w},${0.72 * h}`} stroke={theme.accent} strokeWidth={2} opacity={0.5} />
        <Circle cx={0.09 * w} cy={0.68 * h} r={3} fill={theme.accent} />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0.09 * w,
          top: 0.6 * h,
          width: 0.24 * w,
          height: 14,
          transform: [{ rotate: reduced ? '0deg' : (key.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-5deg'] }) as unknown as string) }],
        }}
      >
        <Svg width={0.24 * w} height={14}>
          <Line x1={0} y1={10} x2={0.2 * w} y2={4} stroke={theme.text} strokeWidth={3} strokeLinecap="round" />
          <Circle cx={0.2 * w} cy={4} r={6} fill={theme.primary} />
        </Svg>
      </Animated.View>
      <View style={{ position: 'absolute', left: 0.42 * w, top: 0, width: 0.54 * w, height: h, overflow: 'hidden' }}>
        <Animated.View
          style={{
            position: 'absolute',
            transform: [{ translateX: loop.interpolate({ inputRange: [0, 1], outputRange: [0, -P] }) }],
          }}
        >
          <Svg width={0.54 * w + 2 * P} height={h}>
            {[0, P, 2 * P].flatMap((off, run) => pattern.map((m, i) => mark(off + m.x, m.dash, `${run}-${i}`)))}
          </Svg>
        </Animated.View>
      </View>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0.88 * w,
          top: 0.14 * h,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.primary,
          opacity: reduced ? 1 : windowOpacity(loop, 0.55, 0.72),
        }}
      />
      <Mono x={0.42 * w} y={0.1 * h} theme={theme}>TX</Mono>
    </View>
  );
}

// ---------------------------------------------------------------- № 7 Лента —
export function SceneTape({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(2800, reduced);
  const P = 120;
  const boxX = 0.06 * w;
  const boxY = 0.22 * h;
  const stripY = 0.52 * h;
  const holes = [0, 18, 18, 36, 54, 54, 72, 90, 108, 108].map((x, i) => ({
    x,
    up: i % 3 !== 1,
  }));
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Rect x={boxX} y={boxY} width={64} height={54} rx={6} fill={theme.card} stroke={theme.text} strokeWidth={2} />
        <Circle cx={boxX + 32} cy={boxY + 20} r={9} fill="none" stroke={theme.accent} strokeWidth={1.6} />
        <Circle cx={boxX + 32} cy={boxY + 20} r={2.4} fill={theme.primary} />
      </Svg>
      <View
        style={{ position: 'absolute', left: boxX + 64, top: stripY, width: w - boxX - 64 - 8, height: 22, overflow: 'hidden' }}
      >
        <Animated.View
          style={{ position: 'absolute', transform: [{ translateX: loop.interpolate({ inputRange: [0, 1], outputRange: [0, -P] }) }] }}
        >
          <Svg width={w + 2 * P} height={22}>
            <Rect x={0} y={2} width={w + 2 * P} height={18} fill={theme.iconBg} stroke={theme.separator} strokeWidth={1} />
            {[0, P, 2 * P, 3 * P].flatMap((off, run) =>
              holes.map((hle, i) => (
                <Circle key={`${run}-${i}`} cx={off + hle.x + 10} cy={hle.up ? 8 : 15} r={3.4} fill={theme.text} opacity={0.85} />
              )),
            )}
          </Svg>
        </Animated.View>
      </View>
      <Mono x={boxX + 72} y={0.26 * h} theme={theme}>encoding…</Mono>
    </View>
  );
}

// ---------------------------------------------------------- № 8 Радиомачта —
function RadioRing({
  x,
  y,
  size,
  color,
  durationMs,
  reduced,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  durationMs: number;
  reduced: boolean;
}) {
  const loop = useLoop(durationMs, reduced);
  if (reduced) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.6,
        borderColor: color,
        opacity: loop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
        transform: [{ scale: loop.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }],
      }}
    />
  );
}

export function SceneRadio({ w, h, theme, reduced }: SceneProps) {
  const waves = useLoop(3400, reduced);
  const lx = 0.19 * w;
  const ltop = 0.3 * h;
  const rx = 0.8 * w;
  const rtop = 0.42 * h;
  const base = 0.78 * h;
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path
          d={`M${lx - 12},${base} L${lx},${ltop} L${lx + 12},${base} M${lx - 8},${base - 0.14 * h} L${lx + 8},${base - 0.14 * h} M${lx - 5},${base - 0.27 * h} L${lx + 5},${base - 0.27 * h}`}
          fill="none"
          stroke={theme.text}
          strokeWidth={2}
        />
        <Path
          d={`M${rx - 9},${base} L${rx},${rtop} L${rx + 9},${base} M${rx - 6},${base - 0.12 * h} L${rx + 6},${base - 0.12 * h}`}
          fill="none"
          stroke={theme.accent}
          strokeWidth={2}
        />
        <Path
          d={`M${lx + 16},${ltop + 6} Q${w / 2},${0.1 * h} ${rx - 14},${rtop + 4}`}
          fill="none"
          stroke={theme.text}
          strokeWidth={1.4}
          strokeDasharray="3 6"
          opacity={0.45}
        />
        <Circle cx={lx} cy={ltop - 4} r={3.5} fill={theme.primary} />
        <Circle cx={rx} cy={rtop - 4} r={3} fill={theme.accent} />
      </Svg>
      <RadioRing x={lx} y={ltop - 4} size={56} color={theme.primary} durationMs={2000} reduced={reduced} />
      <RadioRing x={lx} y={ltop - 4} size={56} color={theme.primary} durationMs={2700} reduced={reduced} />
      <RadioRing x={rx} y={rtop - 4} size={40} color={theme.accent} durationMs={2300} reduced={reduced} />
      <Waves w={w} y={0.9 * h} amp={6} color={theme.subtle} width={1.4} opacity={0.6} loop={waves} />
    </View>
  );
}

// ---------------------------------------------------------- № 10 Пневмопочта —
export function ScenePneumo({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(3400, reduced);
  const yLow = 0.8 * h;
  const yHigh = 0.26 * h;
  const x1 = 0.42 * w;
  const x2 = 0.78 * w;
  const d = `M${0.08 * w},${yLow} L${x1 - 0.06 * w},${yLow} Q${x1},${yLow} ${x1},${yLow - 0.16 * h} L${x1},${yHigh + 0.16 * h} Q${x1},${yHigh} ${x1 + 0.06 * w},${yHigh} L${x2 - 0.06 * w},${yHigh} Q${x2},${yHigh} ${x2},${yHigh + 0.16 * h} L${x2},${yLow - 0.1 * h} Q${x2},${yLow} ${x2 + 0.05 * w},${yLow} L${0.94 * w},${yLow}`;
  const pts = withAngles([
    { x: 0.08 * w, y: yLow },
    { x: 0.2 * w, y: yLow },
    { x: 0.32 * w, y: yLow },
    { x: x1 - 0.03 * w, y: yLow - 0.01 * h },
    { x: x1, y: yLow - 0.08 * h },
    { x: x1, y: 0.55 * h },
    { x: x1, y: yHigh + 0.08 * h },
    { x: x1 + 0.03 * w, y: yHigh + 0.01 * h },
    { x: 0.5 * w, y: yHigh },
    { x: 0.62 * w, y: yHigh },
    { x: x2 - 0.03 * w, y: yHigh + 0.01 * h },
    { x: x2, y: yHigh + 0.08 * h },
    { x: x2, y: 0.62 * h },
    { x: x2, y: yLow - 0.05 * h },
    { x: x2 + 0.025 * w, y: yLow - 0.005 * h },
    { x: 0.86 * w, y: yLow },
    { x: 0.94 * w, y: yLow },
  ]);
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path d={d} fill="none" stroke={theme.accent} strokeWidth={9} opacity={0.16} strokeLinecap="round" />
        <Path d={d} fill="none" stroke={theme.accent} strokeWidth={1.4} opacity={0.6} strokeDasharray="4 5" />
      </Svg>
      {!reduced ? (
        <Animated.View style={{ position: 'absolute', left: -13, top: -5, width: 26, height: 10, transform: travelTransforms(loop, pts) }}>
          <View style={{ width: 26, height: 10, borderRadius: 5, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: theme.onPrimary, opacity: 0.9 }} />
          </View>
        </Animated.View>
      ) : null}
      <Mono x={0.05 * w} y={0.86 * h} theme={theme}>TX</Mono>
      <Mono x={0.9 * w} y={0.86 * h} theme={theme}>RX</Mono>
    </View>
  );
}

// ---------------------------------------------------------- № 11 Самолётик —
export function ScenePlane({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(4400, reduced);
  const seg1 = {
    p0: [0.11 * w, 0.76 * h] as [number, number],
    c1: [0.3 * w, 0.16 * h] as [number, number],
    c2: [0.7 * w, 0.13 * h] as [number, number],
    p1: [0.87 * w, 0.55 * h] as [number, number],
  };
  const seg2 = {
    p0: seg1.p1,
    c1: [0.8 * w, 0.75 * h] as [number, number],
    c2: [0.57 * w, 0.86 * h] as [number, number],
    p1: [0.37 * w, 0.66 * h] as [number, number],
  };
  const pts = samplePath([seg1, seg2], 9);
  const d = `M${seg1.p0[0]},${seg1.p0[1]} C${seg1.c1[0]},${seg1.c1[1]} ${seg1.c2[0]},${seg1.c2[1]} ${seg1.p1[0]},${seg1.p1[1]} C${seg2.c1[0]},${seg2.c1[1]} ${seg2.c2[0]},${seg2.c2[1]} ${seg2.p1[0]},${seg2.p1[1]}`;
  const tx = seg2.p1[0];
  const ty = seg2.p1[1];
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path d={d} fill="none" stroke={theme.text} strokeWidth={1.3} strokeDasharray="2 7" opacity={0.5} />
        <Path d={`M${tx - 4},${ty + 6} l8,8 M${tx + 4},${ty + 6} l-8,8`} stroke={theme.primary} strokeWidth={1.8} />
      </Svg>
      {!reduced ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: -9,
            top: -7,
            width: 18,
            height: 14,
            opacity: windowOpacity(loop, 0.02, 0.95, 0),
            transform: travelTransforms(loop, pts),
          }}
        >
          <Svg width={18} height={14}>
            <Path d="M1,2 L17,7 L1,12 L5,7 Z" fill={theme.text} stroke={theme.accent} strokeWidth={1} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------ № 13 Эстафета огней —
export function SceneRelay({ w, h, theme, reduced }: SceneProps) {
  const loop = useLoop(4200, reduced);
  const towers = [0.12, 0.37, 0.62, 0.87].map((f, i) => ({
    x: f * w,
    baseY: (i === 0 || i === 3 ? 0.78 : 0.72) * h,
    topY: (i === 0 || i === 3 ? 0.52 : 0.46) * h,
    win: [0.02 + i * 0.24, 0.24 + i * 0.24] as [number, number],
  }));
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Path
          d={`M${0.02 * w},${0.86 * h} C${0.3 * w},${0.78 * h} ${0.7 * w},${0.78 * h} ${0.98 * w},${0.86 * h}`}
          fill="none"
          stroke={theme.accent}
          strokeWidth={1.4}
          opacity={0.4}
        />
        {towers.map((t2, i) => (
          <Path
            key={i}
            d={`M${t2.x - 7},${t2.baseY} L${t2.x - 3.5},${t2.topY} L${t2.x + 3.5},${t2.topY} L${t2.x + 7},${t2.baseY} Z`}
            fill={theme.card}
            stroke={theme.text}
            strokeWidth={1.8}
          />
        ))}
        {towers.slice(0, -1).map((t2, i) => (
          <Line
            key={i}
            x1={t2.x + 8}
            y1={t2.topY - 6}
            x2={towers[i + 1].x - 8}
            y2={towers[i + 1].topY - 6}
            stroke={theme.primary}
            strokeWidth={1}
            strokeDasharray="2 5"
            opacity={0.45}
          />
        ))}
      </Svg>
      {/* Огонь поярче (запрос владельца): белое ядро + плотный красный ореол,
          горит четверть цикла, а не короткая вспышка. */}
      {towers.map((t2, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: t2.x - 9,
            top: t2.topY - 15,
            width: 18,
            height: 18,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: reduced ? 0.9 : windowOpacity(loop, t2.win[0], t2.win[1], 0.1),
          }}
        >
          <View style={{ position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, opacity: 0.35 }} />
          <View style={{ position: 'absolute', width: 9, height: 9, borderRadius: 4.5, backgroundColor: theme.primary }} />
          <View style={{ position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: theme.onPrimary }} />
        </Animated.View>
      ))}
    </View>
  );
}

// --------------------------------------------------------------- № 1 Дрейф —
/// Kept in the fleet quietly: the boat IS the icon, and a plain calm drift is
/// the right scene to land on when a random pick should not distract at all.
export function SceneDrift({ w, h, theme, reduced }: SceneProps) {
  const rock = useSwing(3000, reduced);
  const front = useLoop(2400, reduced);
  const back = useLoop(4600, reduced);
  const route = useLoop(3400, reduced);
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} style={{ position: 'absolute' }}>
        <Path
          d={`M${0.58 * w},${0.62 * h} C${0.7 * w},${0.56 * h} ${0.8 * w},${0.6 * h} ${0.94 * w},${0.5 * h}`}
          fill="none"
          stroke={theme.primary}
          strokeWidth={1.5}
          strokeDasharray="2 7"
          strokeLinecap="round"
          opacity={0.8}
        />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          opacity: reduced ? 1 : route.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.15, 0.7, 0] }),
        }}
      />
      <Rock swing={rock} style={{ position: 'absolute', left: 0.32 * w, top: 0.3 * h }}>
        <Boat s={0.9} theme={theme} />
      </Rock>
      <Waves w={w} y={0.74 * h} amp={7} color={theme.accent} width={1.4} opacity={0.45} loop={back} />
      <Waves w={w} y={0.7 * h} amp={8} color={theme.subtle} width={1.8} opacity={1} loop={front} />
    </View>
  );
}

export const WAIT_SCENES = [
  SceneCourse,
  SceneSonar,
  SceneLighthouse,
  SceneMorse,
  SceneTape,
  SceneRadio,
  ScenePneumo,
  ScenePlane,
  SceneRelay,
] as const;
