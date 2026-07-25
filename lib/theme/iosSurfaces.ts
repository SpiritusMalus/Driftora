/// Native iOS grouped-list surface tokens (Apple HIG system colors), kept
/// separate from the Ember/Android palette in `colors.ts` — and in their own
/// module, free of any `react-native` import, so `__tests__/themeContrast.test.ts`
/// can load and check them without a native runtime.
///
/// ⚠️ The two label alphas deliberately DIVERGE from Apple's own secondaryLabel
/// (0.6) and tertiaryLabel (0.3). Apple ships those for a system that also ships
/// «Increase Contrast»; taken literally they put this app's secondary text at
/// 3.3:1 and its hint text at 1.7:1 in light mode — below WCAG AA (4.5:1 for
/// text, 3:1 for icons and other non-text UI), on screens people read outdoors
/// while walking. The contrast test pins every value here, so a future "back to
/// the HIG numbers" edit fails loudly instead of quietly making the app
/// unreadable again.
export const iosSurfaces = {
  light: {
    background: '#F2F2F7', // systemGroupedBackground
    card: '#FFFFFF', // secondarySystemGroupedBackground
    separator: 'rgba(60,60,67,0.12)', // inset hairline from the mockup
    text: '#000000', // label
    subtle: 'rgba(60,60,67,0.75)', // secondaryLabel, darkened to 4.8:1 (Apple's 0.6 = 3.3:1)
    tertiary: 'rgba(60,60,67,0.6)', // chevrons/close glyphs — 3.3:1, non-text AA
    fill: '#F2F2F7', // tertiarySystemFill — inactive mood pills
  },
  dark: {
    background: '#000000',
    card: '#1C1C1E',
    separator: 'rgba(84,84,88,0.4)',
    text: '#FFFFFF',
    subtle: 'rgba(235,235,245,0.6)', // already 5.9:1 on the card — left at Apple's value
    tertiary: 'rgba(235,235,245,0.45)', // 3.9:1 (Apple's 0.3 = 2.5:1)
    fill: '#2C2C2E',
  },
};
