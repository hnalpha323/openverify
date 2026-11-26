/**
 * C78.1: tokens and name analysis. Every name is fictional or a common given or family name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/index.js';
import {
  BUSINESS_GENERIC_WORDS,
  MAX_NAME_TOKENS,
  NAME_PARTICLES,
  analyseBusinessName,
  analysePersonName,
  analyseRecordName,
  analysedNameCacheWork,
  NAME_TOKEN_CACHE_SIZE,
  nameToken,
  nameTokenWork,
  namesExactlyEqual,
  phraseText,
  resetAnalysedNameCacheWork,
  resetNameTokenWork,
  setAnalysedNameCacheOrder,
  setAnalysedNameCacheSize,
  setNameTokenCache,
  splitNameText,
  type AnalysedName,
} from './index.js';

type RecordName = WatchlistRecord['names'][number];
const recordName = (full: string, parts: RecordName['parts'] = []): RecordName => ({
  full,
  parts,
  script: 'latin',
  quality: 'strong',
  primary: true,
});
const simples = (name: AnalysedName) => name.tokens.map((token) => token.simple);
const types = (name: AnalysedName) => name.tokens.map((token) => token.type);
const roles = (name: AnalysedName) => name.tokens.map((token) => token.role);

describe('splitNameText', () => {
  it('drops apostrophes and format characters and splits on anything but letters, marks and digits', () => {
    expect(splitNameText("O'Brien-Smith")).toEqual(['OBrien', 'Smith']);
    expect(splitNameText('Abd al-Rahman')).toEqual(['Abd', 'al', 'Rahman']);
    expect(splitNameText('राहुल शर्मा')).toEqual(['राहुल', 'शर्मा']);
    expect(splitNameText('مهر‌داد')).toEqual(['مهرداد']);
    expect(splitNameText('  ')).toEqual([]);
  });
});

describe('nameToken', () => {
  it('keeps both Latin renderings, the original script and how reliable the Latin form is', () => {
    expect(nameToken('Müller', 'family')).toEqual({
      simple: 'muller',
      expanded: 'mueller',
      original: null,
      script: 'latin',
      reliability: 'native',
      role: 'family',
      type: 'word',
    });
    expect(nameToken('Иван')).toMatchObject({
      simple: 'ivan',
      original: 'иван',
      script: 'cyrillic',
      reliability: 'icao',
      role: null,
    });
    expect(phraseText(nameToken('Müller'))).toBe('muller');
    expect(phraseText(nameToken('Иван'))).toBe('иван');
  });
});

describe('analysePersonName', () => {
  it('meets MUELLER and MULLER through the ICAO 9303 §6.A fold (F21)', () => {
    const muller = analysePersonName('Hans Müller');
    expect(namesExactlyEqual(muller, analysePersonName('HANS MUELLER'))).toBe(true);
    expect(namesExactlyEqual(muller, analysePersonName('Hans Muller'))).toBe(true);
    expect(namesExactlyEqual(muller, analysePersonName('Hans Miller'))).toBe(false);
  });

  it('reads FAMILY, Given and structured fields as roles', () => {
    const listed = analysePersonName('SMITH, John Paul');
    expect(simples(listed)).toEqual(['smith', 'john', 'paul']);
    expect(roles(listed)).toEqual(['family', 'given', 'given']);
    const fields = analysePersonName({ first: 'John', middle: 'Paul', last: 'Smith' });
    expect(simples(fields)).toEqual(['john', 'paul', 'smith']);
    expect(roles(fields)).toEqual(['given', 'middle', 'family']);
    expect(roles(analysePersonName('John Paul Smith'))).toEqual([null, null, null]);
  });

  it('drops a leading title, tags suffixes and particles, and sorts the normalised form', () => {
    const name = analysePersonName('Dr Ahmed bin Rashid Jr');
    expect(simples(name)).toEqual(['ahmed', 'bin', 'rashid', 'junior']);
    expect(types(name)).toEqual(['word', 'particle', 'word', 'suffix']);
    expect(name.normalised).toBe('ahmed bin junior rashid');
    expect(simples(analysePersonName('Dr'))).toEqual(['dr']);
    expect(NAME_PARTICLES).toContain('bin');
  });

  it('keeps original-script tokens and their Latin forms', () => {
    const name = analysePersonName('Иван Петров');
    expect(simples(name)).toEqual(['ivan', 'petrov']);
    expect(name.tokens.map((token) => token.reliability)).toEqual(['icao', 'icao']);
    expect(namesExactlyEqual(name, analysePersonName('Ivan PETROV'))).toBe(true);
    const han = analysePersonName('王小明');
    expect(han.tokens).toHaveLength(1);
    expect(han.tokens[0]).toMatchObject({ simple: 'wangxiaoming', reliability: 'lossy' });
    expect(namesExactlyEqual(han, analysePersonName('Wangxiaoming'))).toBe(false);
    expect(namesExactlyEqual(han, analysePersonName('王小明'))).toBe(true);
  });

  it('compares names in any token order, and never a different number of tokens', () => {
    expect(
      namesExactlyEqual(analysePersonName('Smith John'), analysePersonName('John Smith')),
    ).toBe(true);
    expect(
      namesExactlyEqual(analysePersonName('John Smith'), analysePersonName('John Paul Smith')),
    ).toBe(false);
  });

  it(`reads at most ${String(MAX_NAME_TOKENS)} tokens and says so`, () => {
    const long = Array.from({ length: 40 }, (_, index) => `name${String(index)}`).join(' ');
    const name = analysePersonName(long);
    expect(name.tokens).toHaveLength(MAX_NAME_TOKENS);
    expect(name.truncated).toBe(true);
    expect(analysePersonName('John Smith').truncated).toBe(false);
  });
});

describe('analyseBusinessName', () => {
  it('drops a leading The, reads & as and, and tags generic words and legal forms at either end', () => {
    const name = analyseBusinessName('The Acme Trading Company Ltd');
    expect(types(name)).toEqual(['word', 'generic', 'legal_form', 'legal_form']);
    expect(simples(name).slice(0, 2)).toEqual(['acme', 'trading']);
    expect(simples(name)[3]).toBe('g:llc');
    expect(simples(analyseBusinessName('Smith & Wesson'))).toEqual(['smith', 'and', 'wesson']);
    expect(types(analyseBusinessName('ООО Ромашка'))).toEqual(['legal_form', 'word']);
    expect(BUSINESS_GENERIC_WORDS).toContain('trading');
  });

  it('reads a run of single letters as one word, and keeps a name that is all legal form', () => {
    expect(simples(analyseBusinessName('I.B.M. Corp'))).toEqual(['ibm', 'c:corporation']);
    expect(types(analyseBusinessName('Limited'))).toEqual(['word']);
  });

  it('compares legal forms by their generic tag', () => {
    const limited = analyseBusinessName('Acme Limited');
    expect(namesExactlyEqual(limited, analyseBusinessName('ACME LTD.'))).toBe(true);
    expect(namesExactlyEqual(limited, analyseBusinessName('Acme LLC'))).toBe(true);
    expect(namesExactlyEqual(limited, analyseBusinessName('Acme JSC'))).toBe(false);
    expect(limited.normalised).toBe('acme g:llc');
  });
});

describe('analyseRecordName', () => {
  it('reads the roles of a record name from its parts, dropping titles', () => {
    const name = analyseRecordName(
      recordName('Dr PETROV, Ivan', [
        { role: 'title', value: 'Dr' },
        { role: 'family', value: 'PETROV' },
        { role: 'given', value: 'Ivan' },
      ]),
      'individual',
    );
    expect(simples(name)).toEqual(['petrov', 'ivan']);
    expect(roles(name)).toEqual(['family', 'given']);
  });

  it('reads the full name when there are no parts, and an entity as a business', () => {
    expect(roles(analyseRecordName(recordName('PETROV, Ivan'), 'individual'))).toEqual([
      'family',
      'given',
    ]);
    const entity = analyseRecordName(recordName('Acme Holdings Ltd'), 'entity');
    expect(entity.kind).toBe('business');
    expect(types(entity)).toEqual(['word', 'generic', 'legal_form']);
    const parts = analyseRecordName(
      recordName('Acme Ltd', [
        { role: 'given', value: 'Acme' },
        { role: 'legal_form', value: 'Ltd' },
      ]),
      'vessel',
    );
    expect(types(parts)).toEqual(['word', 'legal_form']);
    expect(simples(parts)).toEqual(['acme', 'g:llc']);
  });
});

describe.each([
  ['its own list', true],
  ["the map's insertion order", false],
] as const)(
  'the analysed-name cache, its least-recently-used order in %s (owner decision 1 after 6B; its key and order, owner decision 3 after 6C)',
  (_, linked) => {
    afterEach(() => {
      setAnalysedNameCacheOrder(true);
    });
    const ordered = () => {
      setAnalysedNameCacheOrder(linked);
    };
    const orlan = (parts: RecordName['parts']) => recordName('Orlan Vexby', parts);
    const given = { role: 'given', value: 'Orlan' } as const;
    const family = { role: 'family', value: 'Vexby' } as const;

    it('keeps one analysis per kind, full name and parts, whichever objects carry them', () => {
      ordered();
      const first = analyseRecordName(orlan([given, family]), 'individual');
      expect(analyseRecordName(orlan([{ ...given }, { ...family }]), 'individual')).toBe(first);
      const swapped = analyseRecordName(
        orlan([
          { role: 'family', value: 'Orlan' },
          { role: 'given', value: 'Vexby' },
        ]),
        'individual',
      );
      expect(swapped).not.toBe(first);
      expect(roles(swapped)).toEqual(['family', 'given']);
      const unparted = analyseRecordName(orlan([]), 'individual');
      expect(unparted).not.toBe(first);
      expect(unparted).not.toBe(swapped);
      const entity = analyseRecordName(orlan([given, family]), 'entity');
      expect(entity).not.toBe(first);
      expect(entity.kind).toBe('business');
      expect(analyseRecordName(orlan([given]), 'individual')).not.toBe(first);
      expect(analyseRecordName(orlan([given, family]), 'individual')).toBe(first);
    });

    it('forgets the least recently used name when it is full', () => {
      ordered();
      const previous = setAnalysedNameCacheSize(2);
      try {
        const talia = recordName('Talia Quist');
        const ansel = recordName('Ansel Moor');
        const kept = analyseRecordName(talia, 'individual');
        const forgotten = analyseRecordName(ansel, 'individual');
        expect(analyseRecordName(talia, 'individual')).toBe(kept);
        analyseRecordName(recordName('Velina Xyzqa'), 'individual');
        expect(analyseRecordName(talia, 'individual')).toBe(kept);
        expect(analyseRecordName(ansel, 'individual')).not.toBe(forgotten);
        setAnalysedNameCacheSize(0);
        expect(analyseRecordName(talia, 'individual')).not.toBe(kept);
      } finally {
        setAnalysedNameCacheSize(previous);
      }
    });
  },
);

describe('the analysed-name cache with name-lru (owner decision 3 after 6C)', () => {
  afterEach(() => {
    setAnalysedNameCacheOrder(true);
  });

  it('writes nothing to its map on a hit, and one set and one delete to make room for a name', () => {
    setAnalysedNameCacheOrder(true);
    const previous = setAnalysedNameCacheSize(3);
    try {
      const [mira, oswin, petra, quill] = [
        'Mira Taskov',
        'Oswin Darrel',
        'Petra Lunvik',
        'Quill Amsel',
      ].map((full) => recordName(full));
      if (mira === undefined || oswin === undefined || petra === undefined || quill === undefined) {
        throw new Error('four names');
      }
      const kept = analyseRecordName(mira, 'individual');
      analyseRecordName(oswin, 'individual');
      const forgotten = analyseRecordName(petra, 'individual');
      resetAnalysedNameCacheWork();
      expect(analyseRecordName(mira, 'individual')).toBe(kept);
      analyseRecordName(oswin, 'individual');
      expect(analysedNameCacheWork()).toEqual({ hits: 2, mapWrites: 0 });
      // Petra is now the least recently used: Quill's analysis takes its place.
      analyseRecordName(quill, 'individual');
      expect(analysedNameCacheWork()).toEqual({ hits: 2, mapWrites: 2 });
      expect(analyseRecordName(mira, 'individual')).toBe(kept);
      expect(analyseRecordName(petra, 'individual')).not.toBe(forgotten);
    } finally {
      setAnalysedNameCacheSize(previous);
    }
  });
});

describe('nameToken with token-cache (owner decision 3 after 6C)', () => {
  afterEach(() => {
    setNameTokenCache(true);
  });
  const emptied = () => {
    setNameTokenCache(false);
    setNameTokenCache(true);
    resetNameTokenWork();
  };

  it('makes a written token once per role and type while it is kept, and each time with the cache off', () => {
    emptied();
    const first = nameToken('Mirelda', 'given');
    expect(nameToken('Mirelda', 'given')).toBe(first);
    const family = nameToken('Mirelda', 'family');
    expect(family).not.toBe(first);
    expect(family.role).toBe('family');
    const particle = nameToken('Mirelda', 'given', 'particle');
    expect(particle.type).toBe('particle');
    expect(nameToken('Mirelda')).not.toBe(first);
    expect(nameTokenWork().made).toBe(4);
    setNameTokenCache(false);
    resetNameTokenWork();
    const again = nameToken('Mirelda', 'given');
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
    expect(nameToken('Mirelda', 'given')).not.toBe(again);
    expect(nameTokenWork().made).toBe(2);
  });

  it('empties itself when it is full', () => {
    emptied();
    const first = nameToken('Ulvara');
    for (let index = 1; index < NAME_TOKEN_CACHE_SIZE; index += 1) {
      nameToken(`t${String(index)}`);
    }
    expect(nameToken('Ulvara')).toBe(first);
    nameToken('Ozrenka');
    expect(nameToken('Ulvara')).not.toBe(first);
    expect(nameTokenWork().made).toBe(NAME_TOKEN_CACHE_SIZE + 2);
  });
});
