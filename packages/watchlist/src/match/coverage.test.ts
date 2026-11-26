/**
 * C78.5 (H05, H12), C73.2, C75.3, C79.3: coverage, the evidence-hash input and the crypto
 * screening, on fictional names and published or synthetic addresses.
 */
import { describe, expect, it } from 'vitest';
import { WRITING_SYSTEMS } from '@openverify/checks';
import { LIST_NAME_SCRIPTS } from '@openverify/core';
import { analysePersonName } from '../names/index.js';
import { canonicalJson } from '../record/index.js';
import { HOLDINGS, ORLAN, candidates, entry, name } from './fixtures.test-support.js';
import { entryKey, evidenceHashInput, screenCryptoAddress, screeningCoverage } from './index.js';

const latinOnly = new Map([['src', new Set(['latin'] as const)]]);

describe('screeningCoverage', () => {
  it('is complete for a Latin name, and for Cyrillic through ICAO 9303 §6.B', () => {
    expect(
      screeningCoverage([analysePersonName('Orlan Vexby')], {
        sourceIds: ['src'],
        truncated: false,
      }),
    ).toEqual({ complete: true, limits: [], names: [{ src: 'same_script' }], truncated: false });
    expect(
      screeningCoverage([analysePersonName('Иван Петров')], {
        sourceIds: ['src'],
        sourceScripts: latinOnly,
        truncated: false,
      }),
    ).toMatchObject({ complete: true, names: [{ src: 'transliterated' }] });
  });

  it('flags a lossy comparison, unless the source carries the subject script', () => {
    const han = [analysePersonName('王小明')];
    expect(
      screeningCoverage(han, { sourceIds: ['src'], sourceScripts: latinOnly, truncated: false }),
    ).toEqual({
      complete: false,
      limits: ['lossy_script'],
      names: [{ src: 'lossy' }],
      truncated: false,
    });
    expect(
      screeningCoverage(han, {
        sourceIds: ['src'],
        sourceScripts: new Map([['src', new Set(['latin', 'han'] as const)]]),
        truncated: false,
      }).complete,
    ).toBe(true);
    const arabic = [analysePersonName('محمد عبد الله')];
    expect(screeningCoverage(arabic, { sourceIds: ['src'], truncated: false }).limits).toEqual([
      'lossy_script',
    ]);
    expect(
      screeningCoverage(arabic, {
        sourceIds: ['src'],
        sourceScripts: new Map([['src', new Set(['latin', 'arabic'] as const)]]),
        truncated: false,
      }).limits,
    ).toEqual([]);
  });

  it('says not_compared for a name with no key, and states truncation and unclassified formats', () => {
    expect(
      screeningCoverage([analysePersonName(String.fromCodePoint(0x9fb3))], {
        sourceIds: ['src', 'other'],
        truncated: true,
        unclassifiedFormat: true,
      }),
    ).toEqual({
      complete: false,
      limits: ['not_compared', 'truncated', 'unclassified_format'],
      names: [{ src: 'not_compared', other: 'not_compared' }],
      truncated: true,
    });
  });
});

describe('the evidence-hash input (C75.3)', () => {
  it('frames entry key, content hash, list name and query as one canonical JSON array', () => {
    expect(entryKey('ofac-sdn', '12345')).toBe('ofac-sdn:12345');
    const input = evidenceHashInput({
      entryKey: 'test-src:A-1',
      contentHash: 'c'.repeat(64),
      listName: 'VEXBY, Orlan',
      query: { term: 'Orlan Vexby', birthdate: '1971-03-09' },
    });
    expect(input).toBe(
      canonicalJson([
        'test-src:A-1',
        'c'.repeat(64),
        'VEXBY, Orlan',
        { birthdate: '1971-03-09', term: 'Orlan Vexby' },
      ]),
    );
    expect(
      evidenceHashInput({
        entryKey: 'test-src:A-1',
        contentHash: 'c'.repeat(64),
        listName: 'VEXBY, Orlan',
        query: { birthdate: '1971-03-09', term: 'Orlan Vexby' },
      }),
    ).toBe(input);
    expect(
      evidenceHashInput({
        entryKey: 'test-src:A-1',
        contentHash: 'd'.repeat(64),
        listName: 'VEXBY, Orlan',
        query: { term: 'Orlan Vexby', birthdate: '1971-03-09' },
      }),
    ).not.toBe(input);
  });
});

describe('screenCryptoAddress (C79.3)', () => {
  it('matches the canonical form exactly, on any EVM chain', () => {
    const screening = screenCryptoAddress(
      { 'crypto-address': '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', 'chain-id': 'eip155:137' },
      candidates(HOLDINGS, ORLAN),
    );
    expect(screening.address).toMatchObject({ format: 'evm', chain: 'eip155:137' });
    expect(screening.coverage).toMatchObject({ complete: true, limits: [] });
    expect(screening.matches).toEqual([
      {
        sourceId: 'test-src',
        entryId: 'C-3',
        entryKey: 'test-src:C-3',
        score: 1,
        aboveMinimum: true,
        matchTypes: ['crypto_address_exact'],
        qualifiers: [],
        aliasType: 'primary_name',
        subjectName: null,
        listName: 'Sandbox Sanctioned Holdings Ltd',
        nameScore: 0,
        nameLevel: null,
        methods: ['crypto-address-exact'],
        lossy: false,
      },
    ]);
  });

  it('states an unclassified format, and has nothing to screen for an empty address', () => {
    const odd = entry('F-6', 'entity', [name('Fictional Exchange', { primary: true })], {
      crypto_addresses: [{ raw: 'not-a-known-address-format', ticker: 'XYZ' }],
    });
    const screening = screenCryptoAddress(
      { 'crypto-address': ' not-a-known-address-format ' },
      candidates(odd),
    );
    expect(screening.matches).toHaveLength(1);
    expect(screening.coverage).toMatchObject({ complete: false, limits: ['unclassified_format'] });
    expect(screenCryptoAddress({ 'crypto-address': '   ' }, candidates(odd))).toMatchObject({
      address: null,
      matches: [],
    });
  });
});

describe('the scripts a source state reads (owner decision 13 after 6B)', () => {
  it('are the writing systems C58 gives a list name', () => {
    expect([...LIST_NAME_SCRIPTS]).toEqual([...WRITING_SYSTEMS]);
  });
});
