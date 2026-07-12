import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { isSilentRecording, startRecording } from '@/lib/core/services/audioRecorder';

/// Controllable expo-av stand-in. `mock`-prefixed so the hoisted jest.mock
/// factory may close over it. Each test tunes the knobs, `beforeEach` resets.
const mockAv = {
  granted: true,
  prepareFailures: 0,
  startFailures: 0,
  unloadCalls: 0,
  statusHandler: null as ((s: { metering?: number }) => void) | null,
  uri: 'file:///cache/clip.m4a' as string | null,
};

jest.mock('expo-av', () => {
  class Recording {
    async prepareToRecordAsync(_opts: unknown): Promise<void> {
      if (mockAv.prepareFailures > 0) {
        mockAv.prepareFailures -= 1;
        throw new Error('prepare failed');
      }
    }
    setProgressUpdateInterval(_ms: number): void {}
    setOnRecordingStatusUpdate(cb: (s: { metering?: number }) => void): void {
      mockAv.statusHandler = cb;
    }
    async startAsync(): Promise<void> {
      if (mockAv.startFailures > 0) {
        mockAv.startFailures -= 1;
        throw new Error('start failed');
      }
    }
    async stopAndUnloadAsync(): Promise<void> {
      mockAv.unloadCalls += 1;
    }
    getURI(): string | null {
      return mockAv.uri;
    }
  }
  return {
    Audio: {
      requestPermissionsAsync: async () => ({ granted: mockAv.granted }),
      setAudioModeAsync: async () => {},
      RecordingOptionsPresets: { HIGH_QUALITY: {} },
      Recording,
    },
  };
});

beforeEach(() => {
  mockAv.granted = true;
  mockAv.prepareFailures = 0;
  mockAv.startFailures = 0;
  mockAv.unloadCalls = 0;
  mockAv.statusHandler = null;
  mockAv.uri = 'file:///cache/clip.m4a';
});

describe('startRecording', () => {
  it('reports a denied permission as denied, not a generic failure', async () => {
    mockAv.granted = false;
    const res = await startRecording();
    expect(res.error).toBe('denied');
    expect(res.recording).toBeUndefined();
  });

  it('retries once after a transient failure (permission dialog race, busy mic)', async () => {
    mockAv.prepareFailures = 1;
    const res = await startRecording();
    expect(res.error).toBeUndefined();
    // The half-built first recorder was unloaded, or the retry could not prepare.
    expect(mockAv.unloadCalls).toBe(1);
    const clip = await res.recording!.stop();
    expect(clip).toEqual({ uri: 'file:///cache/clip.m4a', mimeType: 'audio/m4a' });
  });

  it('gives up after the retry with failed — permission was granted', async () => {
    mockAv.startFailures = 2;
    const res = await startRecording();
    expect(res.error).toBe('failed');
    // Both failed attempts cleaned their recorder up.
    expect(mockAv.unloadCalls).toBe(2);
  });

  it('tracks the whole-session peak for the silence check', async () => {
    const res = await startRecording();
    const rec = res.recording!;
    expect(rec.peakLevel()).toBeNull(); // no metering samples yet
    mockAv.statusHandler?.({ metering: -160 }); // digital silence
    expect(rec.peakLevel()).toBe(0);
    mockAv.statusHandler?.({ metering: -20 }); // speech
    expect(rec.peakLevel()).toBeCloseTo(2 / 3, 5);
    mockAv.statusHandler?.({ metering: -80 }); // the peak keeps its maximum
    expect(rec.peakLevel()).toBeCloseTo(2 / 3, 5);
    await rec.cancel();
  });
});

describe('isSilentRecording', () => {
  it('never flags without metering data (peak null)', () => {
    expect(isSilentRecording(null)).toBe(false);
  });

  it('flags a whole-clip peak at digital silence (muted/held mic)', () => {
    expect(isSilentRecording(0)).toBe(true);
    expect(isSilentRecording(0.019)).toBe(true);
  });

  it('does not flag ordinary quiet-room audio', () => {
    expect(isSilentRecording(0.17)).toBe(false);
    expect(isSilentRecording(1)).toBe(false);
  });
});
