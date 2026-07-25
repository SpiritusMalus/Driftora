import { describe, expect, it } from '@jest/globals';

import { colors } from '@/lib/theme/colors';
import { contrastRatio } from '@/lib/theme/contrast';
import { iosSurfaces } from '@/lib/theme/iosSurfaces';

/// Pins the readability of every text and glyph token against every surface it
/// can land on. This exists because the failure it guards is invisible to the
/// person making it: iOS light mode shipped secondary text at 3.3:1 and hint
/// text at 1.7:1 for months, and nothing in the app looked broken on a bright
/// desk monitor. Contrast is arithmetic, so it can simply be asserted.
///
/// Thresholds are WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text (≥24px,
/// or ≥18.66px bold) and for icons and other non-text UI. `text`, `heroText` and
/// `subtle` all carry body copy somewhere in the app, so they get the strict
/// number even where they also render a 40px figure — only `heroAccent`, which
/// is hero-only by contract, takes the large-text floor.
const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3;
const AA_NON_TEXT = 3;

describe('theme contrast (WCAG 2.1 AA)', () => {
  describe('iOS', () => {
    const schemes = [
      { name: 'light', tokens: iosSurfaces.light },
      { name: 'dark', tokens: iosSurfaces.dark },
    ] as const;

    for (const { name, tokens } of schemes) {
      // Both surfaces: the grouped background shows through inset cards, and
      // secondary text sits on each of them at different points in the app.
      const surfaces = [
        { label: 'card', value: tokens.card },
        { label: 'background', value: tokens.background },
      ];

      for (const surface of surfaces) {
        it(`${name}: primary text on ${surface.label} is readable`, () => {
          expect(contrastRatio(tokens.text, surface.value)).toBeGreaterThanOrEqual(AA_TEXT);
        });

        it(`${name}: secondary text on ${surface.label} is readable`, () => {
          expect(contrastRatio(tokens.subtle, surface.value)).toBeGreaterThanOrEqual(AA_TEXT);
        });

        // `tertiary` is glyph-only by contract — chevrons and close buttons.
        // Any Text that reaches for it must use `subtle` instead; that rule is
        // why this threshold is the non-text one and not a relaxed text one.
        it(`${name}: tertiary glyphs on ${surface.label} meet the non-text floor`, () => {
          expect(contrastRatio(tokens.tertiary, surface.value)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }
    }
  });

  describe('Android', () => {
    const schemes = [
      { name: 'light', tokens: colors.light },
      { name: 'dark', tokens: colors.dark },
    ] as const;

    for (const { name, tokens } of schemes) {
      const surfaces = [
        { label: 'card', value: tokens.card },
        { label: 'background', value: tokens.background },
      ];

      for (const surface of surfaces) {
        it(`${name}: primary text on ${surface.label} is readable`, () => {
          expect(contrastRatio(tokens.text, surface.value)).toBeGreaterThanOrEqual(AA_TEXT);
        });

        it(`${name}: secondary text on ${surface.label} is readable`, () => {
          expect(contrastRatio(tokens.subtle, surface.value)).toBeGreaterThanOrEqual(AA_TEXT);
        });

        it(`${name}: hero text on ${surface.label} is readable`, () => {
          expect(contrastRatio(tokens.heroText, surface.value)).toBeGreaterThanOrEqual(AA_TEXT);
        });

        it(`${name}: icon glyphs on ${surface.label} meet the non-text floor`, () => {
          expect(contrastRatio(tokens.icon, surface.value)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }

      // `heroAccent` is a HERO-ONLY token: every one of its 13 call sites pairs
      // it with `font.heading`/`display`/`displayHeavy` at 20px and up, which is
      // WCAG "large text" (≥18.66px bold) and so carries the 3:1 floor.
      //
      // It is held to that floor and no lower ON PURPOSE, because the dark red
      // is at 4.2:1 — comfortable for a 40px figure, short of the 4.5:1 body
      // threshold. Painting a caption or a 13px note with this token is
      // therefore a real regression that no assertion here can see. If one is
      // ever needed, lighten the dark `heroAccent` rather than relaxing this.
      it(`${name}: hero accent meets the large-text floor on the background`, () => {
        expect(contrastRatio(tokens.heroAccent, tokens.background)).toBeGreaterThanOrEqual(
          AA_LARGE_TEXT,
        );
      });

      it(`${name}: text on the primary fill is readable`, () => {
        expect(contrastRatio(tokens.onPrimary, tokens.primary)).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  });
});
