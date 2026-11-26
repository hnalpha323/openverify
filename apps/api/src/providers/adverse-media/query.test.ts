/**
 * C81.2 (V10): the GDELT query is built from letters and digits only. A screened name comes from an
 * API caller or an inquiry's typed fields, so it may hold GDELT operators (a quote, a leading `-`,
 * `sourcecountry:`, `domain:`, `OR`, parentheses) that would close the phrase and add a filter
 * returning nothing, which would read as "no match". Each test asserts the exact query string.
 * Every name is fictional.
 */
import { describe, expect, it } from 'vitest';
import { gdeltNameTokens, gdeltQuery, gdeltSourceCountry } from './query.js';

describe('gdeltNameTokens', () => {
  it('casefolds a name and keeps its letters and digits, word by word', () => {
    expect(gdeltNameTokens('Avery Sandbox QUILLFEATHER')).toEqual([
      'avery',
      'sandbox',
      'quillfeather',
    ]);
    expect(gdeltNameTokens('Zoë Müller-Brandt 3rd')).toEqual(['zoe', 'muller', 'brandt', '3rd']);
  });

  it('drops every operator character, leaving only words', () => {
    expect(gdeltNameTokens('"Avery" -sourcecountry:fr OR (domain:x.example)')).toEqual([
      'avery',
      'sourcecountry',
      'fr',
      'or',
      'domain',
      'x',
      'example',
    ]);
    expect(gdeltNameTokens('" - ( ) : *')).toEqual([]);
  });

  it('keeps letters of other scripts as C58 folds them, recomposed', () => {
    // C58 strips marks after NFKD, so the breve of й goes, as in every other folded token.
    expect(gdeltNameTokens('Эйвери Квиллфезер')).toEqual(['эивери', 'квиллфезер']);
    // Hangul decomposes into letters (no marks), and recomposes.
    expect(gdeltNameTokens('김 서연')).toEqual(['김', '서연']);
  });
});

describe('gdeltSourceCountry', () => {
  it('names a country as the DOC API writes it: its English name, letters only, lower case', () => {
    expect(gdeltSourceCountry('GB')).toBe('unitedkingdom');
    expect(gdeltSourceCountry('FR')).toBe('france');
    expect(gdeltSourceCountry('US')).toBe('unitedstates');
  });

  it('answers nothing for a code that is not a region', () => {
    expect(gdeltSourceCountry('ZZ')).toBeNull();
    expect(gdeltSourceCountry('gb')).toBeNull();
    expect(gdeltSourceCountry('GBR')).toBeNull();
  });
});

describe('gdeltQuery (V10)', () => {
  it('writes the name as one phrase and the terms as one OR group, quoting multi-word terms', () => {
    expect(
      gdeltQuery({
        names: [['avery', 'quillfeather']],
        terms: ['fraud', 'money laundering', 'bribery'],
      }),
    ).toBe('"avery quillfeather" (fraud OR "money laundering" OR bribery)');
  });

  it('writes one term without a group, and several names as an OR group of phrases', () => {
    expect(gdeltQuery({ names: [['avery', 'quillfeather']], terms: ['fraud'] })).toBe(
      '"avery quillfeather" fraud',
    );
    expect(
      gdeltQuery({
        names: [
          ['avery', 'quillfeather'],
          ['avy', 'quill'],
        ],
        terms: ['scam', 'theft'],
      }),
    ).toBe('("avery quillfeather" OR "avy quill") (scam OR theft)');
  });

  it('adds a country only as sourcecountry from the fixed table', () => {
    expect(
      gdeltQuery({ names: [['avery', 'quillfeather']], terms: ['fraud'], country: 'GB' }),
    ).toBe('"avery quillfeather" fraud sourcecountry:unitedkingdom');
    // An unknown code adds nothing rather than a filter that would empty the search.
    expect(
      gdeltQuery({ names: [['avery', 'quillfeather']], terms: ['fraud'], country: 'ZZ' }),
    ).toBe('"avery quillfeather" fraud');
  });

  it('lets nothing from the subject out of the phrase, whatever it holds', () => {
    const hostile = [
      'Avery" sourcecountry:fr "x',
      'Avery -fraud',
      'Avery OR Quill',
      'Avery) OR (sourcecountry:us',
      'Avery domain:news.example',
    ];
    expect(
      hostile.map((name) => gdeltQuery({ names: [gdeltNameTokens(name)], terms: ['fraud'] })),
    ).toEqual([
      '"avery sourcecountry fr x" fraud',
      '"avery fraud" fraud',
      '"avery or quill" fraud',
      '"avery or sourcecountry us" fraud',
      '"avery domain news example" fraud',
    ]);
  });

  it('reduces the terms too, and drops a name or a term that is empty', () => {
    expect(
      gdeltQuery({ names: [[], ['avery']], terms: ['"fraud"', '', 'money  laundering'] }),
    ).toBe('"avery" (fraud OR "money laundering")');
  });

  it('refuses a query without any name word', () => {
    expect(() => gdeltQuery({ names: [[], ['"-()']], terms: ['fraud'] })).toThrow(RangeError);
    expect(() => gdeltQuery({ names: [], terms: ['fraud'] })).toThrow(RangeError);
  });
});
