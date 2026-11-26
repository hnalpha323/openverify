/**
 * The NFC checks' supports: the C62.4 integrity rule, the PA options from the template, the
 * issuer-country map PA compares DG1 through, and DG1's fields for the chip read's attributes.
 */
import { defaultTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { nfcChipFields } from './chip-fields.js';
import { nfcPassiveAuthenticationOptions } from './config.js';
import { dataGroupIntegrity, onIntegrity } from './integrity.js';
import { nfcIssuerCountry } from './issuer-country.js';
import { nfcTemplate, paReport, TD3_LINES } from './testing.js';

const now = new Date('2026-10-23T12:00:00Z');

describe('dataGroupIntegrity and onIntegrity (C62.4)', () => {
  it('establishes a data group only when the report is established and the group identical', () => {
    expect(dataGroupIntegrity(paReport(), 1)).toBe('established');
    expect(dataGroupIntegrity(paReport({ dataGroups: { 1: 'not_identical' } }), 1)).toBe(
      'not_established',
    );
    expect(dataGroupIntegrity(paReport({ dataGroups: { 2: 'identical' } }), 1)).toBe(
      'not_established',
    );
    expect(dataGroupIntegrity(paReport({ dataGroups: { 15: 'not_listed' } }), 15)).toBe(
      'not_established',
    );
    expect(
      dataGroupIntegrity(
        paReport({ integrity: 'not_established', integrityReason: 'dsc_missing' }),
        1,
      ),
    ).toBe('not_established');
    expect(
      dataGroupIntegrity(paReport({ integrity: 'broken', integrityReason: 'dg_hash_mismatch' }), 2),
    ).toBe('broken');
    expect(dataGroupIntegrity(null, 1)).toBe('not_established');
  });

  it('judges normally on established, fails a mismatch and withholds a match when not established, and gives nothing when broken', () => {
    const passed = { status: 'passed', reasons: [] } as const;
    const failed = { status: 'failed', reasons: ['face_mismatch'] } as const;
    const missing = { status: 'not_applicable', reasons: ['no_reference_data'] } as const;
    const withheld = { status: 'not_applicable', reasons: ['integrity_not_established'] };
    expect(onIntegrity('established', passed)).toEqual(passed);
    expect(onIntegrity('not_established', failed)).toEqual(failed);
    expect(onIntegrity('not_established', passed)).toEqual(withheld);
    expect(onIntegrity('not_established', missing)).toEqual(missing);
    expect(onIntegrity('broken', failed)).toEqual(withheld);
    expect(onIntegrity('broken', missing)).toEqual(withheld);
  });
});

describe('nfcPassiveAuthenticationOptions (C51.3)', () => {
  it('takes accept-sha1 from the template, true by default', () => {
    expect(nfcPassiveAuthenticationOptions(defaultTemplateConfig('government_id_nfc'))).toEqual({
      acceptSha1: true,
    });
    expect(
      nfcPassiveAuthenticationOptions(
        nfcTemplate({ id_nfc_passive_authentication_detection: { 'accept-sha1': false } }),
      ),
    ).toEqual({ acceptSha1: false });
  });
});

describe('nfcIssuerCountry (C62.2)', () => {
  it.each([
    ['UTO', 'UT'],
    ['DEU', 'DE'],
    ['D', 'DE'],
    ['D<<', 'DE'],
    ['RKS', 'XK'],
    ['NLD', 'NL'],
    ['UNO', null],
    ['XXA', null],
    ['ZZZ', null],
    ['', null],
  ] as const)('maps %s to %s', (code, country) => {
    expect(nfcIssuerCountry(code)).toBe(country);
  });
});

describe('nfcChipFields (C52.8, C53.3)', () => {
  it("reads DG1's fields exactly, dates in full", () => {
    expect(nfcChipFields({ mrzLines: TD3_LINES }, now)).toEqual({
      'name-first': 'ROWAN ASH',
      'name-last': 'QUILL',
      birthdate: '1990-01-01',
      sex: 'M',
      'expiration-date': '2031-01-01',
      'identification-number': 'L898902C3',
      nationality: 'UTO',
      'issuing-country': 'UTO',
      'document-code': 'P',
      'id-class': 'passport',
    });
  });

  it('reads a card, a visa, unknown birth days and an unreadable MRZ', () => {
    const td1 = [
      'IDUTOL898902C36<<<<<<<<<<<<<<<'.slice(0, 30),
      '9001011M3101012UTO<<<<<<<<<<<4'.slice(0, 30),
      'QUILL<<ROWAN<ASH<<<<<<<<<<<<<<'.slice(0, 30),
    ];
    expect(nfcChipFields({ mrzLines: td1 }, now)).toMatchObject({
      'document-code': 'ID',
      'id-class': null,
    });
    const visa = [`V<UTOQUILL<<ROWAN<ASH`.padEnd(44, '<'), TD3_LINES[1] ?? ''];
    expect(nfcChipFields({ mrzLines: visa }, now)?.['id-class']).toBe('visa');
    const unknownDay = [
      TD3_LINES[0] ?? '',
      `${(TD3_LINES[1] ?? '').slice(0, 13)}9001<<${(TD3_LINES[1] ?? '').slice(19)}`,
    ];
    expect(nfcChipFields({ mrzLines: unknownDay }, now)?.birthdate).toBeNull();
    expect(nfcChipFields({ mrzLines: ['NOT AN MRZ'] }, now)).toBeNull();
  });

  it('reads two-digit years as a past birth and an expiry at most 50 years ahead', () => {
    const lines = [
      TD3_LINES[0] ?? '',
      `${(TD3_LINES[1] ?? '').slice(0, 13)}300101${(TD3_LINES[1] ?? '').slice(19, 21)}700101${(TD3_LINES[1] ?? '').slice(27)}`,
    ];
    expect(nfcChipFields({ mrzLines: lines }, now)).toMatchObject({
      birthdate: '1930-01-01',
      'expiration-date': '2070-01-01',
    });
  });
});
