import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ExpoSpeechService } from '@/lib/core/services/expoSpeech';

type Event = {
  results?: { transcript: string }[];
  isFinal?: boolean;
  error?: string;
  message?: string;
};
type Listener = { event: string; callback: (event: Event) => void; removed: boolean };
const mockListeners: Listener[] = [];
const mockRecognizer = {
  requestPermissionsAsync: jest.fn<() => Promise<{ granted: boolean }>>(),
  isRecognitionAvailable: jest.fn(() => true),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  addListener: jest.fn((event: string, callback: (event: Event) => void) => {
    const listener = { event, callback, removed: false };
    mockListeners.push(listener);
    return { remove: () => { listener.removed = true; } };
  }),
};

jest.mock('@/lib/i18n', () => ({ speechLocale: () => 'ru-RU' }));

let service: ExpoSpeechService;
function emit(event: string, payload: Event = {}) {
  for (const listener of [...mockListeners]) {
    if (!listener.removed && listener.event === event) listener.callback(payload);
  }
}
function activeListeners() { return mockListeners.filter((listener) => !listener.removed); }
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function deferredPermission() {
  let resolve!: (permission: { granted: boolean }) => void;
  const promise = new Promise<{ granted: boolean }>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockListeners.length = 0;
  mockRecognizer.requestPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockRecognizer.start.mockReset();
  mockRecognizer.stop.mockReset();
  mockRecognizer.abort.mockReset();
  service = new ExpoSpeechService();
  // Model the cached native module after initialize(). Node/Jest cannot load
  // the RN lazy import; the lifecycle below still calls the real service.
  Object.assign(service, { _mod: { ExpoSpeechRecognitionModule: mockRecognizer } });
});
afterEach(async () => {
  await service.stop();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('ExpoSpeechService session completion', () => {
  it('finishes and removes listeners when native start throws', async () => {
    mockRecognizer.start.mockImplementation(() => { throw new Error('recognizer unavailable'); });
    const end = jest.fn();
    await expect(service.listen(jest.fn(), end)).resolves.toBeUndefined();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ code: 'unknown' }));
    expect(activeListeners()).toHaveLength(0);
  });

  it('finishes a stop even when the recognizer never emits end', async () => {
    const end = jest.fn();
    await service.listen(jest.fn(), end);
    const lateEnd = mockListeners.find((listener) => listener.event === 'end')!.callback;
    await service.stop();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(undefined);
    expect(mockRecognizer.abort).toHaveBeenCalledTimes(1);
    expect(activeListeners()).toHaveLength(0);
    lateEnd({});
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending permission request without waiting for the OS dialog', async () => {
    const permission = deferredPermission();
    mockRecognizer.requestPermissionsAsync.mockReturnValue(permission.promise);
    await service.initialize();
    const end = jest.fn();
    const settled = jest.fn();
    const listening = service.listen(jest.fn(), end).then(settled);
    await flush();
    expect(mockRecognizer.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    await service.stop();
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
    permission.resolve({ granted: true });
    await listening;
    expect(mockRecognizer.start).not.toHaveBeenCalled();
    expect(activeListeners()).toHaveLength(0);
  });

  it('does not let late permission approval replace a newer session', async () => {
    const permission = deferredPermission();
    mockRecognizer.requestPermissionsAsync.mockReturnValueOnce(permission.promise);
    await service.initialize();
    const firstEnd = jest.fn();
    const first = service.listen(jest.fn(), firstEnd);
    await flush();
    const secondResult = jest.fn();
    const secondEnd = jest.fn();
    await service.listen(secondResult, secondEnd);
    permission.resolve({ granted: true });
    await first;
    expect(mockRecognizer.start).toHaveBeenCalledTimes(1);
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(firstEnd).toHaveBeenCalledWith(expect.objectContaining({ code: 'aborted' }));
    emit('result', { results: [{ transcript: 'new words' }], isFinal: false });
    expect(secondResult).toHaveBeenCalledWith('new words', false);
    emit('end');
    expect(secondEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps new listeners intact when old terminal callbacks arrive late', async () => {
    const firstResult = jest.fn();
    const firstEnd = jest.fn();
    await service.listen(firstResult, firstEnd);
    const old = [...mockListeners];
    const secondResult = jest.fn();
    const secondEnd = jest.fn();
    await service.listen(secondResult, secondEnd);
    old.find((listener) => listener.event === 'end')!.callback({});
    old.find((listener) => listener.event === 'error')!.callback({ error: 'network' });
    old.find((listener) => listener.event === 'result')!.callback({
      results: [{ transcript: 'stale words' }], isFinal: true,
    });
    emit('result', { results: [{ transcript: 'current words' }], isFinal: false });
    expect(firstResult).not.toHaveBeenCalled();
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(secondResult).toHaveBeenCalledWith('current words', false);
    expect(secondEnd).not.toHaveBeenCalled();
    expect(activeListeners()).toHaveLength(3);
  });

  it('finishes a final result once even if native end is missing or arrives later', async () => {
    const result = jest.fn();
    const end = jest.fn();
    await service.listen(result, end);
    const lateEnd = mockListeners.find((listener) => listener.event === 'end')!.callback;
    emit('result', { results: [{ transcript: 'finished words' }], isFinal: true });
    expect(result).toHaveBeenCalledWith('finished words', true);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(undefined);
    expect(activeListeners()).toHaveLength(0);
    lateEnd({});
    await jest.advanceTimersByTimeAsync(60_001);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('bounds a recognizer that never emits a terminal event', async () => {
    const result = jest.fn();
    const end = jest.fn();
    await service.listen(result, end);
    const staleResult = mockListeners.find((listener) => listener.event === 'result')!.callback;
    await jest.advanceTimersByTimeAsync(60_001);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ code: 'speech-timeout' }));
    expect(mockRecognizer.abort).toHaveBeenCalledTimes(1);
    expect(activeListeners()).toHaveLength(0);
    staleResult({ results: [{ transcript: 'too late' }], isFinal: true });
    expect(result).not.toHaveBeenCalled();
  });

  it('also bounds a permission promise that never settles', async () => {
    mockRecognizer.requestPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const end = jest.fn();
    const settled = jest.fn();
    const listening = service.listen(jest.fn(), end).then(settled);
    await jest.advanceTimersByTimeAsync(60_001);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ code: 'speech-timeout' }));
    expect(settled).toHaveBeenCalledTimes(1);
    await listening;
    expect(mockRecognizer.start).not.toHaveBeenCalled();
  });

  it('preserves partial results until a clean native end', async () => {
    const result = jest.fn();
    const end = jest.fn();
    await service.listen(result, end, 'en-US');
    expect(mockRecognizer.start).toHaveBeenCalledWith({ lang: 'en-US', interimResults: true, continuous: false });
    emit('result', { results: [{ transcript: 'partial words' }], isFinal: false });
    expect(result).toHaveBeenCalledWith('partial words', false);
    expect(end).not.toHaveBeenCalled();
    emit('end');
    expect(end).toHaveBeenCalledTimes(1);
    expect(activeListeners()).toHaveLength(0);
  });

  it('reports denied permissions without starting native recognition', async () => {
    mockRecognizer.requestPermissionsAsync.mockResolvedValue({ granted: false });
    const end = jest.fn();
    await service.listen(jest.fn(), end);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ code: 'not-allowed' }));
    expect(mockRecognizer.start).not.toHaveBeenCalled();
  });

  it('reports a native error once and ignores its following end event', async () => {
    const end = jest.fn();
    await service.listen(jest.fn(), end);
    const lateEnd = mockListeners.find((listener) => listener.event === 'end')!.callback;
    emit('error', { error: 'no-speech' });
    lateEnd({});
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ code: 'no-speech' }));
  });
});
