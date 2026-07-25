/// WCAG 2.1 contrast maths, so the palette's readability is a checked fact
/// rather than a design intention. Pure — no React Native, no theme imports —
/// which is what lets `__tests__/themeContrast.test.ts` walk every token.

export type Rgb = readonly [number, number, number];

/// Parses '#RRGGBB', '#RGB' or 'rgba(r,g,b,a)'. Returns the colour plus its
/// alpha (1 when opaque). Throws on anything else: a token this can't read is a
/// token the contrast test would otherwise skip in silence.
export function parseColor(input: string): { rgb: Rgb; alpha: number } {
  const value = input.trim();

  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return {
      rgb: [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }

  throw new Error(`Unsupported colour format: ${input}`);
}

/// Composites a (possibly translucent) foreground over an opaque background.
/// Translucent label colours are the norm on iOS, and their *effective* colour
/// — the only one a reader's eye receives — depends on what's behind them.
export function blend(foreground: string, background: string): Rgb {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (bg.alpha !== 1) throw new Error(`Background must be opaque: ${background}`);
  const a = Math.min(Math.max(fg.alpha, 0), 1);
  return [
    fg.rgb[0] * a + bg.rgb[0] * (1 - a),
    fg.rgb[1] * a + bg.rgb[1] * (1 - a),
    fg.rgb[2] * a + bg.rgb[2] * (1 - a),
  ];
}

/// Relative luminance, WCAG 2.1 §relative-luminance.
export function luminance(rgb: Rgb): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/// Contrast ratio between a foreground (alpha allowed) and an opaque background,
/// 1:1 … 21:1. AA wants ≥ 4.5 for body text, ≥ 3 for large text and for icons
/// and other non-text UI.
export function contrastRatio(foreground: string, background: string): number {
  const fg = luminance(blend(foreground, background));
  const bg = luminance(parseColor(background).rgb);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}
