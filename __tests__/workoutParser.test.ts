import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { HttpWorkoutParser, WorkoutParseError } from '@/lib/core/services/workoutParser';

const realFetch = globalThis.fetch;
const parser = () => new HttpWorkoutParser('https://food.example/food/parse', undefined, undefined, 100);

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('workout parsing failures', () => {
  it('keeps a successful empty parse separate from a failed request', async () => {
    globalThis.fetch = jest.fn(async () => response(200, { workouts: [] })) as typeof fetch;
    await expect(parser().parse('not an activity')).resolves.toEqual([]);

    globalThis.fetch = jest.fn(async () => { throw new Error('DNS unavailable'); }) as typeof fetch;
    await expect(parser().parse('walk 25 minutes')).rejects.toMatchObject({ reason: 'network' });
  });

  it.each([401, 403])('identifies rejected app access (%s) instead of blaming the description', async (status) => {
    globalThis.fetch = jest.fn(async () => response(status, {})) as typeof fetch;
    await expect(parser().parse('walk 25 minutes')).rejects.toMatchObject({ reason: 'unauthorized' });
  });

  it('identifies unavailable and malformed services instead of empty input', async () => {
    globalThis.fetch = jest.fn(async () => response(503, {})) as typeof fetch;
    await expect(parser().parse('walk 25 minutes')).rejects.toMatchObject({ reason: 'service' });

    globalThis.fetch = jest.fn(async () => response(200, { unexpected: true })) as typeof fetch;
    await expect(parser().parse('walk 25 minutes')).rejects.toBeInstanceOf(WorkoutParseError);
  });

  it('reports a timeout as a connection failure and clears the request timer', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    const result = expect(parser().parse('walk 25 minutes')).rejects.toMatchObject({ reason: 'network' });
    await jest.advanceTimersByTimeAsync(101);
    await result;
    expect(jest.getTimerCount()).toBe(0);
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
