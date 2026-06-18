import { describe, expect, it } from '@jest/globals';

import { pickRegion } from '@/lib/core/services/region';

describe('pickRegion', () => {
  it('honors an explicit RU/US setting over the device locale', () => {
    expect(pickRegion('RU', 'US')).toBe('RU');
    expect(pickRegion('US', 'RU')).toBe('US'); // setting wins over locale
  });

  it("falls back to the device locale on 'auto' or no setting", () => {
    expect(pickRegion('auto', 'RU')).toBe('RU');
    expect(pickRegion('auto', 'US')).toBe('US');
    expect(pickRegion(undefined, 'RU')).toBe('RU');
    expect(pickRegion(null, null)).toBe('US'); // unknown locale → US default
  });
});
