import {
  CLIENT_ADDRESS_SOURCES,
  EMAIL_REPUTATION_REASONS,
  PHONE_RISK_REASONS,
} from '@openverify/contracts';
import { ADVERSE_MEDIA_CATEGORIES, REPORT_ERROR_CODES, REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { goldenReport } from '../testing/report-fixtures';
import { CLIENT_ADDRESS_SOURCE_WORDS } from './network-words';
import {
  ADVERSE_MEDIA_CATEGORY_LABELS,
  EMAIL_REPUTATION_REASON_WORDS,
  PHONE_RISK_REASON_WORDS,
  fieldValueWords,
  reportFieldLabel,
  type FieldReportType,
} from './report-field-words';
import { REPORT_ERROR_WORDS } from './report-words';

const WORDS = /^[A-Z][^_]*$/;

/** The attributes every report type serves (C70.2); the rest are the type's own. */
const SHARED = REPORT_TYPES.map((type) => Object.keys(goldenReport(type).attributes)).reduce(
  (common, keys) => common.filter((key) => keys.includes(key)),
);
const FIELD_TYPES: readonly FieldReportType[] = ['email-address', 'phone-number', 'address-lookup'];
const FIELDS = FIELD_TYPES.flatMap((type) =>
  Object.keys(goldenReport(type).attributes)
    .filter((field) => !SHARED.includes(field))
    .map((field) => [type, field] as const),
);

describe('the fields of the email, phone and address reports in words (C82, C86)', () => {
  it.each(FIELDS)('labels the %s field %s', (type, field) => {
    expect(reportFieldLabel(type, field)).toMatch(WORDS);
  });

  it.each(FIELD_TYPES)('gives each %s field its own label', (type) => {
    const labels = FIELDS.filter(([each]) => each === type).map(([, field]) =>
      reportFieldLabel(type, field),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('knows no field another type serves, nor a shared attribute', () => {
    expect(reportFieldLabel('email-address', 'phone-type')).toBeUndefined();
    expect(reportFieldLabel('phone-number', 'status')).toBeUndefined();
    expect(reportFieldLabel('address-lookup', '__proto__')).toBeUndefined();
  });
});

describe('result reasons and categories in words (C81, C82)', () => {
  it.each(EMAIL_REPUTATION_REASONS)('says the email reputation reason %s in words', (reason) => {
    expect(EMAIL_REPUTATION_REASON_WORDS[reason]).toMatch(WORDS);
  });

  it.each(PHONE_RISK_REASONS)('says the phone risk reason %s in words', (reason) => {
    expect(PHONE_RISK_REASON_WORDS[reason]).toMatch(WORDS);
  });

  it.each(ADVERSE_MEDIA_CATEGORIES)('labels the media category %s', (category) => {
    expect(ADVERSE_MEDIA_CATEGORY_LABELS[category]).toMatch(WORDS);
  });

  it('words exactly the contract lists, each in its order', () => {
    expect(Object.keys(EMAIL_REPUTATION_REASON_WORDS)).toEqual([...EMAIL_REPUTATION_REASONS]);
    expect(Object.keys(PHONE_RISK_REASON_WORDS)).toEqual([...PHONE_RISK_REASONS]);
    expect(Object.keys(ADVERSE_MEDIA_CATEGORY_LABELS)).toEqual([...ADVERSE_MEDIA_CATEGORIES]);
  });

  it.each(['prepaid', 'payphone', 'other_line_type'])(
    'says the provider line-type reason %s in words (owner decision 14)',
    (reason) => {
      expect(Object.keys(PHONE_RISK_REASON_WORDS)).toContain(reason);
      expect((PHONE_RISK_REASON_WORDS as Readonly<Record<string, string>>)[reason]).toMatch(WORDS);
    },
  );

  it('says an undetermined line type as the reason it is, never as a line type (H08)', () => {
    expect(PHONE_RISK_REASON_WORDS.line_type_undetermined).toBe(
      'The numbering plan cannot tell a fixed line from a mobile',
    );
  });
});

describe('the ip-address report in words (C106.1, C108)', () => {
  it.each(CLIENT_ADDRESS_SOURCES)('says how the address was resolved (%s)', (source) => {
    expect(fieldValueWords('client-address-source', source)).toBe(
      CLIENT_ADDRESS_SOURCE_WORDS[source],
    );
  });

  it.each(REPORT_ERROR_CODES)('says the first error %s by its title', (code) => {
    expect(fieldValueWords('error', code)).toBe(REPORT_ERROR_WORDS[code].title);
  });
});

describe('fieldValueWords', () => {
  it.each([
    ['email-domain-kind', 'free_mail', 'Free mail'],
    ['email-domain-kind', 'custom', 'Custom domain'],
    ['phone-type', 'FIXED_LINE', 'Fixed line'],
    ['phone-type-numbering-plan', 'FIXED_LINE_OR_MOBILE', 'Fixed line or mobile'],
    ['phone-risk-recommendation', 'block', 'Block'],
    ['deliverability', 'not_confirmed', 'Not confirmed'],
    ['address-designators', 'po_box', 'PO box'],
    ['address-designators', 'general_delivery', 'General delivery (held at a post office)'],
    ['in-office', 'unknown', 'Unknown'],
    ['relationship', 'spouse', 'Spouse'],
    ['pep-type', 'relative', 'Relative of a politically exposed person'],
    ['alias-type', 'weak_aka', 'Weak alias'],
    ['kind', 'vessel', 'Vessel'],
    ['crypto-address-format', 'evm', 'EVM'],
    ['tor-exit-node', 'MATCHED', 'Listed as a Tor exit'],
    ['tor-exit-node', 'CLEARED', 'Checked against a fresh exit list: not found'],
    ['service-type', 'DATACENTER', 'Datacenter (a provider’s published ranges)'],
    ['proxy-detected', 'false', 'Checked: not found'],
    ['flagged', 'false', 'Nothing found; an unavailable field is still unknown'],
  ])('says the %s value %s as %s', (field, value, words) => {
    expect(fieldValueWords(field, value)).toBe(words);
  });

  it.each([
    ['phone-type', 'SATELLITE'],
    ['email-domain-kind', '__proto__'],
    ['no-such-field', 'x'],
  ])('knows nothing of the %s value %s, which shows as its code', (field, value) => {
    expect(fieldValueWords(field, value)).toBeUndefined();
  });
});
