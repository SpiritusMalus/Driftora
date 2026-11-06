/// iOS keeps its existing native navigation and grouping, with the same
/// «Лента дня» paper/ink palette as Android. This module remains React Native
/// free so the shared contrast contract can verify it in Node.
export const iosSurfaces = {
  light: {
    background: '#F2F3EB',
    card: '#F2F3EB',
    separator: '#CDD5C8',
    text: '#17302A',
    subtle: '#59685E',
    tertiary: '#59685E',
    fill: '#E7EBDD',
  },
  dark: {
    background: '#19231F',
    card: '#19231F',
    separator: '#425246',
    text: '#F0F1E7',
    subtle: '#ADBBAE',
    tertiary: '#ADBBAE',
    fill: '#27392E',
  },
};
