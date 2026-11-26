import { describe, expect, it } from 'vitest';
import { MAX_ACCEPT_LANGUAGES, parseSignalRequestHeaders } from './request-headers.js';

describe('the request facts of POST /flow/signals (C94.8, V13)', () => {
  it('keeps nothing without the headers', () => {
    expect(parseSignalRequestHeaders({})).toEqual({ acceptLanguages: [], clientHints: null });
  });

  it('keeps the Accept-Language tags in preference order, at most five', () => {
    expect(MAX_ACCEPT_LANGUAGES).toBe(5);
    expect(
      parseSignalRequestHeaders({
        'accept-language': 'fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5',
      }).acceptLanguages,
    ).toEqual(['fr-CH', 'fr', 'en', 'de']);
    expect(
      parseSignalRequestHeaders({ 'accept-language': 'en;q=0.5, de, es-419;q=0.5, it;q=0' })
        .acceptLanguages,
    ).toEqual(['de', 'en', 'es-419']);
    expect(
      parseSignalRequestHeaders({ 'accept-language': 'a1, en, fr, de, it, es, pt, nl' })
        .acceptLanguages,
    ).toEqual(['en', 'fr', 'de', 'it', 'es']);
  });

  it('drops what is not a language tag, so no raw header string is kept', () => {
    expect(
      parseSignalRequestHeaders({
        'accept-language': ['en-US;q=bad, <script>, x'.repeat(3), 'de-DE;q=0.4'],
      }).acceptLanguages,
    ).toEqual(['de-DE']);
    expect(
      parseSignalRequestHeaders({ 'accept-language': `${'en-'.repeat(20)}x` }).acceptLanguages,
    ).toEqual([]);
  });

  it('reads the low-entropy client hints', () => {
    expect(
      parseSignalRequestHeaders({
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }).clientHints,
    ).toEqual({
      brands: [
        { brand: 'Chromium', version: '130' },
        { brand: 'Google Chrome', version: '130' },
        { brand: 'Not?A_Brand', version: '99' },
      ],
      mobile: false,
      platform: 'Windows',
    });
    expect(
      parseSignalRequestHeaders({ 'sec-ch-ua': '"Chromium";v="130"', 'sec-ch-ua-mobile': '?1' })
        .clientHints,
    ).toEqual({ brands: [{ brand: 'Chromium', version: '130' }], mobile: true, platform: null });
  });

  it('keeps no client hints from a malformed or oversized header', () => {
    expect(parseSignalRequestHeaders({ 'sec-ch-ua': 'Chromium 130' }).clientHints).toBeNull();
    expect(
      parseSignalRequestHeaders({ 'sec-ch-ua': `"${'x'.repeat(65)}";v="1"` }).clientHints,
    ).toBeNull();
    expect(
      parseSignalRequestHeaders({
        'sec-ch-ua': Array.from({ length: 9 }, (_, index) => `"B${String(index)}";v="1"`).join(
          ', ',
        ),
      }).clientHints,
    ).toBeNull();
    expect(
      parseSignalRequestHeaders({
        'sec-ch-ua': '"Chromium";v="130"',
        'sec-ch-ua-mobile': 'yes',
        'sec-ch-ua-platform': `"${'p'.repeat(33)}"`,
      }).clientHints,
    ).toEqual({ brands: [{ brand: 'Chromium', version: '130' }], mobile: null, platform: null });
  });
});
