import { describe, expect, it } from '@jest/globals';

import type { NotificationService } from '@/lib/core/services/notifications';
import { buildDailyReminders, rescheduleReminders } from '@/lib/core/services/reminders';

const copy = { title: 'T', body: 'B' };

describe('buildDailyReminders', () => {
  it('maps valid times to specs with stable, time-derived ids', () => {
    const specs = buildDailyReminders(['09:00', '21:30'], copy);
    expect(specs).toEqual([
      { id: 'daily-09-00', hour: 9, minute: 0, title: 'T', body: 'B' },
      { id: 'daily-21-30', hour: 21, minute: 30, title: 'T', body: 'B' },
    ]);
  });

  it('drops invalid times', () => {
    const specs = buildDailyReminders(['09:00', '99:99', 'nope', ''], copy);
    expect(specs.map((s) => s.id)).toEqual(['daily-09-00']);
  });

  it('dedupes times that normalize to the same id', () => {
    const specs = buildDailyReminders(['9:00', '09:00'], copy);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe('daily-09-00');
  });

  it('returns nothing when paused (a break mutes reminders)', () => {
    expect(buildDailyReminders(['09:00', '21:30'], copy, true)).toEqual([]);
  });
});

describe('rescheduleReminders', () => {
  function fakeService() {
    const calls: string[] = [];
    const service: NotificationService = {
      initialize: async () => {},
      requestPermissions: async () => true,
      scheduleDaily: async ({ id }) => {
        calls.push(`schedule:${id}`);
      },
      cancelAll: async () => {
        calls.push('cancelAll');
      },
    };
    return { service, calls };
  }

  it('cancels existing reminders before scheduling the current set', async () => {
    const { service, calls } = fakeService();
    await rescheduleReminders(service, buildDailyReminders(['09:00', '21:30'], copy));
    expect(calls).toEqual(['cancelAll', 'schedule:daily-09-00', 'schedule:daily-21-30']);
  });

  it('only cancels when there are no specs (e.g. paused)', async () => {
    const { service, calls } = fakeService();
    await rescheduleReminders(service, buildDailyReminders(['09:00'], copy, true));
    expect(calls).toEqual(['cancelAll']);
  });
});
