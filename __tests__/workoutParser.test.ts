import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { HttpWorkoutParser, type ParsedWorkout } from '@/lib/core/services/workoutParser';

const realFetch = globalThis.fetch;
const parser = () => new HttpWorkoutParser('https://food.example/food/parse', undefined, undefined, 100);
const audio = { uri: 'file:///fixture.m4a', mimeType: 'audio/m4a' };

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('workout request deadlines', () => {
  it.each(['fetch', 'body', 'identity'] as const)('recovers when voice %s never settles despite abort', async (stage) => {
    jest.useFakeTimers();
    const never = new Promise<never>(() => {});
    const fetchMock = jest.fn(async () => stage === 'fetch' ? never
      : { ok: true, status: 200, json: () => never } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    let identityReady = false;
    const service = new HttpWorkoutParser('https://food.example/food/parse', undefined,
      stage === 'identity' ? () => identityReady ? null : never : undefined);
    let result: ParsedWorkout[] | undefined;
    void service.parseAudio(audio).then((value) => { result = value; });
    await jest.advanceTimersByTimeAsync(49_999);
    expect(result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(2);
    expect(result).toEqual([]);
    if (stage === 'identity') expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    identityReady = true;
    const workout = { type: 'walk', name_ru: 'walk', minutes: 25, confidence: 0.9 };
    globalThis.fetch = jest.fn(async () => response(200, { workouts: [workout] })) as typeof fetch;
    await expect(service.parseAudio(audio)).resolves.toEqual([workout]);
  });

  it.each([401, 403, 503])('preserves the master empty-result contract for HTTP%s', async (status) => {
    globalThis.fetch = jest.fn(async () => response(status, {})) as typeof fetch;
    await expect(parser().parseAudio(audio)).resolves.toEqual([]);
  });

  it('preserves empty results on unavailable or malformed requests', async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error('DNS unavailable'); }) as typeof fetch;
    await expect(parser().parseAudio(audio)).resolves.toEqual([]);
    globalThis.fetch = jest.fn(async () => response(200, { unexpected: true })) as typeof fetch;
    await expect(parser().parseAudio(audio)).resolves.toEqual([]);
  });

  it('still returns valid activities and makes no request for blank text', async () => {
    const workout = { type: 'walk', name_ru: 'walk', minutes: 25, confidence: 0.9 };
    const fetchMock = jest.fn(async () => response(200, { workouts: [workout] }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(parser().parse('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(parser().parse('walk 25 minutes')).resolves.toEqual([workout]);
  });
});
