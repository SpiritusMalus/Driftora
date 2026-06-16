import { describe, expect, it } from '@jest/globals';

import {
  nextFireTimes,
  nextOccurrence,
  nextReminder,
  parseTimeOfDay,
} from '@/lib/core/services/reminderSchedule';

// Reference "now": 2026-06-17 10:00 local.
const now = new Date(2026, 5, 17, 10, 0, 0);

describe('parseTimeOfDay', () => {
  it('parses valid HH:mm and rejects malformed', () => {
    expect(parseTimeOfDay('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('8:5')).toBeNull();
    expect(parseTimeOfDay('nope')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('is today when still ahead, otherwise tomorrow', () => {
    const later = nextOccurrence({ hour: 21, minute: 30 }, now);
    expect([later.getDate(), later.getHours(), later.getMinutes()]).toEqual([17, 21, 30]);

    const earlier = nextOccurrence({ hour: 8, minute: 0 }, now);
    expect([earlier.getDate(), earlier.getHours()]).toEqual([18, 8]);
  });
});

describe('nextFireTimes / nextReminder', () => {
  it('returns fire times soonest-first and skips invalid strings', () => {
    const times = nextFireTimes(['08:00', '21:30', 'bad'], now);
    expect(
      times.map((d) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`),
    ).toEqual(['17 21:30', '18 8:00']);
  });

  it('nextReminder is the soonest, or null', () => {
    expect(nextReminder(['08:00', '21:30'], now)?.getHours()).toBe(21);
    expect(nextReminder([], now)).toBeNull();
    expect(nextReminder(['bad'], now)).toBeNull();
  });
});
