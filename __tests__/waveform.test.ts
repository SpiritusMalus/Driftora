import { describe, expect, it } from '@jest/globals';

import { pushLevel } from '@/components/ui/waveformBuffer';
import { normalizeMeterDb } from '@/lib/core/services/audioRecorder';

describe('pushLevel', () => {
  it('appends the newest level at the end', () => {
    expect(pushLevel([0.1, 0.2], 0.3, 5)).toEqual([0.1, 0.2, 0.3]);
  });

  it('keeps at most `max` samples, dropping the oldest', () => {
    const buf = pushLevel([0.1, 0.2, 0.3], 0.4, 3);
    expect(buf).toEqual([0.2, 0.3, 0.4]);
    expect(buf.length).toBe(3);
  });

  it('never exceeds max across repeated pushes', () => {
    let buf: number[] = [];
    for (let i = 0; i < 50; i++) buf = pushLevel(buf, i / 50, 24);
    expect(buf.length).toBe(24);
    expect(buf[buf.length - 1]).toBeCloseTo(49 / 50);
  });

  it('clamps levels into 0..1 and coerces non-finite to 0', () => {
    expect(pushLevel([], 1.5, 4)).toEqual([1]);
    expect(pushLevel([], -2, 4)).toEqual([0]);
    expect(pushLevel([], Number.NaN, 4)).toEqual([0]);
  });

  it('does not mutate the input buffer', () => {
    const input = [0.5];
    pushLevel(input, 0.6, 4);
    expect(input).toEqual([0.5]);
  });
});

describe('normalizeMeterDb', () => {
  it('floors quiet (≤ -60 dB) to 0 and 0 dB to 1', () => {
    expect(normalizeMeterDb(-60)).toBe(0);
    expect(normalizeMeterDb(-120)).toBe(0);
    expect(normalizeMeterDb(0)).toBe(1);
    expect(normalizeMeterDb(5)).toBe(1);
  });

  it('maps the mid-range linearly', () => {
    expect(normalizeMeterDb(-30)).toBeCloseTo(0.5);
    expect(normalizeMeterDb(-15)).toBeCloseTo(0.75);
  });

  it('coerces non-finite dB to 0', () => {
    expect(normalizeMeterDb(Number.NaN)).toBe(0);
    expect(normalizeMeterDb(-Infinity)).toBe(0);
  });
});
