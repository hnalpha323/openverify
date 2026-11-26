import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/create-i18n';
import { entryErrorMessageKey, errorMessageKey } from './error-message';
import { FlowApiError } from './flow-api-client';

function http(status: number): FlowApiError {
  return new FlowApiError('http', `GET /x failed with HTTP ${String(status)}`, { status });
}

describe('errorMessageKey', () => {
  it.each([
    [new FlowApiError('network', 'no response'), 'errors.network'],
    [new FlowApiError('timeout', 'timed out'), 'errors.timeout'],
    [http(401), 'errors.unauthorized'],
    [http(403), 'errors.unauthorized'],
    [http(404), 'errors.unauthorized'],
    [http(410), 'errors.unauthorized'],
    [http(409), 'errors.conflict'],
    [http(413), 'errors.tooLarge'],
    [http(415), 'errors.unsupportedImage'],
    [http(422), 'errors.unsupportedImage'],
    [http(429), 'errors.rateLimited'],
    [http(500), 'errors.server'],
    [http(503), 'errors.server'],
    [http(400), 'errors.unexpected'],
    [new FlowApiError('invalid-response', 'bad body'), 'errors.unexpected'],
    [new FlowApiError('aborted', 'aborted'), 'errors.unexpected'],
    [new TypeError('boom'), 'errors.unexpected'],
    ['a string', 'errors.unexpected'],
  ])('maps %o to %s', (error, key) => {
    expect(errorMessageKey(error)).toBe(key);
  });

  it('only returns keys that have a message', () => {
    const i18n = createI18n('es');
    const errors = [
      http(401),
      http(409),
      http(413),
      http(415),
      http(429),
      http(500),
      new FlowApiError('timeout', 'timed out'),
      null,
    ];

    for (const error of errors) {
      expect(i18n.exists(errorMessageKey(error))).toBe(true);
    }
  });
});

describe('entryErrorMessageKey (C64.1)', () => {
  it.each([
    [http(400), 'errors.notAccepted'],
    [http(422), 'errors.notAccepted'],
    [http(409), 'errors.conflict'],
    [http(429), 'errors.rateLimited'],
    [new FlowApiError('network', 'no response'), 'errors.network'],
  ])('maps %o to %s, never to a photo message', (error, key) => {
    expect(entryErrorMessageKey(error)).toBe(key);
  });

  it('has the message in both languages', () => {
    for (const language of ['en', 'es'] as const) {
      expect(createI18n(language).exists(entryErrorMessageKey(http(422)))).toBe(true);
    }
  });
});
