/**
 * Workflow 7B (L) (C97.6, C100.1, C107.5, P07, F23): the list and importer PII joins both masking
 * sets, and an importer's JSON `file` reaches a stored API log as its length and SHA-256 only. Every
 * value is synthetic.
 */
import { createHash } from 'node:crypto';
import { PII_IMPORTER_ATTRIBUTES, PII_LIST_ATTRIBUTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { apiLogValue, maskPersonalData, withoutImporterFile } from '../services/api-logs.js';
import { canViewPii, MASKED_ATTRIBUTES, piiMaskFor } from './pii.js';
import type { UserPrincipal } from '../ports.js';

const masked: UserPrincipal = {
  kind: 'user',
  userId: 'usr_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  permissions: new Set(),
} as unknown as UserPrincipal;

describe('the list PII in MASKED_ATTRIBUTES (C97.6, C107.5)', () => {
  it('joins every list and importer name', () => {
    expect(canViewPii(masked)).toBe(false);
    for (const name of [...PII_LIST_ATTRIBUTES, ...PII_IMPORTER_ATTRIBUTES]) {
      expect(MASKED_ATTRIBUTES, name).toContain(name);
    }
  });

  it('nulls each value an item serves, keeping the rest', () => {
    const attributes = piiMaskFor(masked).attributes({
      status: 'active',
      'country-code': 'ZZ',
      'id-class': 'passport',
      value: 'synthetic@example.com',
      'name-first': 'Jane',
      'name-last': 'Example',
      'id-number': 'X1234567',
      'field-value': 'synthetic',
      latitude: -30,
      longitude: -140,
      'radius-meters': 1000,
    });

    expect(attributes).toEqual({
      status: 'active',
      'country-code': 'ZZ',
      'id-class': 'passport',
      value: null,
      'name-first': null,
      'name-last': null,
      'id-number': null,
      'field-value': null,
      latitude: null,
      longitude: null,
      'radius-meters': null,
    });
  });

  it('nulls a match value and a dismissal reason', () => {
    expect(
      piiMaskFor(masked).attributes({ status: 'dismissed', 'matched-value': 'x', reason: 'y' }),
    ).toEqual({ status: 'dismissed', 'matched-value': null, reason: null });
  });

  it('leaves a signal value alone: masking is by attribute, not at every depth', () => {
    const signals = [{ name: 'inquiry/tor_detected', value: true }];
    expect(piiMaskFor(masked).attributes({ signals })).toEqual({ signals });
  });
});

describe('the list PII in the API-log masked set (C107.5, P07)', () => {
  it('masks item create bodies, probes and dismissal reasons under data.attributes', () => {
    const item = maskPersonalData({
      data: { attributes: { 'list-id': 'lst_1', value: 'synthetic', 'name-first': 'Jane' } },
    });
    const probes = maskPersonalData({
      data: { attributes: { probes: [{ kind: 'string', value: 'synthetic' }] } },
    });
    const dismissal = maskPersonalData({ data: { attributes: { reason: 'Synthetic reason' } } });

    expect(item).toEqual({
      data: { attributes: { 'list-id': 'lst_1', value: null, 'name-first': null } },
    });
    expect(probes).toEqual({ data: { attributes: { probes: null } } });
    expect(dismissal).toEqual({ data: { attributes: { reason: null } } });
  });

  it('masks the matches of an on-demand answer and a list match resource', () => {
    expect(
      maskPersonalData({
        data: { type: 'list-match-result', attributes: { matches: [{ 'list-id': 'lst_1' }] } },
      }),
    ).toEqual({ data: { type: 'list-match-result', attributes: { matches: null } } });
    expect(
      maskPersonalData({ data: { attributes: { 'matched-value': 'x', status: 'open' } } }),
    ).toEqual({ data: { attributes: { 'matched-value': null, status: 'open' } } });
  });
});

describe('withoutImporterFile (C100.1, F23)', () => {
  const content = Buffer.from('value\nsynthetic@example.com\n', 'utf8');
  const file = content.toString('base64');

  it('stores the file as its length and SHA-256, for every reader', () => {
    const body = { data: { attributes: { 'list-id': 'lst_1', file, mode: 'all-or-nothing' } } };

    const stored = apiLogValue(withoutImporterFile(body));

    expect(stored).toEqual({
      data: {
        attributes: {
          'list-id': 'lst_1',
          file: {
            length: content.byteLength,
            sha256: createHash('sha256').update(content).digest('hex'),
          },
          mode: 'all-or-nothing',
        },
      },
    });
    expect(JSON.stringify(stored)).not.toContain(file);
  });

  it('leaves any other body as it is', () => {
    const other = { data: { attributes: { value: 'synthetic' } } };
    expect(withoutImporterFile(other)).toBe(other);
    expect(withoutImporterFile(null)).toBeNull();
    expect(withoutImporterFile({ data: { attributes: { file: 3 } } })).toEqual({
      data: { attributes: { file: 3 } },
    });
  });
});
