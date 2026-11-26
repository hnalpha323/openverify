import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  detectLanguage,
  isSupportedLanguage,
  negotiateLanguage,
  requestedLanguages,
} from './languages';

describe('the built-in languages (C161.1, decision 30)', () => {
  it('are English, the source, then Spanish, French, German and Arabic', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'es', 'fr', 'de', 'ar']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });
});

describe('isSupportedLanguage', () => {
  it.each(['en', 'es', 'fr', 'de', 'ar'])('accepts %s', (language) => {
    expect(isSupportedLanguage(language)).toBe(true);
  });

  it.each(['it', 'EN', 'es-MX', '', undefined])('rejects %s', (language) => {
    expect(isSupportedLanguage(language)).toBe(false);
  });
});

describe('negotiateLanguage: RFC 4647 lookup on the base language (C161.2)', () => {
  it('chooses the catalog by base language and keeps the full tag for formatting', () => {
    expect(negotiateLanguage(['ar-EG'])).toEqual({ language: 'ar', locale: 'ar-EG' });
    expect(negotiateLanguage(['fr-CA', 'en'])).toEqual({ language: 'fr', locale: 'fr-CA' });
    expect(negotiateLanguage(['de'])).toEqual({ language: 'de', locale: 'de' });
  });

  it('truncates a tag from the end, dropping a single-letter subtag with what follows it', () => {
    expect(negotiateLanguage(['de-CH-1996'])).toEqual({ language: 'de', locale: 'de-CH-1996' });
    expect(negotiateLanguage(['es-419-x-private'])).toEqual({
      language: 'es',
      locale: 'es-419-x-private',
    });
    expect(negotiateLanguage(['ar-Arab-EG-u-nu-latn'])).toEqual({
      language: 'ar',
      locale: 'ar-Arab-EG-u-nu-latn',
    });
  });

  it('canonicalises case and underscores before matching', () => {
    expect(negotiateLanguage(['ES_mx'])).toEqual({ language: 'es', locale: 'es-MX' });
    expect(negotiateLanguage(['  AR-eg '])).toEqual({ language: 'ar', locale: 'ar-EG' });
  });

  it('tries each candidate in priority order and skips what is not a language tag', () => {
    expect(
      negotiateLanguage([null, undefined, '', '  ', '*', 'not a tag!', 'ja-JP', 'fr-BE']),
    ).toEqual({ language: 'fr', locale: 'fr-BE' });
  });

  it('never matches a longer language by its prefix', () => {
    // `arn` (Mapudungun) and `ent` are not `ar` and `en`: lookup compares whole subtags.
    expect(negotiateLanguage(['arn', 'ent', 'de'])).toEqual({ language: 'de', locale: 'de' });
  });

  it('reads an ISO 639-2 code as the language it canonicalises to', () => {
    // `ara` and `fra` are Arabic and French under their three-letter codes (CLDR aliases).
    expect(negotiateLanguage(['ara-EG'])).toEqual({ language: 'ar', locale: 'ar-EG' });
    expect(negotiateLanguage(['fra'])).toEqual({ language: 'fr', locale: 'fr' });
  });

  it('chooses only among the available languages, falling back as told', () => {
    const options = { available: ['en', 'fr'] as const, fallback: 'fr' as const };

    expect(negotiateLanguage(['ar-EG', 'en-GB'], options)).toEqual({
      language: 'en',
      locale: 'en-GB',
    });
    expect(negotiateLanguage(['ar-EG', 'de'], options)).toEqual({ language: 'fr', locale: 'fr' });
  });

  it('falls back to English when nothing matches', () => {
    expect(negotiateLanguage([])).toEqual({ language: 'en', locale: 'en' });
    expect(negotiateLanguage(['it-IT', 'ja'])).toEqual({ language: 'en', locale: 'en' });
  });

  it('never falls back to a language outside the available ones', () => {
    expect(negotiateLanguage(['ja'], { available: ['es', 'de'], fallback: 'fr' })).toEqual({
      language: 'es',
      locale: 'es',
    });
  });
});

describe('detectLanguage', () => {
  it('is the catalog language of negotiateLanguage', () => {
    expect(detectLanguage(['es-MX', 'en-US'])).toBe('es');
    expect(detectLanguage(['it-IT', 'es', 'en'])).toBe('es');
    expect(detectLanguage(['ES_es'])).toBe('es');
    expect(detectLanguage([null, undefined, '  ', 'ar-EG'])).toBe('ar');
    expect(detectLanguage(['it-IT', 'ja'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});

describe('requestedLanguages: the language parameter, then the browser (C161.2)', () => {
  const at = (search: string, hash = '') => ({ search, hash });

  it('reads the public language parameter before the browser preferences', () => {
    expect(requestedLanguages(at('?language=ar-EG'), ['fr-FR', 'en'])).toEqual([
      'ar-EG',
      'fr-FR',
      'en',
    ]);
  });

  it('keeps lang as an alias, after language', () => {
    expect(requestedLanguages(at('?lang=de&language=fr'), [])).toEqual(['fr', 'de']);
    expect(requestedLanguages(at('?lang=de'), ['en'])).toEqual(['de', 'en']);
  });

  it('reads the parameters in the query, then in the fragment', () => {
    expect(
      requestedLanguages(at('?lang=es', '#inquiry-id=inq_x&session-token=t&language=ar'), ['en']),
    ).toEqual(['ar', 'es', 'en']);
    expect(requestedLanguages(at('?language=fr', '#language=ar'), [])).toEqual(['fr', 'ar']);
  });

  it('leaves out empty values', () => {
    expect(requestedLanguages(at('?language=&lang=', '#language='), ['de'])).toEqual(['de']);
  });
});
