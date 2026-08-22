import { describe, expect, test } from '@jest/globals';

import { pieceGramsFor } from '@/lib/core/services/pieceUnits';

describe('pieceGramsFor', () => {
  test('яйца во всех падежах и калибрах', () => {
    expect(pieceGramsFor('яйцо куриное')).toBe(50);
    expect(pieceGramsFor('яйца варёные')).toBe(50);
    expect(pieceGramsFor('2 яиц', 'eggs')).toBe(50);
    // Перепелиное — свой (маленький) вес, частное правило выше общего.
    expect(pieceGramsFor('яйцо перепелиное')).toBe(10);
  });

  test('блюда из яиц штуками не считаются', () => {
    expect(pieceGramsFor('яичница')).toBeNull();
    expect(pieceGramsFor('яичный салат')).toBeNull();
  });

  test('фрукты и фабричное штучное', () => {
    expect(pieceGramsFor('банан')).toBe(120);
    expect(pieceGramsFor('яблоко', 'apple')).toBe(170);
    expect(pieceGramsFor('пельмени')).toBe(12);
    expect(pieceGramsFor('сосиска молочная')).toBe(50);
    expect(pieceGramsFor('сырок глазированный')).toBe(45);
  });

  test('производные формы не выдают штуку', () => {
    expect(pieceGramsFor('яблочный сок')).toBeNull();
    expect(pieceGramsFor('сок апельсиновый')).toBeNull();
    expect(pieceGramsFor('яблочное пюре')).toBeNull();
    expect(pieceGramsFor('банановые чипсы')).toBeNull();
    expect(pieceGramsFor('шарлотка с яблоками')).toBeNull();
  });

  test('не-штучная еда — null; «сливки»/«сливочное» не слива', () => {
    expect(pieceGramsFor('борщ')).toBeNull();
    expect(pieceGramsFor('гречка варёная', 'buckwheat')).toBeNull();
    expect(pieceGramsFor('сливки 10%')).toBeNull();
    expect(pieceGramsFor('сливочное масло')).toBeNull();
    expect(pieceGramsFor('баклажан запечённый', 'eggplant')).toBeNull();
    expect(pieceGramsFor()).toBeNull();
  });
});
