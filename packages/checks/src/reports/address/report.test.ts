/**
 * C82.3: the `address-lookup` report's R and H fields, and what the address adapter may receive
 * (P16). Addresses are fictional; house numbers 1000 to 1006 are the sandbox's (C82.4).
 */
import { describe, expect, it } from 'vitest';
import {
  ADDRESS_VERIFICATION_FIELDS,
  addressVerificationRequestOf,
  evaluateAddressLookupReport,
  type AddressLookupQuery,
} from './report.js';

const QUERY: AddressLookupQuery = {
  'address-street-1': '1000 Placeholder Avenue',
  'address-city': 'Springfield',
  'address-subdivision': 'IL',
  'address-postal-code': '62704',
  'address-country-code': 'US',
};
const run = (overrides: Partial<AddressLookupQuery> = {}) =>
  evaluateAddressLookupReport({ ...QUERY, ...overrides });
const unavailable = (overrides: Partial<AddressLookupQuery> = {}) =>
  Object.fromEntries(run(overrides).unavailableFields.map(({ field, reason }) => [field, reason]));

describe('evaluateAddressLookupReport', () => {
  it('reads a well-formed US address: normalised components, a valid ZIP of its state', () => {
    expect(run()).toEqual({
      fields: {
        'resolved-street-1': '1000 Placeholder Avenue',
        'resolved-street-2': null,
        'resolved-city': 'Springfield',
        'resolved-subdivision': 'IL',
        'resolved-postal-code': '62704',
        'resolved-country-code': 'US',
        'postal-code-valid': true,
        'zip-state-consistent': true,
        'address-designators': [],
        'cmra-hint': false,
      },
      unavailableFields: [],
      details: {
        resolution: 'normalised',
        'subdivision-resolved': false,
        'designator-patterns': [],
        'cmra-hint-confidence': null,
      },
    });
  });

  it('normalises without correcting: NFC, whitespace collapsed, the case kept', () => {
    const report = run({
      'address-street-1': '  1000   Placeholder\tAvenue ',
      'address-street-2': ' Unit  4 ',
      'address-city': 'Montréal',
    });
    expect(report.fields['resolved-street-1']).toBe('1000 Placeholder Avenue');
    expect(report.fields['resolved-street-2']).toBe('Unit 4');
    expect(report.fields['resolved-city']).toBe('Montréal');
  });

  it('caps a component at the contracts’ length', () => {
    const report = run({ 'address-street-1': `1000 ${'a'.repeat(400)}` });
    expect(report.fields['resolved-street-1']).toHaveLength(200);
  });

  it('reads the subdivision as its code when the C58 table knows its name', () => {
    expect(run({ 'address-subdivision': 'Illinois' }).fields['resolved-subdivision']).toBe('IL');
    expect(run({ 'address-subdivision': 'illinois' }).details['subdivision-resolved']).toBe(true);
    expect(run({ 'address-subdivision': 'il' }).fields['resolved-subdivision']).toBe('IL');
    const unknown = run({ 'address-subdivision': ' Placeholder  State ' });
    expect(unknown.fields['resolved-subdivision']).toBe('Placeholder State');
    expect(unknown.fields['zip-state-consistent']).toBeNull();
    expect(
      unavailable({ 'address-subdivision': 'Placeholder State' })['zip-state-consistent'],
    ).toBe('undetermined');
  });

  it('writes a ZIP+4 in its usual form', () => {
    expect(run({ 'address-postal-code': '62704 1234' }).fields['resolved-postal-code']).toBe(
      '62704-1234',
    );
    expect(run({ 'address-postal-code': '627041234' }).fields['resolved-postal-code']).toBe(
      '62704-1234',
    );
  });

  it('reads a ZIP of another state as inconsistent, and a value that is no ZIP as unknown', () => {
    expect(run({ 'address-postal-code': '10001' }).fields['zip-state-consistent']).toBe(false);
    const notZip = run({ 'address-postal-code': 'ABCDE' });
    expect(notZip.fields['postal-code-valid']).toBe(false);
    expect(notZip.fields['zip-state-consistent']).toBeNull();
    expect(unavailable({ 'address-postal-code': 'ABCDE' })['zip-state-consistent']).toBe(
      'undetermined',
    );
  });

  it('checks another country’s postal code against its pattern, and its state not at all', () => {
    const report = run({
      'address-street-1': '10 Placeholder Street',
      'address-city': 'London',
      'address-subdivision': 'England',
      'address-postal-code': 'sw1a  1aa',
      'address-country-code': 'GB',
    });
    expect(report.fields['resolved-postal-code']).toBe('SW1A 1AA');
    expect(report.fields['postal-code-valid']).toBe(true);
    expect(report.fields['zip-state-consistent']).toBeNull();
    expect(
      unavailable({ 'address-country-code': 'GB', 'address-postal-code': 'SW1A 1AA' })[
        'zip-state-consistent'
      ],
    ).toBe('unsupported_country');
  });

  it('cannot judge a postal code for a country without a pattern', () => {
    const report = run({ 'address-country-code': 'AE', 'address-postal-code': '00000' });
    expect(report.fields['postal-code-valid']).toBeNull();
    expect(unavailable({ 'address-country-code': 'AE', 'address-postal-code': '00000' })).toEqual(
      expect.objectContaining({ 'postal-code-valid': 'undetermined' }),
    );
  });

  it.each([
    [{ 'address-street-1': 'PO Box 1234' }, ['po_box']],
    [{ 'address-street-1': 'P.O. Box 1234' }, ['po_box']],
    [{ 'address-street-1': 'PSC 1234, Box 5678', 'address-city': 'APO' }, ['military']],
    [{ 'address-street-1': 'Unit 2050 Box 4190' }, ['military']],
    [{ 'address-street-1': 'PO Box 9', 'address-street-2': 'PMB 3' }, ['po_box', 'pmb']],
  ] as const)('reads the designators of %j as %j', (overrides, designators) => {
    expect(run(overrides).fields['address-designators']).toEqual(designators);
  });

  it('hints at a CMRA for a private mailbox designator only (H, ours)', () => {
    const pmb = run({ 'address-street-1': '1003 Placeholder Avenue PMB 12' });
    expect(pmb.fields['address-designators']).toEqual(['pmb']);
    expect(pmb.fields['cmra-hint']).toBe(true);
    expect(pmb.details['cmra-hint-confidence']).toBe(0.6);
    expect(run({ 'address-street-2': 'Private Mailbox 7' }).fields['cmra-hint']).toBe(true);
    expect(run({ 'address-street-1': 'PO Box 1234' }).fields['cmra-hint']).toBe(false);
  });

  it('reads general delivery as a designator of its own, with no CMRA hint (owner decision 3)', () => {
    const report = run({ 'address-street-1': 'General Delivery' });
    expect(report.fields['address-designators']).toEqual(['general_delivery']);
    expect(report.fields['cmra-hint']).toBe(false);
    expect(report.details['designator-patterns']).toEqual(['general_delivery']);
    expect(run({ 'address-street-1': 'Poste Restante' }).fields['address-designators']).toEqual([
      'general_delivery',
    ]);
    expect(
      run({ 'address-street-1': 'PO Box 9', 'address-street-2': 'General Delivery' }).fields[
        'address-designators'
      ],
    ).toEqual(['po_box', 'general_delivery']);
  });

  it('never reads the addressee', () => {
    const report = run({ addressee: 'Avery Quill' });
    expect(JSON.stringify(report)).not.toContain('Avery');
  });
});

