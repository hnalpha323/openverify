/**
 * C82.3: US ZIP-to-state consistency from libaddressinput's state ZIP prefixes: the parser on
 * synthetic input, and the committed table built from exactly the pinned source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_DATA_DIRECTORY, readReportData } from '../data.js';
import {
  US_ZIP_PREFIXES_FILE,
  parseUsZipPrefixes,
  usZipMatchesState,
  usZipStateCodes,
  type UsZipPrefixTable,
} from './us-zip.js';

const usLine = (members: Record<string, string>) =>
  `data/US=${JSON.stringify({ id: 'data/US', key: 'US', name: 'UNITED STATES', ...members })}`;

describe('parseUsZipPrefixes', () => {
  it('pairs each state key with its prefix pattern, ignoring every other line', () => {
    const text = [
      'data={"id":"data","countries":"DE~US"}',
      'data/DE={"id":"data/DE","key":"DE","zip":"\\\\d{5}"}',
      usLine({
        sub_keys: 'AL~CA',
        sub_zips: '3[56]~9[0-5]|96[01]',
        sub_zipexs: '35000,36999~90000,96199',
      }),
      'data/US/CA={"id":"data/US/CA","key":"CA","zip":"9[0-5]|96[01]"}',
    ].join('\n');

    expect(parseUsZipPrefixes(text)).toEqual({ AL: '3[56]', CA: '9[0-5]|96[01]' });
  });

  it('refuses a file without the US line, or whose keys and prefixes do not pair up', () => {
    expect(() => parseUsZipPrefixes('data/DE={"key":"DE"}')).toThrow(/US/);
    expect(() =>
      parseUsZipPrefixes(usLine({ sub_keys: 'AL~CA', sub_zips: '3[56]', sub_zipexs: '35000' })),
    ).toThrow(/pair/);
  });

  it('refuses a prefix that does not compile or does not match its own examples', () => {
    expect(() =>
      parseUsZipPrefixes(usLine({ sub_keys: 'AL', sub_zips: '3[56', sub_zipexs: '35000' })),
    ).toThrow(/AL/);
    expect(() =>
      parseUsZipPrefixes(usLine({ sub_keys: 'AL', sub_zips: '3[56]', sub_zipexs: '45000' })),
    ).toThrow(/AL/);
  });
});

describe('usZipMatchesState', () => {
  it.each([
    ['62704', 'IL', true],
    ['62704-1234', 'IL', true],
    ['627041234', 'il', true],
    ['90210', 'CA', true],
    ['10001', 'NY', true],
    ['10001', 'CA', false],
    ['62704', 'NY', false],
    ['00901', 'PR', true],
    ['09012', 'AE', true],
  ] as const)('reads ZIP %s against %s as %s', (zip, state, expected) => {
    expect(usZipMatchesState(zip, state)).toBe(expected);
  });

  it('cannot tell for a value that is no ZIP, or a code the table does not hold', () => {
    expect(usZipMatchesState('6270', 'IL')).toBeNull();
    expect(usZipMatchesState('ABCDE', 'IL')).toBeNull();
    expect(usZipMatchesState('62704', 'ZZ')).toBeNull();
    expect(usZipMatchesState('62704', 'Illinois')).toBeNull();
  });
});

describe('the committed table (C82.3)', () => {
  const table = readReportData(US_ZIP_PREFIXES_FILE) as UsZipPrefixTable;
  const manifest = JSON.parse(
    readFileSync(
      join(REPORT_DATA_DIRECTORY, '..', '..', '..', '..', 'data', 'manifest.json'),
      'utf8',
    ),
  ) as { data: { name: string; sha256: string; license: string }[] };
  const pinned = manifest.data.find((entry) => entry.name === 'libaddressinput_countryinfo');

  it('lists exactly the pinned source it was built from, with its licence', () => {
    expect(table.sources).toEqual([
      { name: 'libaddressinput_countryinfo', sha256: pinned?.sha256, license: 'CC-BY-4.0' },
    ]);
    expect(table.licence).toMatch(/CC BY 4\.0/);
  });

  it('holds every state, the territories and the military codes, each pattern compiling', () => {
    expect(usZipStateCodes().length).toBeGreaterThanOrEqual(55);
    expect(usZipStateCodes()).toEqual(expect.arrayContaining(['CA', 'NY', 'DC', 'PR', 'GU', 'AA']));
    for (const pattern of Object.values(table.states)) {
      expect(() => new RegExp(`^(?:${pattern})`, 'u')).not.toThrow();
    }
  });
});
