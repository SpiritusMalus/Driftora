import { describe, expect, it } from '@jest/globals';

import { en } from '@/lib/i18n/locales/en';
import { ru } from '@/lib/i18n/locales/ru';
import { mapSpeechError } from '@/lib/core/services/expoSpeech';
import type { SpeechErrorCode } from '@/lib/core/services/speech';

const ALL_CODES: SpeechErrorCode[] = [
  'no-speech',
  'speech-timeout',
  'network',
  'not-allowed',
  'language-not-supported',
  'audio-capture',
  'busy',
  'aborted',
  'unknown',
];

describe('mapSpeechError', () => {
  it('passes through the recognizer codes we model', () => {
    expect(mapSpeechError('no-speech')).toBe('no-speech');
    expect(mapSpeechError('speech-timeout')).toBe('speech-timeout');
    expect(mapSpeechError('network')).toBe('network');
    expect(mapSpeechError('audio-capture')).toBe('audio-capture');
    expect(mapSpeechError('aborted')).toBe('aborted');
  });

  it('collapses permission + language aliases', () => {
    expect(mapSpeechError('not-allowed')).toBe('not-allowed');
    expect(mapSpeechError('service-not-allowed')).toBe('not-allowed');
    expect(mapSpeechError('language-not-supported')).toBe('language-not-supported');
    expect(mapSpeechError('bad-grammar')).toBe('language-not-supported');
    expect(mapSpeechError('recognizer-busy')).toBe('busy');
  });

  it('folds anything unrecognized to "unknown"', () => {
    expect(mapSpeechError(undefined)).toBe('unknown');
    expect(mapSpeechError('')).toBe('unknown');
    expect(mapSpeechError('totally-made-up')).toBe('unknown');
  });
});

describe('voiceError i18n coverage', () => {
  it.each(ALL_CODES)('has a RU and EN message for "%s"', (code) => {
    expect(typeof ru.food.voiceError[code]).toBe('string');
    expect(ru.food.voiceError[code].length).toBeGreaterThan(0);
    expect(typeof en.food.voiceError[code]).toBe('string');
    expect(en.food.voiceError[code].length).toBeGreaterThan(0);
  });
});