describe('addressVerificationRequestOf (P16)', () => {
  it('sends a US address as its normalised components, without the addressee by default', () => {
    expect(
      addressVerificationRequestOf(
        { ...QUERY, addressee: 'Avery Quill', 'address-street-1': ' 1002  Placeholder Avenue' },
        { sendAddressee: false },
      ),
    ).toEqual({
      eligible: true,
      request: {
        street1: '1002 Placeholder Avenue',
        city: 'Springfield',
        subdivision: 'IL',
        postalCode: '62704',
        countryCode: 'US',
      },
    });
  });

  it('adds the addressee and the second street line only when there are some, the addressee only when asked', () => {
    expect(
      addressVerificationRequestOf(
        { ...QUERY, addressee: ' Avery  Quill ', 'address-street-2': 'Unit 4' },
        { sendAddressee: true },
      ),
    ).toEqual({
      eligible: true,
      request: {
        addressee: 'Avery Quill',
        street1: '1000 Placeholder Avenue',
        street2: 'Unit 4',
        city: 'Springfield',
        subdivision: 'IL',
        postalCode: '62704',
        countryCode: 'US',
      },
    });
  });

  it('sends nothing for another country', () => {
    expect(
      addressVerificationRequestOf(
        { ...QUERY, 'address-country-code': 'GB' },
        { sendAddressee: true },
      ),
    ).toEqual({ eligible: false, reason: 'unsupported_country' });
  });

  it('names every provider field of the type', () => {
    expect(ADDRESS_VERIFICATION_FIELDS).toHaveLength(19);
    expect(ADDRESS_VERIFICATION_FIELDS).toContain('deliverability');
    expect(ADDRESS_VERIFICATION_FIELDS).toContain('analysis-dpv-cmra');
  });
});
